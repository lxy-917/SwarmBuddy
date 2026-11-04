# -*- coding: utf-8 -*-
"""在 Textual 终端界面中运行完整功能的 AgentScope 智能体。

设置 ``DASHSCOPE_API_KEY`` 后运行 ``python main.py``。按 Enter 发送，
Shift+Enter 换行，Ctrl+C 中断，输入 ``/exit`` 退出。
"""

import argparse
import asyncio
import os

from agentscope.agent import Agent
from agentscope.credential import DashScopeCredential
from agentscope.model import DashScopeChatModel
from agentscope.tool import AskUser, Toolkit
from agentscope.tui import launch_tui
from agentscope.workspace import LocalWorkspace


async def main() -> None:
    """创建带本地工作区工具的智能体并启动终端界面。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="qwen3.8-max")
    parser.add_argument(
        "--workdir",
        default=os.path.join(os.path.dirname(__file__), "workspace"),
    )
    args = parser.parse_args()

    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError("Set DASHSCOPE_API_KEY before running this demo.")

    async with LocalWorkspace(workdir=args.workdir) as workspace:
        agent = Agent(
            name="Friday",
            system_prompt=(
                "You are a helpful assistant named Friday. Use tools when "
                "they help."
            ),
            model=DashScopeChatModel(
                credential=DashScopeCredential(api_key=api_key),
                model=args.model,
                stream=True,
            ),
            toolkit=Toolkit(
                tools=[AskUser(), *(await workspace.list_tools())],
                skills_or_loaders=await workspace.list_skills(),
            ),
            offloader=workspace,
        )
        await launch_tui(agent)


if __name__ == "__main__":
    asyncio.run(main())
