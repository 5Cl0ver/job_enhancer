"""Resume parsing service — extract plain text from PDF and DOCX files."""

import logging

logger = logging.getLogger(__name__)


async def parse_resume_pdf(content: bytes) -> str:
    """Extract text from a PDF resume using pdfplumber."""
    import io

    import pdfplumber

    text_parts: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)

    return "\n\n".join(text_parts).strip()


async def parse_resume_docx(content: bytes) -> str:
    """Extract text from a DOCX resume using python-docx."""
    import io

    from docx import Document

    doc = Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs).strip()


async def parse_resume(content: bytes, mime_type: str) -> str:
    """Dispatch to the correct parser based on MIME type."""
    if mime_type == "application/pdf":
        return await parse_resume_pdf(content)
    if mime_type in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    ):
        return await parse_resume_docx(content)
    raise ValueError(f"Unsupported MIME type: {mime_type}")
