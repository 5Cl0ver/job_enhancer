"""AI document generation + resume management endpoints (US4 — AI Quick Apply)."""

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user, get_user_or_pass
from app.models.application_profile import ApplicationProfile
from app.models.custom_answer import CustomAnswer
from app.models.generated_document import GeneratedDocument
from app.models.job_listing import JobListing
from app.models.resume import Resume
from app.models.user import User
from app.schemas.resume import (
    AutofillMapRequest,
    AutofillMapResponse,
    GeneratedDocumentCreate,
    GeneratedDocumentSchema,
    GeneratedDocumentUpdate,
    ManualDocumentCreate,
    PromptResponse,
    ResumeSchema,
    ResumeSkills,
    WorkExperienceEntry,
    WorkHistoryResponse,
)
from app.services import (
    ai_service,
    allowance,
    apply_resume,
    resume_history,
    resume_parser,
)
from app.services import saved_jobs as sj_svc
from app.services.match import skills_in_resume
from app.services.resume_pdf import _render_markdown, render_pdf  # noqa: F401
from app.utils.content_disposition import content_disposition, file_headers
from app.utils.rate_limit import rate_limit_key

_limiter = Limiter(key_func=rate_limit_key)

router = APIRouter()

# A resume type holds up to 30 skills; suggest a list worth reading.
MAX_SUGGESTED_SKILLS = 20

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
    background: BackgroundTasks,
    file: UploadFile = File(...),
    # False: keep the current main resume (an upload for one resume type). The
    # first resume a user uploads always becomes the main one.
    make_active: bool = Query(True),
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

    current = (
        await db.scalars(
            select(Resume).where(Resume.user_id == user.id, Resume.is_active.is_(True))
        )
    ).all()
    activate = make_active or not current
    if activate:  # the new upload replaces the main resume
        for old in current:
            old.is_active = False

    resume = Resume(
        id=uuid.uuid4(),
        user_id=user.id,
        filename=file.filename or "resume",
        mime_type=file.content_type,
        file_size_bytes=len(content),
        extracted_text=parsed_text,
        file_data=content,  # original bytes — ATS autofill re-attaches the real file
        is_active=activate,
    )
    db.add(resume)
    await db.commit()
    # Read it into its details for autofill, after responding (every résumé:
    # any of them can be the one chosen for a job — spec 020).
    background.add_task(resume_history.read_in_background, resume.id)
    return ResumeSchema.model_validate(resume)


@router.get("/resumes/active/file")
async def download_active_resume_file(
    user: User = Depends(get_user_or_pass),
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
        # The extension needs the name to rebuild the File object; any name
        # works (RFC 6266 + percent-encoded X-Resume-Filename).
        headers=file_headers(resume.filename),
    )


def _inline(filename: str) -> str:
    """A Content-Disposition that shows the file in the tab under its own name."""
    return content_disposition("inline", filename)


