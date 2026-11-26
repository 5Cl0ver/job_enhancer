"""A résumé made for one job (spec 022 User Story 4).

Claude writes it in the layout the PDF maker renders. The app keeps it two ways:

- a **document** on the job (``GeneratedDocument``): what the user views,
  edits, copies and downloads;
- a **résumé** (``Resume``) whose file is that document as a PDF, set as the
  job's résumé, so Job Catcher's existing per-job choice uploads it.

Editing the document remakes the PDF (``rerender``). The résumé's details
(jobs, schools, skills) are read from the document itself (spec 029), so
Workday's job and school sections fill from THIS résumé, never from the
master's PDF text. Résumés saved before that borrowed the master's details;
they are read again from their document the first time Job Catcher asks
(``refresh_borrowed``).
"""

import re
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application_profile import ApplicationProfile
from app.models.apply import ApplyRun
from app.models.generated_document import GeneratedDocument
from app.models.resume import Resume
from app.models.resume_track import ResumeTrack
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services import master_profile, resume_reader
from app.services.resume_pdf import render_pdf

MODEL = "claude-connector"
MIN_CHARS = 400
MAX_CHARS = 30_000


def check_layout(content: str) -> str:
    """The text, or ValueError with a plain reason Claude can fix."""
    text = (content or "").strip()
    if len(text) < MIN_CHARS:
        raise ValueError(
            "That résumé is too short to be the full résumé. Write the whole "
            "thing: every real job, school and skill from the master profile."
        )
    if len(text) > MAX_CHARS:
        raise ValueError("That résumé is too long (over 30,000 characters).")
    first = [ln.strip() for ln in text.splitlines() if ln.strip()][:3]
    if not any(ln.startswith("# ") for ln in first):
        raise ValueError(
            'Start the résumé with the name as a "# Full Name" heading, then '
            "the contact line."
        )
    sections = [ln for ln in text.splitlines() if ln.startswith("## ")]
    if len(sections) < 2:
        raise ValueError(
            'Use "## " section headings (for example ## SUMMARY, ## SKILLS, '
            "## WORK EXPERIENCE, ## EDUCATION)."
        )
    return text


def plain(text: str) -> str:
    """Markdown → plain text, for the résumé's word matching."""
    out = re.sub(r"^#+\s*", "", text, flags=re.M)
    out = re.sub(r"\*\*(.+?)\*\*", r"\1", out)
    out = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", out)
    return out.strip()


async def _file_name(db: AsyncSession, user: User) -> str:
    p = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )
    name = " ".join(x for x in [p and p.first_name, p and p.last_name] if x)
    name = re.sub(r"[^\w .'-]+", "", name).strip()[:80]
    return f"{name} - Résumé.pdf" if name else "Résumé.pdf"


def history_of_document(text: str) -> dict:
    """The résumé's jobs, schools and skills, read from Claude's Markdown: one
    line per point already (no PDF line breaks), group sub-headings and the
    title line left out."""
    lines = [
        ln
        for ln in (text or "").splitlines()
        if not ln.lstrip().startswith(("### ", "> "))
    ]
    return resume_reader.read(plain("\n".join(lines)))


def _fill(resume: Resume, text: str) -> None:
    data = render_pdf(text)
    resume.file_data = data
    resume.file_size_bytes = len(data)
    resume.extracted_text = plain(text)
    resume.parsed_history = history_of_document(text)
    resume.parsed_history_at = datetime.now(tz=UTC)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


async def refresh_borrowed(db: AsyncSession, resume: Resume) -> bool:
    """A job's résumé saved before spec 029 carries the master's details,
    stamped with the master's (older) reading time: read them from its own
    document instead. Details the user edited (stamped after the résumé was
    made) are never touched. True when they were read again."""
    if resume.document_id is None:
        return False
    read_at, made_at = _aware(resume.parsed_history_at), _aware(resume.created_at)
    if read_at is not None and (made_at is None or read_at >= made_at):
        return False
    doc = await db.get(GeneratedDocument, resume.document_id)
    if doc is None or doc.user_id != resume.user_id:
        return False
    text = doc.edited_content or doc.content or ""
    if not text.strip():
        return False
    resume.parsed_history = history_of_document(text)
    resume.parsed_history_at = datetime.now(tz=UTC)
    await db.flush()
    return True


async def save_for_job(
    db: AsyncSession, user: User, sj: SavedJob, content: str, run: ApplyRun | None
) -> tuple[Resume, GeneratedDocument]:
    """Save Claude's résumé for this job and make it the job's résumé. A second
    save in the same run updates the same document and résumé."""
    text = check_layout(content)
    doc = None
    if run and run.document_id:
        doc = await db.get(GeneratedDocument, run.document_id)
    if doc is None or doc.user_id != user.id:
        doc = GeneratedDocument(
            user_id=user.id,
            job_listing_id=sj.job_listing_id,
            document_type="resume",
            content=text,
            model_used=MODEL,
        )
        db.add(doc)
    else:
        doc.content, doc.edited_content = text, None
    await db.flush()

    master = await master_profile.master_resume(db, user.id)
    resume = None
    if run and run.resume_id:
        resume = await db.get(Resume, run.resume_id)
    if resume is None or resume.user_id != user.id:
        resume = Resume(
            user_id=user.id,
            filename=await _file_name(db, user),
            mime_type="application/pdf",
            file_size_bytes=0,
            is_active=False,
            document_id=doc.id,
        )
        db.add(resume)
    resume.document_id = doc.id
    _fill(resume, text)
    await db.flush()

    doc.resume_id = master.id if master else None
    sj.resume_id, sj.resume_usual = resume.id, False
    if run:
        run.resume_id, run.document_id = resume.id, doc.id
    await db.flush()
    return resume, doc


async def rerender(db: AsyncSession, doc: GeneratedDocument) -> None:
    """The document was edited: remake its résumé's PDF."""
    if doc.document_type != "resume":
        return
    for resume in await db.scalars(
        select(Resume).where(
            Resume.document_id == doc.id, Resume.user_id == doc.user_id
        )
    ):
        _fill(resume, doc.edited_content or doc.content or "")
    await db.flush()


async def forget_resume(db: AsyncSession, resume: Resume) -> None:
    """Delete a résumé; jobs, types and runs that used it go back to the usual
    one (explicit, so it holds on SQLite too)."""
    rid = resume.id
    await db.execute(
        update(SavedJob).where(SavedJob.resume_id == rid).values(resume_id=None)
    )
    await db.execute(
        update(ResumeTrack).where(ResumeTrack.resume_id == rid).values(resume_id=None)
    )
    await db.execute(
        update(ApplyRun).where(ApplyRun.resume_id == rid).values(resume_id=None)
    )
    await db.execute(
        update(GeneratedDocument)
        .where(GeneratedDocument.resume_id == rid)
        .values(resume_id=None)
    )
    await db.delete(resume)
    await db.flush()
