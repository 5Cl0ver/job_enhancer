"""Cover letters, like résumés (spec 031).

A cover letter is a written document (``GeneratedDocument`` of type
``cover_letter``) holding just the letter: the opening line, 3–4 short
paragraphs and the sign-off. Its PDF is drawn on demand in the résumé's look:
the job's résumé header (name, title line, contact) when Claude made one, else
the name and contact from the profile, then the date and the letter.

A saved job points at the letter that goes with it (``cover_letter_id``); Job
Catcher attaches that PDF to a cover-letter upload box, or pastes the text into
a cover-letter text box. Claude writes one only when an application asks for
it (``save_cover_letter``); the app never writes one itself.
"""

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application_profile import ApplicationProfile
from app.models.apply import ApplyRun
from app.models.generated_document import GeneratedDocument
from app.models.job_listing import JobListing
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services.resume_pdf import render_letter_pdf

KIND = "cover_letter"
MODEL = "claude-connector"
USER_MODEL = "user"  # the user's own letter (spec 040)
MIN_CHARS = 150
MAX_CHARS = 4_000  # what Claude saves: about 250 words, with room
MAX_WORDS = 330
MAX_EDIT_CHARS = 10_000  # what the user may save by hand
MAX_LISTED = 100

# The stiff openings the owner asked never to see. "Hi Jordan," and "Hello
# Jordan," are fine; "Hi team," or "Hello hiring manager," are not.
_STIFF_START = re.compile(
    r"^(dear\b|to whom it may concern"
    r"|(hi|hello|hey)\b[\s,]*(the\s+)?(hiring\s+(manager|team)|team|there|sir|madam|all)\b"
    r"|hiring\s+(manager|team)\b)",
    re.I,
)
# A greeting alone on its line ("Greetings," / "Hello!"), not a sentence.
_BARE_GREETING = re.compile(r"^(greetings|hello|hi|hey)\s*[,.!:;]?$", re.I)
_STIFF_ANYWHERE = re.compile(
    r"\bI(?:\s+am|['’]m)\s+writing\s+to\s+(express|apply|submit)\b", re.I
)
_PLACEHOLDER = re.compile(r"\[[^\]\n]{2,40}\]")
_MARKUP = re.compile(r"(\*\*|__|`|^#+\s*|^>\s*)")
_RE_LINE = re.compile(r"^re\s*:", re.I)
_MONTHS = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_DATE_LINE = re.compile(
    rf"^({_MONTHS}\s+\d{{1,2}},?\s+\d{{4}}|\d{{1,2}}\s+{_MONTHS}\s+\d{{4}}"
    r"|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4})\.?$",
    re.I,
)
# A contact line: an email, a phone number, a link, or "a · b" / "a | b" parts.
_CONTACT_LINE = re.compile(
    r"@|https?://|linkedin|github|\s[·|]\s|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}", re.I
)
# A name on its own: two to four capitalised words, nothing else.
_NAME_LINE = re.compile(r"^[A-Z][\w'.-]*(\s+[A-Z][\w'.-]*){1,3}$")


def _plain_line(line: str) -> str:
    return _MARKUP.sub("", line.strip()).strip()


def opening_line(text: str) -> str:
    """The letter's first real line: markdown stripped, and a leading "Re:"
    line, name or contact header line, or date line skipped."""
    lines = [p for p in (_plain_line(ln) for ln in text.splitlines()) if p]
    for i, line in enumerate(lines):
        if _STIFF_START.match(line) or _BARE_GREETING.match(line):
            return line  # "Dear Hiring Manager" is never taken for a name
        header = (
            _RE_LINE.match(line)
            or _DATE_LINE.match(line)
            or _CONTACT_LINE.search(line)
            or _NAME_LINE.match(line)
        )
        if not header or i >= 6:
            return line
    return lines[-1] if lines else ""


def _stiff(text: str) -> bool:
    first = opening_line(text)
    return bool(_STIFF_START.match(first) or _BARE_GREETING.match(first))


