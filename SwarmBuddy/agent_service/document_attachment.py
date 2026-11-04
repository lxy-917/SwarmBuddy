"""将上传的 PDF 和 Word 文档转换为聊天模型可读取的内容。"""

import base64
from fnmatch import fnmatch
from typing import Any, Awaitable, Callable

from agentscope.message import Base64Source, DataBlock, Msg, TextBlock
from agentscope.middleware import MiddlewareBase
from agentscope.rag import PDFParser, WordParser
from agentscope.formatter import DashScopeChatFormatter, DashScopeMultiAgentFormatter

from legacy_word_parser import LegacyWordParser


PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOC = "application/msword"
DOCUMENT_TYPES = {PDF, DOCX, DOC}


class DocumentAttachmentMiddleware(MiddlewareBase):
    """将模型不支持的文档附件替换为提取出的文本。

    已保存的消息仍保留原附件；能直接读取文档的模型接收原附件，
    其他模型接收提取后的文本。
    """

    preserved_input_media_types = DOCUMENT_TYPES

    def __init__(self) -> None:
        self._text_cache: dict[str, str] = {}

    async def _document_text(self, block: DataBlock) -> str:
        if block.id in self._text_cache:
            return self._text_cache[block.id]

        name = block.name or "未命名文档"
        media_type = block.source.media_type
        if not isinstance(block.source, Base64Source):
            text = f"[附件 {name} 无法读取：请将文件上传到聊天框，而不是粘贴文件链接。]"
        else:
            try:
                data = base64.b64decode(block.source.data, validate=True)
                if media_type == PDF:
                    sections = await PDFParser().parse(data, name)
                    parts = [
                        f"第{section.metadata['page']}页\n{section.content.text.strip()}"
                        for section in sections if isinstance(section.content, TextBlock)
                        and section.content.text.strip()
                    ]
                    prefix = f"[附件 PDF：{name}；共 {len(sections)} 页。以下是提取的文字，请按页码引用。]"
                else:
                    parser = WordParser(include_image=False) if media_type == DOCX else LegacyWordParser()
                    sections = await parser.parse(data, name)
                    parts = [
                        section.content.text.strip() for section in sections
                        if isinstance(section.content, TextBlock) and section.content.text.strip()
                    ]
                    prefix = f"[附件 Word：{name}。以下是提取的正文及表格。]"
                text = prefix + "\n\n" + "\n\n".join(parts) if parts else (
                    f"[附件 {name} 未提取到文字。PDF 可能是扫描件；请告知用户需要 OCR 或清晰的页面图片。]"
                )
            except (ValueError, RuntimeError, ImportError, KeyError) as exc:
                text = f"[附件 {name} 读取失败（{type(exc).__name__}）：{exc}。请如实告知用户。]"

        if len(self._text_cache) >= 8:
            self._text_cache.pop(next(iter(self._text_cache)))
        self._text_cache[block.id] = text
        return text

    async def on_model_call(
        self,
        agent: Any,
        input_kwargs: dict,
        next_handler: Callable[..., Awaitable[Any]],
    ) -> Any:
        del agent
        formatter = input_kwargs["current_model"].formatter
        accepted = getattr(formatter, "input_types", [])
        # DashScope 的格式化器只处理图片、视频和音频块；模型卡片列出 PDF
        # 并不意味着当前 API 路径可以直接发送 PDF。
        dashscope_formatter = isinstance(
            formatter, (DashScopeChatFormatter, DashScopeMultiAgentFormatter),
        )

        messages: list[Msg] = []
        changed_any = False
        for message in input_kwargs["messages"]:
            if message.role != "user":
                messages.append(message)
                continue
            content = []
            changed = False
            for block in message.content:
                if (
                    isinstance(block, DataBlock)
                    and block.source.media_type in DOCUMENT_TYPES
                    and (dashscope_formatter or not any(
                        fnmatch(block.source.media_type, pattern) for pattern in accepted
                    ))
                ):
                    content.append(TextBlock(text=await self._document_text(block)))
                    changed = True
                else:
                    content.append(block)
            messages.append(message.model_copy(update={"content": content}) if changed else message)
            changed_any |= changed

        return await next_handler(messages=messages) if changed_any else await next_handler()
