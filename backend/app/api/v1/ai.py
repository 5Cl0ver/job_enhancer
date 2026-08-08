"""AI document generation + resume management endpoints (US4 — AI Quick Apply)."""

import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.generated_document import GeneratedDocument
from app.models.job_listing import JobListing
from app.models.resume import Resume
from app.models.user import User
from app.schemas.resume import (
    GeneratedDocumentCreate,
    GeneratedDocumentSchema,
    GeneratedDocumentUpdate,
    ResumeSchema,
)
from app.services import ai_service, resume_parser
from app.utils.rate_limit import rate_limit_key

_limiter = Limiter(key_func=rate_limit_key)

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
    user: User = Depends(get_current_user),
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
        file_data=content,  # original bytes — ATS autofill re-attaches the real file
        is_active=True,
    )
    db.add(resume)
    await db.commit()
    return ResumeSchema.model_validate(resume)


@router.get("/resumes/active/file")
async def download_active_resume_file(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """The active resume's ORIGINAL file bytes — the extension attaches them to
    ATS upload fields (a form needs the real PDF/DOCX, not extracted text)."""
    import io

    resume = await db.scalar(
        select(Resume).where(Resume.user_id == user.id, Resume.is_active.is_(True))
    )
    if not resume:
        raise HTTPException(status_code=404, detail="No resume uploaded")
    if not resume.file_data:
        raise HTTPException(
            status_code=404,
            detail="Resume file not stored — re-upload your resume once",
        )
    return StreamingResponse(
        io.BytesIO(resume.file_data),
        media_type=resume.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{resume.filename}"',
            # The extension needs these to rebuild the File object.
            "X-Resume-Filename": resume.filename,
        },
    )


@router.get("/resumes", response_model=list[ResumeSchema])
async def list_resumes(
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Render the latest content as a PDF. Uses fpdf2 — pure Python, so it works
    on Windows and free-tier Linux with no native GTK/Cairo libraries (which is
    why weasyprint was dropped)."""
    import io

    from fpdf import FPDF

    doc = await db.scalar(
        select(GeneratedDocument).where(
            GeneratedDocument.id == doc_id, GeneratedDocument.user_id == user.id
        )
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    text_content = doc.edited_content or doc.content or ""

    pdf = FPDF(format="letter")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_margins(18, 18, 18)
    pdf.set_font("Helvetica", size=11)
    # Latin-1 is fpdf2's core-font encoding; replace anything outside it (smart
    # quotes, em dashes from the LLM) so a stray character can't 500 the render.
    safe = text_content.encode("latin-1", "replace").decode("latin-1")
    pdf.multi_cell(0, 6, safe)
    pdf_bytes = bytes(pdf.output())

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="document-{doc_id}.pdf"'
        },
    )