async def _own_resume(db: AsyncSession, user: User, resume_id: uuid.UUID) -> Resume:
    resume = await db.scalar(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume


@router.get("/resumes/{resume_id}/file")
async def view_resume_file(
    resume_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """One of the user's resumes, to look at in the browser: which file is
    this, before attaching it to a resume type."""
    import io

    resume = await _own_resume(db, user, resume_id)
    if not resume.file_data:
        raise HTTPException(
            status_code=404,
            detail="This resume's file wasn't kept. Upload it again to view it.",
        )
    return StreamingResponse(
        io.BytesIO(resume.file_data),
        media_type=resume.mime_type,
        headers={"Content-Disposition": _inline(resume.filename)},
    )


@router.put("/resumes/{resume_id}/master", response_model=ResumeSchema)
async def set_master_resume(
    resume_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResumeSchema:
    """Make this the master résumé, the big one Claude tailors from (spec 022).
    One per user."""
    resume = await _own_resume(db, user, resume_id)
    if resume.document_id is not None:
        raise HTTPException(
            status_code=400, detail="A résumé made for one job can't be the master."
        )
    await db.execute(
        update(Resume)
        .where(Resume.user_id == user.id, Resume.id != resume.id)
        .values(is_master=False)
    )
    resume.is_master = True
    await db.commit()
    return ResumeSchema.model_validate(resume)


@router.delete("/resumes/{resume_id}", status_code=204)
async def delete_resume(
    resume_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a résumé. Never the usual one or the master; jobs that used it
    go back to the usual one (spec 022)."""
    resume = await _own_resume(db, user, resume_id)
    if resume.is_active or resume.is_master:
        raise HTTPException(
            status_code=400,
            detail="Pick another usual or master résumé before deleting this one.",
        )
    await apply_resume.forget_resume(db, resume)
    await db.commit()


@router.get("/resumes/{resume_id}/skills", response_model=ResumeSkills)
async def resume_skills(
    resume_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResumeSkills:
    """The known skills named in a resume, to pre-fill a resume type's "key
    skills" so the user edits a list instead of typing one. Read off the text
    by the same word list the match score uses; no AI."""
    resume = await _own_resume(db, user, resume_id)
    return ResumeSkills(
        skills=skills_in_resume(resume.extracted_text or "", MAX_SUGGESTED_SKILLS)
    )


@router.get("/resumes", response_model=list[ResumeSchema])
async def list_resumes(
    user: User = Depends(get_user_or_pass),
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


async def _load_resume_and_job(
    db: AsyncSession,
    user: User,
    resume_id: uuid.UUID,
    job_listing_id: uuid.UUID | None,
) -> tuple[Resume, str, str, str]:
    """Shared by /generate and /prompt: fetch the user's resume (validated) and
    the job's (title, company, description). Returns (resume, desc, title, co)."""
    resume = await db.scalar(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user.id)
    )
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    if not resume.extracted_text:
        raise HTTPException(status_code=422, detail="Resume has no extracted text")

    job_description = ""
    job_title = ""
    company = ""
    if job_listing_id:
        listing = await db.scalar(
            select(JobListing).where(JobListing.id == job_listing_id)
        )
        if listing:
            # The user's own name for the job, if they fixed it.
            own = await sj_svc.own_names(db, user.id, listing.id)
            job_title = own.get("title") or listing.title
            company = own.get("company") or listing.company
            job_description = listing.description or job_title
    return resume, job_description, job_title, company


@router.post("/prompt", response_model=PromptResponse)
async def build_document_prompt(
    data: GeneratedDocumentCreate,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> PromptResponse:
    """Return a ready-to-paste prompt (job + resume + instructions) for the
    "use my own Claude" bridge. No LLM call — the user's own AI does the writing,
    then posts the result back to /documents/manual."""
    resume, job_description, job_title, company = await _load_resume_and_job(
        db, user, data.resume_id, data.job_listing_id
    )
    prompt = ai_service.build_prompt(
        data.document_type,
        resume.extracted_text or "",
        job_description,
        job_title,
        company,
    )
    return PromptResponse(prompt=prompt, job_title=job_title, company=company)


def _user_data_text(
    profile: ApplicationProfile | None,
    answers: list[CustomAnswer],
    resume_text: str | None = None,
) -> str:
    """Compact, grounded 'here is everything we know about the user' block."""
    p = profile
    tri = lambda v: "Yes" if v is True else "No" if v is False else None  # noqa: E731
    pairs = [
        (
            "Full name",
            " ".join(x for x in [p and p.first_name, p and p.last_name] if x) or None,
        ),
        ("Email", None),  # email lives on the user row; the extension fills it directly
        ("Phone", p and p.phone),
        ("Address", p and p.address_line1),
        ("Address line 2", p and p.address_line2),
        ("City", p and p.city),
        ("State/Region", p and p.state),
        ("Postal code", p and p.postal_code),
        ("Country", p and p.country),
        ("LinkedIn", p and p.linkedin_url),
        ("GitHub", p and p.github_url),
        ("Portfolio", p and p.portfolio_url),
        ("Authorized to work", tri(p and p.authorized_to_work)),
        ("Requires visa sponsorship", tri(p and p.requires_sponsorship)),
        ("Willing to relocate", tri(p and p.willing_to_relocate)),
        ("Desired salary (USD/yr)", p and p.desired_salary),
        ("Notice period / earliest start", p and p.notice_period),
    ]
    lines = [f"- {k}: {v}" for k, v in pairs if v not in (None, "")]
    if answers:
        lines.append("Previously answered questions:")
        lines += [f'- "{a.question_text}" -> {a.answer}' for a in answers]
    # The résumé is the source of truth for work history: job titles, employers,
    # locations, and employment dates. Include it so the mapper can fill an
    # application's "Work Experience" section (Workday et al.) from real data —
    # still grounded (it must only use what's actually written here).
    if resume_text and resume_text.strip():
        lines.append("")
        lines.append(
            "Résumé (source of truth for work history — job titles, employers, "
            "locations, employment dates, education, skills):"
        )
        lines.append(resume_text.strip()[:6000])
    return "\n".join(lines) or "(no saved data)"


AI_PAUSED = (
    "AI writing is paused for now. Use My Claude in Job Catcher, or write your own."
)


def _ai_on() -> None:
    """AI is paused (owner, 2026-11-24; spec 019 R13): refuse before anything is
    spent or sent to the model."""
    if not settings.ai_writing_on:
        raise HTTPException(status_code=503, detail=AI_PAUSED)


@router.post("/autofill-map", response_model=AutofillMapResponse)
@_limiter.limit("20/minute")
async def autofill_map(
    request: Request,
    data: AutofillMapRequest,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> AutofillMapResponse:
    """AI field mapper: the extension sends the fields its deterministic pass
    couldn't fill; we ground the model on the user's profile + learned answers
    and return {field_id: value}. Only the user's own data is used."""
    if not data.fields:
        return AutofillMapResponse(mappings={})
    profile = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )
    # Only everyday answers: one company's answers ("site|question") and saved
    # essays ("essay|question") never ground the AI for another application.
    answers = [
        a
        for a in await db.scalars(
            select(CustomAnswer).where(CustomAnswer.user_id == user.id)
        )
        if "|" not in a.question_key
    ]
    # The active résumé's text — lets the mapper fill work-experience sections
    # (job title / employer / location / dates) from the user's real history.
    resume_text = await db.scalar(
        select(Resume.extracted_text).where(
            Resume.user_id == user.id, Resume.is_active.is_(True)
        )
    )
    user_data = _user_data_text(profile, answers, resume_text)
    fields = [f.model_dump() for f in data.fields]
    _ai_on()
    # Every call counts, an empty answer too: the model ran either way, and an
    # empty answer can't be told apart from one nobody could use (spec 019).
    async with allowance.spending(db, user, "ai_autofill"):
        mappings, confidence = await ai_service.map_fields_scored(user_data, fields)
    return AutofillMapResponse(mappings=mappings, confidence=confidence)


@router.post("/work-history", response_model=WorkHistoryResponse)
@_limiter.limit("10/minute")
async def work_history(
    request: Request,
    resume_id: uuid.UUID | None = Query(None),
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> WorkHistoryResponse:
    """The user's active résumé as a structured, ordered work-experience list —
    the extension fills 'Work Experience' sections (Workday et al.) from it.
    Read once and stored (services/resume_history.py). Grounded: only what's
    actually in the résumé."""
    # The résumé chosen for this application (spec 020), else the active one.
    mine = (
        select(Resume).options(defer(Resume.file_data)).where(Resume.user_id == user.id)
    )
    resume = await db.scalar(
        mine.where(Resume.id == resume_id)
        if resume_id
        else mine.where(Resume.is_active.is_(True))
        .order_by(Resume.created_at.desc())
        .limit(1)
    )
    if resume is None or not resume.extracted_text:
        return WorkHistoryResponse(entries=[])
    # A job's résumé that still carries the master's details reads its own.
    if await apply_resume.refresh_borrowed(db, resume):
        await db.commit()
    history = await resume_history.history_of(db, resume)
    return WorkHistoryResponse(
        entries=[WorkExperienceEntry(**e) for e in history.get("work", [])]
    )


@router.post(
    "/documents/manual", response_model=GeneratedDocumentSchema, status_code=201
)
async def save_manual_document(
    data: ManualDocumentCreate,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> GeneratedDocumentSchema:
    """Store content the user produced in their OWN AI (the bridge), so it flows
    into the same document + PDF download pipeline as AI-generated docs."""
    if data.resume_id is not None:
        owns = await db.scalar(
            select(Resume.id).where(
                Resume.id == data.resume_id, Resume.user_id == user.id
            )
        )
        if not owns:
            raise HTTPException(status_code=404, detail="Resume not found")

    doc = GeneratedDocument(
        id=uuid.uuid4(),
        user_id=user.id,
        job_listing_id=data.job_listing_id,
        resume_id=data.resume_id,
        document_type=data.document_type,
        content=data.content,
        model_used=data.model_used,
        generation_ms=None,
    )
    db.add(doc)
    await db.commit()
    return GeneratedDocumentSchema.model_validate(doc)


@router.post("/generate", response_model=GeneratedDocumentSchema, status_code=201)
@_limiter.limit("5/minute")
async def generate_document(
    request: Request,
    data: GeneratedDocumentCreate,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> GeneratedDocumentSchema:
    resume, job_description, job_title, company = await _load_resume_and_job(
        db, user, data.resume_id, data.job_listing_id
    )
    _ai_on()

    # Generate content: one of today's free AI documents (spec 019), given
    # back if writing fails.
    async with allowance.spending(db, user, "ai_document"):
        if data.document_type == "resume":
            (
                content,
                model_used,
                generation_ms,
            ) = await ai_service.generate_tailored_resume(
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


@router.get("/documents", response_model=list[GeneratedDocumentSchema])
async def list_documents(
    job_listing_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[GeneratedDocumentSchema]:
    """Every document the user has for a job — including drafts Claude wrote via
    the MCP connector (`save_draft`), which otherwise had no way into the UI.
    Without `job_listing_id`, returns the user's most recent documents."""
    stmt = select(GeneratedDocument).where(GeneratedDocument.user_id == user.id)
    if job_listing_id is not None:
        stmt = stmt.where(GeneratedDocument.job_listing_id == job_listing_id)
    stmt = stmt.order_by(GeneratedDocument.created_at.desc()).limit(50)
    rows = (await db.scalars(stmt)).all()
    return [GeneratedDocumentSchema.model_validate(d) for d in rows]


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
    # A résumé made for a job is this document as a PDF: remake it (spec 022).
    await apply_resume.rerender(db, doc)
    await db.commit()
    return GeneratedDocumentSchema.model_validate(doc)


@router.get("/documents/{doc_id}/pdf")
async def download_document_pdf(
    doc_id: uuid.UUID,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Render the latest content as a PDF. Uses fpdf2 — pure Python, so it works
    on Windows and free-tier Linux with no native GTK/Cairo libraries (which is
    why weasyprint was dropped)."""
    import io

    doc = await db.scalar(
        select(GeneratedDocument).where(
            GeneratedDocument.id == doc_id, GeneratedDocument.user_id == user.id
        )
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    pdf_bytes = render_pdf(doc.edited_content or doc.content or "")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="document-{doc_id}.pdf"'
        },
    )
