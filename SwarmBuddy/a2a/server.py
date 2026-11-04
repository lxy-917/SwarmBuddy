# -*- coding: utf-8 -*-
"""将 AgentScope 智能体作为 A2A 1.0 服务提供。

``AgentExecutor`` 将智能体流式输出的 ``TextBlockDeltaEvent`` 转为产物分块，
使 A2A 客户端逐步收到回复。每个 ``context_id`` 使用独立智能体，避免会话串扰。
运行方式：

    export DASHSCOPE_API_KEY=sk-...
    python server.py [--model qwen3.7-max] [--port 9999]
"""
import argparse
import asyncio
import os

import uvicorn
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    Part,
    Task,
    TaskState,
    TaskStatus,
)
from starlette.applications import Starlette

from agentscope.agent import Agent
from agentscope.credential import DashScopeCredential
from agentscope.event import TextBlockDeltaEvent
from agentscope.message import UserMsg
from agentscope.model import DashScopeChatModel


class AgentScopeExecutor(AgentExecutor):
    """为每个 A2A 上下文运行一个独立智能体。"""

    def __init__(self, model: str, api_key: str) -> None:
        """保存新会话所需的模型配置。"""
        self._model = model
        self._api_key = api_key
        self._agents: dict[str, Agent] = {}

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """将智能体回复以 A2A 产物分块流式返回。"""
        if context.task_id is None or context.context_id is None:
            raise RuntimeError("A2A server did not assign Task/context IDs.")

        if context.context_id not in self._agents:
            self._agents[context.context_id] = Agent(
                name="Friday",
                system_prompt="You are a helpful assistant named Friday.",
                model=DashScopeChatModel(
                    credential=DashScopeCredential(api_key=self._api_key),
                    model=self._model,
                    stream=True,
                ),
            )
        agent = self._agents[context.context_id]

        # 客户端必须先收到任务本身，再接收任务更新。
        await event_queue.enqueue_event(
            Task(
                id=context.task_id,
                context_id=context.context_id,
                status=TaskStatus(state=TaskState.TASK_STATE_SUBMITTED),
            ),
        )
        updater = TaskUpdater(
            event_queue,
            task_id=context.task_id,
            context_id=context.context_id,
        )
        await updater.start_work()

        # 每次回复对应一个产物；延迟发送一个分块，才能准确标记最后一块。
        artifact_id = f"{context.task_id}-reply"
        pending, started = None, False
        async for event in agent.reply_stream(
            UserMsg(name="user", content=context.get_user_input()),
        ):
            if not isinstance(event, TextBlockDeltaEvent):
                continue
            if pending is not None:
                await updater.add_artifact(
                    [Part(text=pending)],
                    artifact_id=artifact_id,
                    append=started,
                    last_chunk=False,
                )
                started = True
            pending = event.delta

        if pending is not None:
            await updater.add_artifact(
                [Part(text=pending)],
                artifact_id=artifact_id,
                append=started,
                last_chunk=True,
            )
        await updater.complete()

    async def cancel(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """按客户端请求将任务标记为已取消。"""
        if context.task_id is None or context.context_id is None:
            raise RuntimeError("Cannot cancel a Task without IDs.")
        await TaskUpdater(
            event_queue,
            task_id=context.task_id,
            context_id=context.context_id,
        ).cancel()


def create_app(base_url: str, model: str, api_key: str) -> Starlette:
    """创建提供智能体服务的 A2A 1.0 应用。"""
    card = AgentCard(
        name="Friday",
        description="An AgentScope assistant exposed over A2A 1.0.",
        version="1.0.0",
        supported_interfaces=[
            AgentInterface(
                url=base_url,
                protocol_binding="JSONRPC",
                protocol_version="1.0",
            ),
        ],
        capabilities=AgentCapabilities(streaming=True),
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        skills=[
            AgentSkill(
                id="chat",
                name="Chat",
                description="Answer questions in a multi-turn conversation.",
                tags=["chat"],
            ),
        ],
    )
    handler = DefaultRequestHandler(
        agent_executor=AgentScopeExecutor(model=model, api_key=api_key),
        task_store=InMemoryTaskStore(),
        agent_card=card,
    )
    return Starlette(
        routes=[
            *create_agent_card_routes(card),
            *create_jsonrpc_routes(handler, rpc_url="/"),
        ],
    )


async def main() -> None:
    """服务启动入口。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="qwen3.7-max")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9999)
    args = parser.parse_args()

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Set the DASHSCOPE_API_KEY environment variable before "
            "running this demo.",
        )

    app = create_app(
        base_url=f"http://{args.host}:{args.port}",
        model=args.model,
        api_key=api_key,
    )
    await uvicorn.Server(
        uvicorn.Config(app, host=args.host, port=args.port),
    ).serve()


if __name__ == "__main__":
    asyncio.run(main())
