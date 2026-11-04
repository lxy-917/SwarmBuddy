# -*- coding: utf-8 -*-
"""Small, best-effort first-page previews for knowledge documents."""
import base64
import io
import textwrap
from pathlib import Path


def _text_preview(data: bytes, suffix: str):
    """Render the beginning of a text or Word file as a paper preview."""
    from PIL import Image, ImageDraw, ImageFont

    if suffix == ".docx":
        from ._document_text_preview import docx_preview_text

        text, _ = docx_preview_text(data, max_chars=2_000)
    else:
        text = data.decode("utf-8-sig", errors="replace")

    image = Image.new("RGB", (384, 496), "#f7f7f2")
    draw = ImageDraw.Draw(image)
    font_path = Path("C:/Windows/Fonts/msyh.ttc")
    font = ImageFont.truetype(str(font_path), 15) if font_path.exists() else ImageFont.load_default()
    draw.rectangle((0, 0, 383, 495), outline="#d4ddd9", width=2)
    y = 28
    for paragraph in text.splitlines():
        if y > 455:
            break
        if not paragraph.strip():
            y += 12
            continue
        for line in textwrap.wrap(paragraph, width=29, break_long_words=True) or [""]:
            if y > 455:
                break
            draw.text((28, y), line, fill="#33434a", font=font)
            y += 24
    return image


def first_page_thumbnail(data: bytes, filename: str, content_type: str | None) -> str | None:
    """Return a compact JPEG data URL, or ``None`` if no preview is possible."""
    if not data or len(data) > 32 * 1024 * 1024:
        return None

    from PIL import Image, ImageOps

    suffix = Path(filename).suffix.lower()
    media_type = (content_type or "").split(";", 1)[0].lower()
    if suffix == ".pdf" or media_type == "application/pdf":
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(data)
        if len(pdf) == 0:
            return None
        page = pdf[0]
        try:
            scale = min(1.0, 300 / max(page.get_size()))
            image = page.render(scale=scale).to_pil()
        finally:
            page.close()
            pdf.close()
    elif media_type.startswith("image/") or suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}:
        image = Image.open(io.BytesIO(data))
    elif suffix in {".docx", ".txt", ".md", ".markdown"}:
        image = _text_preview(data, suffix)
    else:
        return None

    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((240, 300), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=67, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
