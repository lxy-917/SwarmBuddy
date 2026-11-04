# -*- coding: utf-8 -*-
"""Filesystem-backed long-term memory middleware.

The middleware keeps a workspace-local Markdown memory store, injects a
bounded ``MEMORY.md`` index into the system prompt, and can asynchronously
surface relevant topic files as hint blocks during the reasoning loop.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, AsyncGenerator, Callable

from pydantic import BaseModel, Field

from ..._base import MiddlewareBase
from ...._logging import logger
from ...._utils._common import _estimate_tokens, _estimate_bytes
from ....message import Msg, SystemMsg, UserMsg, HintBlock
from ....model import ChatModelBase
from ....tool import BackendBase, LocalBackend

if TYPE_CHECKING:
    from ....agent import Agent


@dataclass(slots=True)
class _MemoryFileHeader:
    """Lightweight header for one memory file, read from frontmatter only."""

    filename: str
    """Relative path under the memory directory (e.g. ``user_role.md``)."""
    path: str
    """Absolute path inside the backend."""
    description: str | None
    """One-line description from frontmatter; ``None`` when absent."""
    type: str | None
    """Memory type tag from frontmatter (user/feedback/project/reference)."""
    mtime: float | None
    """Modification time as a Unix timestamp; ``None`` when unavailable."""


DEFAULT_MEMORY_INSTRUCTIONS = """# 长期记忆

你可以在 `{memory_dir}` 使用持久化文件记忆。目录已存在；需要保存时直接使用 `Write`，
不要为此运行 mkdir。记忆只记录跨会话仍有用的信息，不能代替当前会话数据或工具结果。

## 保存范围
- user：用户长期稳定的职责、知识背景和交流偏好。
- feedback：用户确认有效或纠正过的工作方式，记录原因和适用条件。
- project：无法直接从代码或当前数据推知的长期项目目标、约束与决策。
- reference：以后还需要查阅的稳定资料及其来源。

用户明确要求记住时及时保存；要求忘记时找到并移除对应条目。
不要保存凭证、敏感个人资料、临时任务状态、完整聊天记录，或代码与文件中已能直接查到的事实。
海域扫描的边界、岛礁、传感器幅宽和规划指标可能变化；使用记忆前必须重新核对当前会话的扫描结果与数据来源。

