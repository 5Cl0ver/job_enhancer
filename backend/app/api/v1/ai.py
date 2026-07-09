"""AI document generation + resume management endpoints (US4 — AI Quick Apply)."""

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from slowapi import Limiter
from slowapi.util import get_remote_address

_limiter = Limiter(key_func=get_remote_address)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import CurrentUser
from app.models.generated_document import GeneratedDocument
from app.models.job_listing import JobListing
from app.models.resume import Resume
from app.schemas.resume import (
    GeneratedDocumentCreate,
    GeneratedDocumentSchema,
    GeneratedDocumentUpdate,
    ResumeSchema,
)
from app.services import ai_service, resume_parser

router = APIRouter()

_ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


# ---------------------------------------------------------------------------
# Resumes
# ---------------------------------------------------------------------------


@router.post("/resumes", response_model=ResumeSchema, status_code=201)
async def upload_resume(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> ResumeSchema:
    if file.content_type not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(_ALLOWED_MIME_TYPES)}",
        )

    content = await file.read()
    if len(content) > _MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 10 MB limit")

    parsed_text = await resume_parser.parse_resume(content, file.content_type or "")

    # Deactivate previous resumes
    existing = await db.execute(
        select(Resume).where(Resume.user_id == user.id, Resume.is_active.is_(True))
    )
    for old in existing.scalars().all():
        old.is_active = False

    resume = Resume(
        id=uuid.uuid4(),
        user_id=user.id,
        filename=file.filename or "resume",
        mime_type=file.content_type,
        file_size_bytes=len(content),
        extracted_text=parsed_text,
        is_active=True,
    )
    db.add(resume)
    await db.commit()
    return ResumeSchema.model_validate(resume)


@router.get("/resumes", response_model=list[ResumeSchema])
async def list_resumes(
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> list[ResumeSchema]:
    result = await db.execute(
        select(Resume)
        .where(Resume.user_id == user.id)
        .order_by(Resume.created_at.desc())
    )
    return [ResumeSchema.model_validate(r) for r in result.scalars().all()]


# ---------------------------------------------------------------------------
# AI document generation
# ---------------------------------------------------------------------------


@router.post("/generate", response_model=GeneratedDocumentSchema, status_code=201)
@_limiter.limit("5/minute")
async def generate_document(
    request: Request,
    data: GeneratedDocumentCreate,
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> GeneratedDocumentSchema:
    # Load resume
    resume = await db.scalar(
        select(Resume).where(Resume.id == data.resume_id, Resume.user_id == user.id)
    )
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    if not resume.extracted_text:
        raise HTTPException(status_code=422, detail="Resume has no extracted text")

    # Load job listing (optional)
    job_description = ""
    job_title = ""
    company = ""
    if data.job_listing_id:
        listing = await db.scalar(
            select(JobListing).where(JobListing.id == data.job_listing_id)
        )
        if listing:
            job_description = listing.description or listing.title
            job_title = listing.title
            company = listing.company

    # Generate content
    if data.document_type == "resume":
        content, model_used, generation_ms = await ai_service.generate_tailored_resume(
            resume.extracted_text, job_description, job_title, company
        )
    else:
        content, model_used, generation_ms = await ai_service.generate_cover_letter(
            resume.extracted_text, job_description, job_title, company
        )

    doc = GeneratedDocument(
        id=uuid.uuid4(),
        user_id=user.id,
        job_listing_id=data.job_listing_id,
        resume_id=data.resume_id,
        document_type=data.document_type,
        content=content,
        model_used=model_used,
        generation_ms=generation_ms,
    )
    db.add(doc)
    await db.commit()
    return GeneratedDocumentSchema.model_validate(doc)


@router.get("/documents/{doc_id}", response_model=GeneratedDocumentSchema)
async def get_document(
    doc_id: uuid.UUID,
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> GeneratedDocumentSchema:
    doc = await db.scalar(
        select(GeneratedDocument).where(
            GeneratedDocument.id == doc_id, GeneratedDocument.user_id == user.id
        )
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return GeneratedDocumentSchema.model_validate(doc)


@router.patch("/documents/{doc_id}", response_model=GeneratedDocumentSchema)
async def update_document(
    doc_id: uuid.UUID,
    data: GeneratedDocumentUpdate,
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> GeneratedDocumentSchema:
    doc = await db.scalar(
        select(GeneratedDocument).where(
            GeneratedDocument.id == doc_id, GeneratedDocument.user_id == user.id
        )
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.edited_content = data.edited_content
    await db.commit()
    return GeneratedDocumentSchema.model_validate(doc)


@router.get("/documents/{doc_id}/pdf")
async def download_document_pdf(
    doc_id: uuid.UUID,
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Render the latest content as PDF using weasyprint."""
    import io
    import weasyprint

    doc = await db.scalar(
        select(GeneratedDocument).where(
            GeneratedDocument.id == doc_id, GeneratedDocument.user_id == user.id
        )
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    text_content = doc.edited_content or doc.content
    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  body {{ font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5;
         margin: 2cm; white-space: pre-wrap; }}
</style>
</head><body>{text_content}</body></html>"""

    pdf_bytes = weasyprint.HTML(string=html).write_pdf()
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="document-{doc_id}.pdf"'},
    )
