# -*- coding: utf-8 -*-
"""Extract readable text from a Word document for browser preview."""
import io

from docx import Document
from docx.document import Document as DocxDocument
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph


def docx_preview_text(data: bytes, *, max_chars: int = 200_000) -> tuple[str, bool]:
    """Return paragraphs and table cells in document order."""
    document: DocxDocument = Document(io.BytesIO(data))
    lines: list[str] = []
    length = 0
    truncated = False

    for element in document.element.body.iterchildren():
        if isinstance(element, CT_P):
            value = Paragraph(element, document).text.strip()
        elif isinstance(element, CT_Tbl):
            table = Table(element, document)
            value = "\n".join(
                "\t".join(cell.text.strip() for cell in row.cells)
                for row in table.rows
            )
        else:
            continue
        if not value:
            continue
        remaining = max_chars - length
        if remaining <= 0:
            truncated = True
            break
        if len(value) > remaining:
            lines.append(value[:remaining])
            truncated = True
            break
        lines.append(value)
        length += len(value) + 2

    return "\n\n".join(lines), truncated