def check_letter(content: str) -> str:
    """The letter, or ValueError with a plain reason Claude can fix."""
    text = (content or "").replace("\r\n", "\n").strip()
    if len(text) < MIN_CHARS:
        raise ValueError(
            "That cover letter is too short. Write 3–4 short paragraphs and a "
            "sign-off with the user's name."
        )
    if len(text) > MAX_CHARS or len(text.split()) > MAX_WORDS:
        raise ValueError("Keep the cover letter under about 250 words.")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if any(ln.startswith(("#", ">")) for ln in lines):
        raise ValueError(
            "Write only the letter, as plain paragraphs: the app puts the "
            "user's name and contact on top."
        )
    if _stiff(text):
        raise ValueError(
            'No "Dear …", "To whom it may concern" or "Hi team". Open with a '
            'direct line about the role, or "Hi <name>," only when you know the '
            "hiring manager's name."
        )
    if _STIFF_ANYWHERE.search(text.replace("**", "").replace("__", "")):
        raise ValueError(
            'Don\'t write "I am writing to express my interest". Say something '
            "specific about the role and the user instead."
        )
    if _PLACEHOLDER.search(text):
        raise ValueError(
            "The letter still has a [placeholder]. Use real words from the job "
            "and the master profile, or leave that part out."
        )
    return text


def check_edit(content: str) -> str:
    """The user's own text: anything they like, within a size cap."""
    text = (content or "").strip()
    if not text:
        raise ValueError("The cover letter can't be empty.")
    if len(text) > MAX_EDIT_CHARS:
        raise ValueError("That cover letter is too long (over 10,000 characters).")
    return text


def text_of(doc: GeneratedDocument) -> str:
    return doc.edited_content or doc.content or ""


async def own_letter(
    db: AsyncSession, user_id: uuid.UUID, letter_id: uuid.UUID | None
) -> GeneratedDocument | None:
    """One of the user's cover letters, else None."""
    if letter_id is None:
        return None
    return await db.scalar(
        select(GeneratedDocument).where(
            GeneratedDocument.id == letter_id,
            GeneratedDocument.user_id == user_id,
            GeneratedDocument.document_type == KIND,
        )
    )


async def save_for_job(
    db: AsyncSession,
    user: User,
    sj: SavedJob,
    content: str,
    run: ApplyRun | None,
) -> tuple[GeneratedDocument, bool]:
    """Save Claude's letter; returns it and whether it is now the job's.

    A second save in the same run replaces that run's letter. The user's
    choice always wins: the letter becomes the job's only when the job has
    no letter yet and this run hasn't saved one (so nobody chose "None"
    after it), or when the job's letter is still the one this run saved.
    A letter the user picked is never written over, and stays the job's."""
    text = check_letter(content)
    before = run.cover_letter_id if run else None
    if before is None:
        attach = sj.cover_letter_id is None
    else:
        # The user chose None or another letter after Claude's last save.
        attach = sj.cover_letter_id == before
    doc = await own_letter(db, user.id, before)
    if doc is None:
        doc = GeneratedDocument(
            user_id=user.id,
            job_listing_id=sj.job_listing_id,
            document_type=KIND,
            content=text,
            model_used=MODEL,
        )
        db.add(doc)
    else:
        doc.content, doc.edited_content = text, None
    await db.flush()
    if attach:
        sj.cover_letter_id = doc.id
        sj.updated_at = datetime.now(UTC)
    if run:
        run.cover_letter_id = doc.id
    await db.flush()
    return doc, attach


async def write_for_job(
    db: AsyncSession, user_id: uuid.UUID, saved_job_id: uuid.UUID, content: str
) -> GeneratedDocument:
    """The user's own letter for one job (spec 040), typed or pasted in the
    app: it becomes the job's letter, so Job Catcher attaches its PDF. Their
    words as they are (``check_edit``), never Claude's rules."""
    text = check_edit(content.replace("\r\n", "\n"))
    sj = await db.scalar(
        select(SavedJob).where(SavedJob.id == saved_job_id, SavedJob.user_id == user_id)
    )
    if sj is None:
        raise LookupError("Saved job not found")
    doc = GeneratedDocument(
        user_id=user_id,
        job_listing_id=sj.job_listing_id,
        document_type=KIND,
        content=text,
        model_used=USER_MODEL,
    )
    db.add(doc)
    await db.flush()
    sj.cover_letter_id = doc.id
    sj.updated_at = datetime.now(UTC)
    await db.flush()
    return doc


