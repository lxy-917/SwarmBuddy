"""解析上传的旧版二进制 Word（.doc）文档。"""

import asyncio
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from agentscope.message import TextBlock
from agentscope.rag import ParserBase, Section


class LegacyWordParser(ParserBase):
    supported_media_types = ["application/msword"]

    @classmethod
    def supported_extensions(cls) -> list[str]:
        return [".doc"]

    async def parse(self, file: bytes | str, filename: str) -> list[Section]:
        data = Path(file).read_bytes() if isinstance(file, str) else file
        text = await asyncio.to_thread(self._extract, data)
        text = text.encode("utf-8", errors="replace").decode("utf-8")
        return [Section(content=TextBlock(text=text), source=filename)]

    @staticmethod
    def _extract(data: bytes) -> str:
        with tempfile.TemporaryDirectory(prefix="swarmbuddy-doc-") as folder:
            path = Path(folder) / "document.doc"
            path.write_bytes(data)
            antiword = shutil.which("antiword")
            if antiword:
                result = subprocess.run(
                    [antiword, str(path)], capture_output=True, check=False,
                    timeout=90,
                )
                if result.returncode != 0:
                    raise ValueError("无法解析 DOC 文件，请检查文件是否损坏。")
                return result.stdout.decode("utf-8", errors="replace")

            if sys.platform != "win32":
                raise RuntimeError("解析 DOC 文件需要安装 antiword。")

            try:
                import pythoncom
                from win32com.client import DispatchEx
            except ImportError as exc:
                raise RuntimeError("解析 DOC 文件需要 Microsoft Word 或 antiword。") from exc

            pythoncom.CoInitialize()
            word = None
            document = None
            try:
                word = DispatchEx("Word.Application")
                word.Visible = False
                word.DisplayAlerts = 0
                word.AutomationSecurity = 3
                document = word.Documents.Open(
                    str(path), ReadOnly=True, AddToRecentFiles=False,
                    Visible=False,
                )
                return str(document.Content.Text)
            except Exception as exc:
                raise ValueError("无法解析 DOC 文件，请检查文件或 Word 安装。") from exc
            finally:
                if document is not None:
                    document.Close(False)
                if word is not None:
                    word.Quit()
                pythoncom.CoUninitialize()