## 文件格式
每条记忆写入独立 Markdown 文件，使用以下 YAML frontmatter：
```
---
name: 简短名称
description: 何时应读取此记忆
type: user|feedback|project|reference
---
正文：事实或规则、依据、适用条件。
```
然后在 `MEMORY.md` 增加一行相对链接及读取条件。`MEMORY.md` 是索引，不存放完整正文。
相对日期应转换为绝对日期。发现记忆过时或与当前资料冲突时，以当前资料为准并更新记忆。
检索时先用具体的文件名、术语或错误信息缩小范围；没有相关记忆时不必读取。
"""

DEFAULT_RETRIEVAL_INSTRUCTIONS = (
    "根据用户当前问题，从给定的文件名和描述中挑选明确有用的长期记忆文件，最多 5 个。"
    "只返回文件名列表；不确定是否相关时不要选，没有明确相关文件时返回空列表。"
    "记忆可能过时，不能用它代替当前会话数据或工具核验。"
)


class _MemorySelection(BaseModel):
    """长期记忆相关性筛选器的结构化输出。"""

    selected_files: list[str] = Field(
        description=(
            "需要读取的记忆文件名，相对于记忆目录，"
            "例如 'user_role.md'；最多 5 个。"
        ),
    )


class AgenticMemoryMiddleware(MiddlewareBase):
    """The agentic memory, where the LLM decides when and what to save,
    together with an asyncio retrieval task in each reply. The memory is
    stored and retrieval based on the Markdown files.

    The `AgenticMemoryMiddleware` supports different backends via the
    `backend` argument in its constructor.
    """

    FILENAME_MEMORY_MD: str = "MEMORY.md"

    class Parameters(BaseModel):
        """The user-tunable filesystem parameters."""

        model_config = {"arbitrary_types_allowed": True}

        memory_max_tokens: int = Field(
            default=4_000,
            title="MEMORY.md Max Length",
            description=(
                "The maximum tokens of the MEMORY.md inserted into the system "
                "prompt."
            ),
        )

        memory_instructions: str = Field(
            default=DEFAULT_MEMORY_INSTRUCTIONS,
            title="Memory Instructions",
            description=(
                "The default instructions appended to the system prompt "
                "before the MEMORY.md snapshots."
            ),
        )

        retrieval_async: bool = Field(
            default=True,
            title="Async Retrieval",
            description=(
                "Whether to retrieve relevant memory files asynchronously "
                "during the agent reply. If `True`, an async retrieval task "
                "will be started."
            ),
        )

        retrieval_model: ChatModelBase | None = Field(
            default=None,
            title="Retrieval Model",
            description=(
                "The LLM used to retrieve relevant memory files "
                "asynchronously during the agent reply. If `None`, the "
                "agent's model will be used."
            ),
        )

        retrieval_max_tokens_per_md: int = Field(
            default=2_000,
            title="Retrieval Max Tokens Per File",
            description=(
                "Maximum tokens read from each memory file that is surfaced "
                "by the relevance retrieval step. Keeps individual files from "
                "flooding the context window."
            ),
        )

        retrieval_max_files: int = Field(
            default=200,
            title="Retrieval Max Files",
            description=(
                "The maximum number of Markdown memory files to consider "
                "during relevance selection."
            ),
        )

        retrieval_max_tokens_per_frontmatter: int = Field(
            default=256,
            title="Retrieval Max Tokens per Frontmatter",
            description=(
                "The maximum number of tokens to read from the beginning of "
                "each Markdown file when parsing frontmatter."
            ),
        )

        retrieval_instructions: str = Field(
            default=DEFAULT_RETRIEVAL_INSTRUCTIONS,
            title="Retrieval Instructions",
            description=(
                "The instructions used to select relevant memory files for a "
                "given user query in the asynchronous retrieval task."
            ),
        )

    def __init__(
        self,
        *,
        workdir: str,
        memory_dir: str = "Memory",
        parameters: Parameters | None = None,
        backend: BackendBase | None = None,
    ) -> None:
        """Initialize filesystem-backed long-term memory behavior.

        Args:
            workdir (`str`):
                The working directory of this agent, used to store the agentic
                searchable memory files.
            memory_dir (`str`, defaults to ``"Memory"``):
                The directory to store the long-term memory files, including
                ``MEMORY.md``.
            parameters (`AgenticMemoryMiddleware.Parameters | None`, \
            defaults to ``None``):
                User-tunable parameters.  When ``None``, defaults are used.
            backend (`BackendBase | None`, optional):
                The backend to switch between local and remote storage.
                When ``None``, a local filesystem is used.
        """
        self._workdir = workdir
        self._memory_dir = memory_dir
        self._parameters = parameters or self.Parameters()
        self._backend = backend or LocalBackend()

        self._cached_input: str | None = None
        # The in-flight asynchronous retrieval task started in ``on_reply``
        # and consumed in ``on_reasoning``. Kept on the instance so the
        # reasoning hook can poll for completion across iterations.
        self._retrieval_task: asyncio.Task | None = None

    @staticmethod
    def _truncate_if_needed(content: str, max_length: int) -> str:
        """Return ``content`` truncated to at most ``max_length`` tokens.

        Args:
            content (`str`):
                The content to truncate.
            max_length (`int`):
                The maximum estimated token count to keep.

        Returns:
            `str`:
                The original content when it already fits; otherwise a prefix
                that fits within the requested token budget.
        """
        if max_length <= 0:
            return ""

        n_tokens = _estimate_tokens(content)
        if n_tokens <= max_length:
            return content

        index = int((max_length / n_tokens) * len(content))
        while index > 0 and _estimate_tokens(content[:index]) > max_length:
            index = max(0, index - 10)

        return content[:index]

    async def on_system_prompt(
        self,
        agent: "Agent",
        current_prompt: str,
    ) -> str:
        """追加长期记忆说明和限定长度的 ``MEMORY.md`` 内容。

        Args:
            agent (`Agent`):
                当前智能体；此处未使用，但属于中间件接口。
            current_prompt (`str`):
                前序中间件生成的系统提示词。

        Returns:
            `str`:
                已追加文件型长期记忆说明的提示词。
        """
        await self._ensure_layout()
        memory_md_content = await self._get_memory_md_content() or ""

        # 按配置限制注入系统提示词的记忆长度。
        memory_md_truncated = self._truncate_if_needed(
            memory_md_content,
            self._parameters.memory_max_tokens,
        )

        if len(memory_md_truncated) != len(memory_md_content):
            memory_md_path = self._get_memory_md_path()
            remain_lines = len(memory_md_truncated.split("\n"))
            omitted_lines = len(memory_md_content.split("\n")) - remain_lines
            memory_md_truncated += (
                "\n<<<TRUNCATED>>>\n<system-reminder>受上下文长度限制，"
                f"还有 {omitted_lines} 行未显示。如需继续读取，请对 "
                f"'{memory_md_path}' 使用 `Read`，offset={remain_lines}。"
                "</system-reminder>"
            )

        if not memory_md_truncated:
            memory_md_truncated = "MEMORY.md 目前为空；保存新的长期记忆后会显示在这里。"

        memory_instructions = self._parameters.memory_instructions.replace(
            "{memory_dir}",
            self._get_memory_dir(),
        )
        content = (
            f"{memory_instructions}\n" f"## MEMORY.md\n{memory_md_truncated}"
        )

        return f"{current_prompt}\n\n{content}"

    async def on_reply(
        self,
        agent: "Agent",
        input_kwargs: dict,
        next_handler: Callable[..., AsyncGenerator],
    ) -> AsyncGenerator:
        """Cache the user input and kick off an asynchronous retrieval task
        that runs concurrently with the agent reply.

        Args:
            agent (`Agent`):
                The executing agent whose model may be used for retrieval.
            input_kwargs (`dict`):
                Reply input kwargs forwarded unchanged.
            next_handler (`Callable[..., AsyncGenerator]`):
                The downstream middleware or core reply logic.

        Yields:
            `Any`:
                Items yielded by ``next_handler``.
        """

        if self._parameters.retrieval_async:
            inputs = input_kwargs.get("inputs")

            msgs = None
            if isinstance(inputs, list) and all(
                isinstance(_, Msg) for _ in inputs
            ):
                msgs = inputs
            elif isinstance(inputs, Msg):
                msgs = [inputs]

            if msgs is not None:
                self._cached_input = "\n".join(
                    [
                        f"{_.name}: " + _.get_text_content()
                        for _ in msgs
                        if _.get_text_content() is not None
                    ],
                )

            # Start an asynchronous retrieval task that uses an LLM to decide
            # which memory files are relevant to the current user input. The
            # result is consumed by ``on_reasoning``.
            if self._cached_input:
                self._retrieval_task = asyncio.create_task(
                    self._retrieve_relevant_files(agent, self._cached_input),
                )

        try:
            async for _ in next_handler(**input_kwargs):
                yield _
        finally:
            # Ensure the retrieval task does not outlive the reply.
            if (
                self._retrieval_task is not None
                and not self._retrieval_task.done()
            ):
                self._retrieval_task.cancel()
                try:
                    await self._retrieval_task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
            self._retrieval_task = None
            self._cached_input = None

    async def on_reasoning(
        self,
        agent: "Agent",
        input_kwargs: dict,
        next_handler: Callable[..., AsyncGenerator],
    ) -> AsyncGenerator:
        """Check if the retrieval finished and if yes, insert a hint block to
        the content.

        Args:
            agent (`Agent`):
                The executing agent whose context may receive a hint block.
            input_kwargs (`dict`):
                Reasoning input kwargs forwarded unchanged.
            next_handler (`Callable[..., AsyncGenerator]`):
                The downstream middleware or core reasoning logic.

        Yields:
            `Any`:
                Items yielded by ``next_handler``.
        """
        # Poll the in-flight retrieval task; if it has finished, consume its
        # result and inject it into the agent context exactly once.
        if self._retrieval_task is not None and self._retrieval_task.done():
            task = self._retrieval_task
            self._retrieval_task = None
            try:
                retrieval_result = task.result()
            except (asyncio.CancelledError, Exception):
                retrieval_result = None

            if retrieval_result:
                agent.state.append_context(
                    agent.name,
                    [
                        HintBlock(
                            hint=retrieval_result,
                        ),
                    ],
                )

        async for event in next_handler(**input_kwargs):
            yield event

    # ========================================================================
    # Helper functions
    # ========================================================================

    @staticmethod
    def _format_manifest(headers: list[_MemoryFileHeader]) -> str:
        """Format a list of memory file headers into a one-line-per-file
        manifest string suitable for the selector prompt.

        Args:
            headers (`list[_MemoryFileHeader]`):
                The memory file headers to format.

        Returns:
            `str`:
                The formatted manifest.
        """
        lines = []
        for h in headers:
            tag = f"[{h.type}] " if h.type else ""
            if h.mtime is not None:
                from datetime import datetime

                ts = datetime.fromtimestamp(h.mtime).strftime("%Y-%m-%d")
            else:
                ts = "unknown"
            desc = f": {h.description}" if h.description else ""
            lines.append(f"- {tag}{h.filename} ({ts}){desc}")
        return "\n".join(lines)

    async def _retrieve_relevant_files(
        self,
        agent: "Agent",
        query: str,
    ) -> str | None:
        """Use an LLM to identify memory files relevant to ``query`` and
        return their content as an injectable string.

        Args:
            agent (`Agent`):
                The agent whose model / memory store should be consulted.
            query (`str`):
                The cached user input used as the retrieval query.

        Returns:
            `str | None`:
                The formatted retrieval result ready to be injected into the
                context, or ``None`` when nothing relevant was found.
        """
        await self._ensure_layout()

        # 1. Scan available memory files (frontmatter only, cheap).
        headers = await self._list_md_files()
        if not headers:
            return None

        valid_filenames = {h.filename for h in headers}
        manifest = self._format_manifest(headers)

        # 2. Ask the model to select relevant files.
        model = self._parameters.retrieval_model or agent.model
        res = await model.generate_structured_output(
            [
                SystemMsg(
                    name="system",
                    content=self._parameters.retrieval_instructions,
                ),
                UserMsg(
                    name="user",
                    content=(
                        f"Query: {query}\n\n"
                        f"Available memories:\n{manifest}"
                    ),
                ),
            ],
            structured_model=_MemorySelection,
        )

        # 3. Discard hallucinated filenames and count each memory only once.
        raw_selected: list[str] = res.content.get("selected_files", [])
        selected = list(
            dict.fromkeys(f for f in raw_selected if f in valid_filenames),
        )[:5]
        if not selected:
            return None

        # 4. Read each selected file and format as an injectable string.
        # Cap each file to avoid flooding the context window.
        header_by_filename = {h.filename: h for h in headers}
        parts: list[str] = []
        for filename in selected:
            h = header_by_filename[filename]
            try:
                content = (await self._backend.read_file(h.path)).decode(
                    "utf-8",
                    errors="replace",
                )
            except Exception:
                continue

            # Truncate large files to avoid flooding the context window.
            content = self._truncate_if_needed(
                content,
                self._parameters.retrieval_max_tokens_per_md,
            )
            if h.mtime is not None:
                import time

                days = max(0, int((time.time() - h.mtime) / 86_400))
                if days == 0:
                    age = "today"
                elif days == 1:
                    age = "yesterday"
                else:
                    age = f"{days} days ago"
                header = f"Memory (saved {age}): {h.path}:"
            else:
                header = f"Memory: {h.path}:"

            parts.append(f"{header}\n\n{content}")

        if not parts:
            return None

        return "\n\n---\n\n".join(parts)

    async def _ensure_layout(self) -> None:
        """Create the memory directory and initial files idempotently.

        Existing human-edited documents are never replaced. The index file is
        created only when absent so manual edits survive restarts. The memory
        directory itself is materialized as a side effect of writing
        ``MEMORY.md`` — :meth:`BackendBase.write_file` creates parent
        directories — which avoids a platform-specific ``mkdir -p`` shell
        invocation that is not portable on Windows.
        """
        if not await self._backend.file_exists(self._get_memory_md_path()):
            logger.info(
                "Creating 'MEMORY.md' file in '%s'",
                self._workdir,
            )
            await self._backend.write_file(
                self._get_memory_md_path(),
                b"",
            )

    def _get_memory_dir(self) -> str:
        """Get the memory directory.

        Returns:
            `str`:
                The backend path of the memory directory.
        """
        return self._backend.join_path(self._workdir, self._memory_dir)

    def _get_memory_md_path(self) -> str:
        """Get the ``MEMORY.md`` path.

        Returns:
            `str`:
                The backend path of the ``MEMORY.md`` index file.
        """
        return self._backend.join_path(
            self._get_memory_dir(),
            self.FILENAME_MEMORY_MD,
        )

    async def _get_memory_md_content(self) -> str | None:
        """Get the content of the ``MEMORY.md`` file.

        Returns:
            `str | None`:
                The decoded index file content, or ``None`` when the file does
                not exist.
        """
        if not await self._backend.file_exists(self._get_memory_md_path()):
            return None

        return (
            await self._backend.read_file(self._get_memory_md_path())
        ).decode(
            "utf-8",
            errors="replace",
        )

    _FRONTMATTER_RE = re.compile(
        r"^\s*---\s*\n(?P<body>.*?)\n---\s*\n",
        re.DOTALL,
    )
    _FIELD_RE = re.compile(r"^(?P<key>\w+)\s*:\s*(?P<value>.+)$", re.MULTILINE)

    @classmethod
    def _parse_frontmatter_fields(cls, content: str) -> dict[str, str]:
        """Return a dict of YAML-like key/value pairs from the first
        frontmatter block.  Only scalar ``key: value`` lines are parsed;
        nested structures are intentionally ignored.

        Args:
            content (`str`):
                The Markdown content prefix to inspect.

        Returns:
            `dict[str, str]`:
                Parsed frontmatter fields, or an empty dict when no leading
                frontmatter block is present.
        """
        m = cls._FRONTMATTER_RE.match(content)
        if not m:
            return {}
        return {
            fm.group("key"): fm.group("value").strip()
            for fm in cls._FIELD_RE.finditer(m.group("body"))
        }

    async def _list_md_files(self) -> list[_MemoryFileHeader]:
        """Scan the memory directory for individual memory files.

        Returns:
            `list[_MemoryFileHeader]`:
                Memory file headers sorted newest-first and capped by
                ``retrieval_max_files``. The system index file
                (``MEMORY.md``) is excluded so only topic files are returned.
        """
        memory_dir = self._get_memory_dir()
        system_files = {self.FILENAME_MEMORY_MD}

        try:
            all_entries = await self._backend.list_dir(
                memory_dir,
                recursive=True,
            )
        except Exception:
            return []

        headers: list[_MemoryFileHeader] = []
        memory_dir_norm = self._backend.normpath(memory_dir)
        memory_dir_prefix = self._backend.join_path(memory_dir_norm, "")
        for entry in all_entries:
            entry_path = self._backend.normpath(entry)
            if self._backend.isabs(entry_path):
                if not entry_path.startswith(memory_dir_prefix):
                    continue
                filename = entry_path[len(memory_dir_prefix) :]
                full_path = entry_path
            else:
                filename = entry_path
                full_path = self._backend.join_path(memory_dir, filename)

            if not filename.endswith(".md") or filename in system_files:
                continue

            try:
                raw = await self._backend.read_file(full_path)
                # Only parse the leading bytes to keep this cheap.
                max_frontmatter_bytes = _estimate_bytes(
                    self._parameters.retrieval_max_tokens_per_frontmatter,
                )
                snippet = raw[:max_frontmatter_bytes].decode(
                    "utf-8",
                    errors="replace",
                )
                fields = self._parse_frontmatter_fields(snippet)
                mtime = await self._backend.stat_mtime(full_path)
                headers.append(
                    _MemoryFileHeader(
                        filename=filename,
                        path=full_path,
                        description=fields.get("description") or None,
                        type=fields.get("type") or None,
                        mtime=mtime,
                    ),
                )
            except Exception:
                continue

        headers.sort(key=lambda h: h.mtime or 0.0, reverse=True)
        return headers[: self._parameters.retrieval_max_files]
