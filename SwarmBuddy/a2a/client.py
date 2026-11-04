# -*- coding: utf-8 -*-
"""在终端中与远程 A2A 1.0 智能体聊天。

``A2AAgent`` 流式传递 AgentScope 事件，因此可像本地智能体一样交给
``launch_console``。先启动 ``server.py``，再运行：

    python client.py [--url http://127.0.0.1:9999] [--verbosity default]
"""
import argparse
import asyncio

import httpx
from a2a.client import A2ACardResolver

from agentscope.agent import A2AAgent
from agentscope.console import launch_console


async def main() -> None:
    """获取远程智能体卡片，并将智能体接入控制台。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:9999")
    parser.add_argument(
        "--verbosity",
        choices=["quiet", "default", "debug"],
        default="default",
    )
    args = parser.parse_args()

    # 示例客户端只获取一次卡片；A2AAgent 会依据卡片创建自己的通信连接。
    async with httpx.AsyncClient() as httpx_client:
        card = await A2ACardResolver(
            httpx_client=httpx_client,
            base_url=args.url,
        ).get_agent_card()

    print(f"Connected to {card.name!r} at {args.url}.")
    async with A2AAgent(card) as agent:
        await launch_console(agent, verbosity=args.verbosity)


if __name__ == "__main__":
    asyncio.run(main())