async def set_for_job(
    db: AsyncSession,
    user_id: uuid.UUID,
    saved_job_id: uuid.UUID,
    letter_id: uuid.UUID | None,
) -> SavedJob:
    """The letter that goes with one saved job; None = no cover letter.
    Raises LookupError when the job or the letter isn't the user's."""
    sj = await db.scalar(
        select(SavedJob).where(SavedJob.id == saved_job_id, SavedJob.user_id == user_id)
    )
    if sj is None:
        raise LookupError("Saved job not found")
    if letter_id is not None and await own_letter(db, user_id, letter_id) is None:
        raise LookupError("Cover letter not found")
    sj.cover_letter_id = letter_id
    sj.updated_at = datetime.now(UTC)
    await db.flush()
    return sj


async def listed(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """The user's cover letters, newest first, with the job each was for."""
    rows = await db.execute(
        select(
            GeneratedDocument.id,
            GeneratedDocument.job_listing_id,
            GeneratedDocument.created_at,
            JobListing.title,
            JobListing.company,
        )
        .outerjoin(JobListing, GeneratedDocument.job_listing_id == JobListing.id)
        .where(
            GeneratedDocument.user_id == user_id,
            GeneratedDocument.document_type == KIND,
        )
        .order_by(GeneratedDocument.created_at.desc())
        .limit(MAX_LISTED)
    )
    return [
        {
            "id": r.id,
            "job_listing_id": r.job_listing_id,
            "created_at": r.created_at,
            "job_title": r.title or "",
            "company": r.company or "",
        }
        for r in rows
    ]


# --------------------------------------------------------------------------- #
# The file
# --------------------------------------------------------------------------- #


async def _profile(db: AsyncSession, user_id: uuid.UUID) -> ApplicationProfile | None:
    return await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user_id)
    )


def _name(p: ApplicationProfile | None) -> str:
    name = " ".join(x for x in [p and p.first_name, p and p.last_name] if x)
    return re.sub(r"\s+", " ", name).strip()[:120]


async def file_name(db: AsyncSession, user_id: uuid.UUID) -> str:
    name = re.sub(r"[^\w .'-]+", "", _name(await _profile(db, user_id))).strip()[:80]
    return f"{name} - Cover letter.pdf" if name else "Cover letter.pdf"


def _bare(url: str | None) -> str:
    return re.sub(r"^https?://(www\.)?", "", (url or "").strip()).rstrip("/")


def resume_header(text: str) -> str:
    """A résumé's header lines (name, title line, contact): everything before
    its first section heading."""
    out: list[str] = []
    for line in (text or "").splitlines():
        if line.strip().startswith("## "):
            break
        out.append(line.rstrip())
    header = "\n".join(out).strip()
    return header if header.startswith("# ") else ""


async def _header(db: AsyncSession, doc: GeneratedDocument) -> str:
    """The job's résumé header when Claude made one, else the profile's."""
    if doc.job_listing_id is not None:
        made = await db.scalar(
            select(GeneratedDocument)
            .join(Resume, Resume.document_id == GeneratedDocument.id)
            .join(SavedJob, SavedJob.resume_id == Resume.id)
            .where(
                SavedJob.user_id == doc.user_id,
                SavedJob.job_listing_id == doc.job_listing_id,
                GeneratedDocument.user_id == doc.user_id,
            )
            .limit(1)
        )
        if made is not None and (head := resume_header(text_of(made))):
            return head
    p = await _profile(db, doc.user_id)
    name = _name(p)
    if not name:
        return ""
    user = await db.get(User, doc.user_id)
    place = ", ".join(x for x in [p and p.city, p and p.state] if x)
    contact = [
        place,
        p.phone if p else None,
        user.email if user else None,
        _bare(p.linkedin_url if p else None),
        _bare(p.portfolio_url or p.github_url if p else None),
    ]
    line = " · ".join(x for x in contact if x)
    return f"# {name}\n{line}" if line else f"# {name}"


def _date_line(doc: GeneratedDocument) -> str:
    at = doc.created_at or datetime.now(UTC)
    return f"{at:%B} {at.day}, {at.year}"


async def pdf_of(db: AsyncSession, doc: GeneratedDocument) -> tuple[bytes, str]:
    """The letter as a PDF in the résumé's look, and its file name."""
    data = render_letter_pdf(await _header(db, doc), text_of(doc), _date_line(doc))
    return data, await file_name(db, doc.user_id)
