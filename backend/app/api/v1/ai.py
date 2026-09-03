"""AI document generation + resume management endpoints (US4 — AI Quick Apply)."""

import re
import uuid
from pathlib import Path

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
    WorkExperienceEntry,
    WorkHistoryResponse,
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
            job_description = listing.description or listing.title
            job_title = listing.title
            company = listing.company
    return resume, job_description, job_title, company


@router.post("/prompt", response_model=PromptResponse)
async def build_document_prompt(
    data: GeneratedDocumentCreate,
    user: User = Depends(get_current_user),
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


@router.post("/autofill-map", response_model=AutofillMapResponse)
@_limiter.limit("20/minute")
async def autofill_map(
    request: Request,
    data: AutofillMapRequest,
    user: User = Depends(get_current_user),
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
    answers = list(
        await db.scalars(select(CustomAnswer).where(CustomAnswer.user_id == user.id))
    )
    # The active résumé's text — lets the mapper fill work-experience sections
    # (job title / employer / location / dates) from the user's real history.
    resume_text = await db.scalar(
        select(Resume.extracted_text).where(
            Resume.user_id == user.id, Resume.is_active.is_(True)
        )
    )
    user_data = _user_data_text(profile, answers, resume_text)
    fields = [f.model_dump() for f in data.fields]
    mappings = await ai_service.map_fields(user_data, fields)
    return AutofillMapResponse(mappings=mappings)


@router.post("/work-history", response_model=WorkHistoryResponse)
@_limiter.limit("10/minute")
async def work_history(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkHistoryResponse:
    """Parse the user's active résumé into a structured, ordered work-experience
    list — the extension uses it to fill 'Work Experience' sections (Workday et
    al.). Grounded: only what's actually in the résumé."""
    resume_text = await db.scalar(
        select(Resume.extracted_text).where(
            Resume.user_id == user.id, Resume.is_active.is_(True)
        )
    )
    if not resume_text:
        return WorkHistoryResponse(entries=[])
    entries = await ai_service.parse_work_history(resume_text)
    return WorkHistoryResponse(entries=[WorkExperienceEntry(**e) for e in entries])


@router.post(
    "/documents/manual", response_model=GeneratedDocumentSchema, status_code=201
)
async def save_manual_document(
    data: ManualDocumentCreate,
    user: User = Depends(get_current_user),
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
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GeneratedDocumentSchema:
    resume, job_description, job_title, company = await _load_resume_and_job(
        db, user, data.resume_id, data.job_listing_id
    )

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
    await db.commit()
    return GeneratedDocumentSchema.model_validate(doc)


_FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"
# A trailing employment date range on a job-header line — used to right-align it,
# the way a real resume does ("Company | Title ............ Sep 2024 – Present").
_DATE_RE = re.compile(
    r"((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?\d{4})"
    r"\s*(?:–|—|-|to)\s*"
    r"((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?\d{4}"
    r"|present|current|now)\s*$",
    re.I,
)


def _register_fonts(pdf) -> str:
    """Embed Carlito (the open, Calibri-metric font) so PDFs match the user's
    Calibri resume everywhere. Falls back to Helvetica if the files are missing."""
    try:
        pdf.add_font("Carlito", "", str(_FONT_DIR / "Carlito-Regular.ttf"))
        pdf.add_font("Carlito", "B", str(_FONT_DIR / "Carlito-Bold.ttf"))
        pdf.add_font("Carlito", "I", str(_FONT_DIR / "Carlito-Italic.ttf"))
        pdf.add_font("Carlito", "BI", str(_FONT_DIR / "Carlito-BoldItalic.ttf"))
        return "Carlito"
    except Exception:  # pragma: no cover - font files ship with the app
        return "Helvetica"


def _strip_md(s: str) -> str:
    """Remove all inline markers (used where we set the font style ourselves)."""
    return s.replace("`", "").replace("**", "").replace("*", "")


def _md_inline(s: str) -> str:
    """Keep **bold** (fpdf renders it) but drop single-* italics + backticks so
    they don't show as literal asterisks in body text."""
    s = s.replace("`", "").replace("**", "\x00").replace("*", "")
    return s.replace("\x00", "**")


def _render_markdown(pdf, text: str) -> None:
    """Render an LLM's Markdown into a resume/letter that mirrors a real template:
    Carlito (Calibri) throughout, a centered name + contact header, black section
    headings with a full-width rule, bold skill labels, job headers with
    right-aligned dates, and round bullet points."""
    from fpdf.enums import XPos, YPos

    FONT = _register_fonts(pdf)
    BODY = 10.5

    def para(
        txt: str, h: float, align: str = "L", style: str = "", size: float = BODY
    ) -> None:
        pdf.set_font(FONT, style, size)
        pdf.multi_cell(
            0,
            h,
            _md_inline(txt),
            align=align,
            markdown=True,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )

    def seg_style(seg: str) -> tuple[str, str]:
        if seg.startswith("**") and seg.endswith("**"):
            return seg[2:-2], "B"
        if seg.startswith("*") and seg.endswith("*"):
            return seg[1:-1], "I"
        return seg, ""

    def job_header(line: str) -> None:
        # "**Company** | *Title* | Sep 2024 – Present" — left parts inline (with
        # their styles), the date range right-aligned on the same line.
        parts = [p.strip() for p in line.split("|")]
        date = None
        if parts and _DATE_RE.search(parts[-1]):
            date = parts[-1].strip()
            parts = parts[:-1]
        pdf.ln(1.5)
        y = pdf.get_y()
        pdf.set_x(pdf.l_margin)
        for i, seg in enumerate(parts):
            if i > 0:
                pdf.set_font(FONT, "", BODY)
                pdf.write(5, "  |  ")
            txt, style = seg_style(seg)
            pdf.set_font(FONT, style, BODY)
            pdf.write(5, txt)
        if date:
            pdf.set_font(FONT, "", BODY)
            pdf.set_xy(pdf.l_margin, y)
            pdf.cell(0, 5, date, align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        else:
            pdf.ln(5)
            pdf.set_x(pdf.l_margin)  # write() left the cursor mid-line
        pdf.set_font(FONT, "", BODY)

    in_header = False
    pdf.set_font(FONT, "", BODY)

    for raw in text.split("\n"):
        stripped = raw.strip()

        if stripped.startswith("# ") and not stripped.startswith("## "):
            # Name — large, centered.
            pdf.set_font(FONT, "B", 17)
            pdf.multi_cell(
                0,
                8,
                _strip_md(stripped[2:]),
                align="C",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            pdf.set_font(FONT, "", BODY)
            in_header = True
            continue

        if stripped.startswith("## "):
            # Section heading — bold caps with a full-width rule under it.
            in_header = False
            pdf.ln(2)
            pdf.set_font(FONT, "B", 11.5)
            pdf.multi_cell(
                0,
                5.5,
                _strip_md(stripped[3:]).upper(),
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            y = pdf.get_y() + 0.3
            pdf.set_draw_color(70, 70, 70)
            pdf.set_line_width(0.3)
            pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
            pdf.ln(1.8)
            pdf.set_font(FONT, "", BODY)
            continue

        if in_header:
            if not stripped:
                in_header = False
                pdf.ln(1.5)
                continue
            # Title / contact line — centered under the name.
            pdf.set_font(FONT, "", 10)
            pdf.multi_cell(
                0,
                5,
                _strip_md(stripped),
                align="C",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            pdf.set_font(FONT, "", BODY)
            continue

        if not stripped:
            pdf.ln(2)
            continue

        if stripped.startswith("### "):
            para(stripped[4:], 5.5, style="B", size=11)
            continue

        if stripped.startswith(("- ", "* ")):
            pdf.set_x(pdf.l_margin + 3)
            pdf.set_font(FONT, "", BODY)
            pdf.multi_cell(
                0,
                5,
                "•  " + _md_inline(stripped[2:]),
                markdown=True,
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )
            continue

        # A job-header line: starts bold and ends with a date range.
        if stripped.startswith("**") and _DATE_RE.search(stripped):
            job_header(stripped)
            continue

        para(stripped, 5)


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
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_margins(16, 14, 16)
    _render_markdown(pdf, text_content)
    pdf_bytes = bytes(pdf.output())

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="document-{doc_id}.pdf"'
        },
    )
