# -*- coding: utf-8 -*-
"""目标流水线示例。"""

import os
import asyncio

from agentscope.state import AgentState
from agentscope.permission import PermissionContext, PermissionMode
from agentscope.pipeline import GoalPipeline
from agentscope.agent import Agent
from agentscope.credential import DashScopeCredential
from agentscope.model import DashScopeChatModel
from agentscope.workspace import LocalWorkspace
from agentscope.console import launch_console
from agentscope.tool import Toolkit


async def main() -> None:
    """运行目标流水线示例。"""

    # 执行者和核验者共享工作区，因此都能读写其中的文件。
    async with LocalWorkspace(
        workdir=os.path.join(os.path.dirname(__file__), "workspace"),
    ) as workspace:
        # 创建执行智能体。
        executor = Agent(
            name="Executor",
            system_prompt="You're a programmer named 'Executor'.",
            model=DashScopeChatModel(
                credential=DashScopeCredential(
                    api_key=os.getenv("DASHSCOPE_API_KEY"),
                ),
                model="qwen3.8-max",
            ),
            toolkit=Toolkit(tools=await workspace.list_tools()),
            offloader=workspace,
            state=AgentState(
                permission_context=PermissionContext(
                    mode=PermissionMode.BYPASS,
                ),
            ),
        )

        # 创建核验智能体。
        verifier = Agent(
            name="Verifier",
            system_prompt="You're a programmer named 'Verifier'.",
            model=DashScopeChatModel(
                credential=DashScopeCredential(
                    api_key=os.getenv("DASHSCOPE_API_KEY"),
                ),
                model="qwen3.8-max",
            ),
            toolkit=Toolkit(tools=await workspace.list_tools()),
            offloader=workspace,
            state=AgentState(
                permission_context=PermissionContext(
                    mode=PermissionMode.BYPASS,
                ),
            ),
        )

        # 目标随任务传入，而非在构造时确定；核验者依据首次收到的目标判断结果。
        pipe = GoalPipeline(
            executor=executor,
            verifier=verifier,
        )

        await launch_console(
            agent=pipe,
        )


asyncio.run(main())
