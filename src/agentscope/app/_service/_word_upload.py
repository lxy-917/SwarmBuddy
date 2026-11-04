# -*- coding: utf-8 -*-
"""Identify Word uploads before they enter the indexing queue."""
import zipfile
from pathlib import Path
from typing import IO


_OLE_HEADER = bytes.fromhex("d0cf11e0a1b11ae1")
_DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def checked_word_content_type(
    stream: IO[bytes],
    filename: str,
    content_type: str | None,
) -> str | None:
    """Validate DOCX bytes and route mislabeled legacy DOC files correctly."""
    if Path(filename).suffix.lower() != ".docx":
        return content_type

    try:
        stream.seek(0)
        header = stream.read(8)
        if not header:
            raise ValueError("DOCX 文件是空的，请重新选择原始文件。")
        if header == _OLE_HEADER:
            return "application/msword"
        if not header.startswith(b"PK"):
            raise ValueError("文件内容不是 DOCX；请在 Word 中另存为 .docx 后上传。")
        try:
            with zipfile.ZipFile(stream) as archive:
                names = set(archive.namelist())
        except (OSError, zipfile.BadZipFile) as exc:
            raise ValueError("DOCX 文件已损坏，请重新导出后上传。") from exc
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise ValueError("压缩包中缺少 Word 正文，请上传真正的 DOCX 文件。")
        return _DOCX_MEDIA_TYPE
    finally:
        stream.seek(0)
