# -*- coding: utf-8 -*-
"""工作区实现共用的宿主机辅助函数和目录常量。"""

import importlib.resources as _res

# 工作区共用常量。

#: 注入系统消息的工作区说明；保留 {backend} 和 {workdir} 占位符。
DEFAULT_WORKSPACE_INSTRUCTIONS = """<workspace>
当前可用的 {backend} 工作区位于 {workdir}。`data/` 存放系统转存的附件，
`skills/` 存放技能，`sessions/` 存放会话上下文和工具结果。

按任务需要使用工作区文件；读取前先确认路径，不要把工作区搜索结果当成全部会话数据。
在 SwarmBuddy 中，用户通过“导入海域数据”上传的 GeoJSON 由扫描服务按会话保存，
不一定出现在此工作区。需要了解已生成的扫描方案时使用 ReadOceanScanResult；
需要规划时使用可用的扫描工具或页面功能，不要仅因工作区没有 GeoJSON 文件就断言未导入。
工具返回的数据应与文件内容区分；没有读取到的数据不要推断为事实。

如需创建任务文件，在工作区内使用清晰的目录和文件名，并记录必要的来源及用途。
临时文件放在专用的 `scratch/` 目录；不要随意覆盖或删除用户资料。
不得将凭证写入代码或日志。多会话可能共用工作区，修改前确认目标文件属于当前任务。
</workspace>"""

#: 工作区内系统转存的多模态数据目录。
DEFAULT_DATA_DIR = "data"

#: 工作区内的可复用技能目录。
DEFAULT_SKILLS_DIR = "skills"

#: 工作区内的会话上下文与工具结果目录。
DEFAULT_SESSIONS_DIR = "sessions"

#: 工作区内保存 MCP 注册信息的文件。
DEFAULT_MCP_FILE = ".mcp"

DEFAULT_GATEWAY_VENV = ".venv"
DEFAULT_GATEWAY_LOG = "gateway.log"
DEFAULT_GATEWAY_SCRIPT = "_mcp_gateway_app.py"
DEFAULT_GLOB_HELPER_SCRIPT = "_glob_helper.py"

#: 网关脚本运行时所需的最小 Python 依赖集合。
#: Docker 构建和 E2B 沙箱启动时都先安装这些依赖，再安装 agentscope。
#:
#: agentscope 使用 --no-deps 安装，直接依赖必须显式列出。
#: mcp 的版本上限与 pyproject.toml 保持一致，确保网关与主进程协议兼容。
_GATEWAY_BASE_REQUIREMENTS: tuple[str, ...] = (
    "mcp<2.0.0",
    "uvicorn",
    "fastapi",
    "httpx",
)


# ── gateway script ─────────────────────────────────────────────────


def _read_gateway_script_bytes() -> bytes:
    """Read the standalone gateway script as bytes via ``importlib.resources``.

    The script ships at
    ``agentscope/workspace/_mcp_gateway/_mcp_gateway_app.py``. Both
    backends copy it to a fixed in-container / in-sandbox path so the
    launch command can invoke it directly, avoiding ``python -m`` and
    the heavy ``agentscope.workspace.__init__`` import graph.
    """
    return (
        _res.files("agentscope.workspace._mcp_gateway")
        .joinpath("_mcp_gateway_app.py")
        .read_bytes()
    )


# ── builtin tool helper scripts ───────────────────────────────────


def _read_glob_helper_bytes() -> bytes:
    """Read the standalone glob helper script as bytes.

    The script ships at
    ``agentscope/tool/_builtin/_scripts/_glob_helper.py``. Both Docker
    and E2B backends copy it into the workspace so the :class:`Glob`
    tool can invoke it uniformly via ``exec_shell``.

    Returns:
        `bytes`:
            The raw contents of the ``_glob_helper.py`` script.
    """
    return (
        _res.files("agentscope.tool._builtin._scripts")
        .joinpath("_glob_helper.py")
        .read_bytes()
    )
