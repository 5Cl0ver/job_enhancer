"""A résumé read once into its details (spec 015 R2, spec 020 R2).

Autofill fills job, school and skills sections from this: ``{work, education,
skills, certifications, websites}``, stored on the résumé row
(``parsed_history``). Reading happens ONCE per résumé — after upload, the first
time the autofill bundle finds it missing, the hourly backfill, or "Read my
résumé" in the app — and the user can edit the result in the app.

No AI (spec 020): everything comes from the built-in reader
(services/resume_reader.py). The free AI model was retired on 2026-11-05 and
left every résumé unread; the owner wants autofill perfect without AI first.
What the reader can't place, the user fixes in the app ("Check these").
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.database import AsyncSessionLocal
from app.models.resume import Resume
from app.services import resume_reader, resume_reader_v1

logger = logging.getLogger(__name__)

# Résumés being read right now (one reading at a time per résumé).
_reading: set[uuid.UUID] = set()
# Replaceable in tests.
session_factory = AsyncSessionLocal


# A résumé whose reading crashed or hung this many times is left alone; the
# user can still type its details in the app.
MAX_ATTEMPTS = 3


async def read_resume(resume: Resume) -> dict:
    """Read the résumé's text into its details and store them on the row (the
    caller commits). The reader runs in a worker thread so it never holds up
    the server; a résumé with no text is settled as empty, never re-read."""
    text = resume.extracted_text or ""
    history = {
        **await asyncio.to_thread(resume_reader.read, text),
        "reader": READER_VERSION,
    }
    resume.parsed_history = history
    resume.parsed_history_at = datetime.now(tz=UTC)
    return history


# Spec 029: details carry who made them. "reader" = the reader's version that
# read them; "edited" = the user changed them in the app (never replaced by a
# reading). Details stored before 029 carry neither.
READER_VERSION = 2


def edited(history: object) -> bool:
    return isinstance(history, dict) and history.get("edited") is True


def upgrade(resume: Resume) -> bool:
    """Details read before spec 029 by the old reader (broken PDF lines,
    sentences cut) are read again, once: only when the stored jobs are exactly
    what the old reader made, so jobs the user edited are never replaced.
    Either way they're marked, so this happens once. True when changed."""
    stored = resume.parsed_history
    if not isinstance(stored, dict) or resume.parsed_history_at is None:
        return False
    if stored.get("reader") or edited(stored) or resume.document_id is not None:
        return False
    text = resume.extracted_text or ""
    if text.strip() and stored.get("work") == resume_reader_v1.work(text):
        work = resume_reader.read(text)["work"]
        resume.parsed_history = {**stored, "work": work, "reader": READER_VERSION}
        resume.parsed_history_at = datetime.now(tz=UTC)  # Job Catcher refreshes
    else:
        # The user's own (or an older AI reading): never touched again.
        resume.parsed_history = {**stored, "reader": READER_VERSION, "edited": True}
    return True


async def upgrade_active(db: AsyncSession, user_id: uuid.UUID) -> None:
    """``upgrade`` for the user's usual résumé (Job Catcher's bundle)."""
    resume = await db.scalar(
        select(Resume)
        .options(defer(Resume.file_data))
        .where(Resume.user_id == user_id, Resume.is_active.is_(True))
        .order_by(Resume.created_at.desc())
        .limit(1)
    )
    if resume is not None and upgrade(resume):
        await db.commit()


async def history_of(db: AsyncSession, resume: Resume) -> dict:
    """The stored reading, reading it now if it's missing."""
    if resume.parsed_history_at is not None and resume.parsed_history is not None:
        if upgrade(resume):  # read before 029 and never edited: read again
            await db.commit()
        return resume.parsed_history
    history = await read_resume(resume)
    await db.commit()
    return history


BACKFILL_PER_RUN = 5


async def read_unread_resumes(session_maker=None) -> int:
    """Read résumés that were never read (spec 020): the free AI was retired on
    2026-11-05 and every reading since failed, so existing résumés have no
    details. A few per run, newest first; returns how many were read."""
    maker = session_maker or session_factory
    async with maker() as db:
        ids = list(
            await db.scalars(
                select(Resume.id)
                .where(
                    Resume.parsed_history_at.is_(None),
                    Resume.extracted_text.is_not(None),
                    func.length(func.trim(Resume.extracted_text)) > 0,
                    Resume.read_attempts < MAX_ATTEMPTS,
                )
                .order_by(Resume.created_at.desc())
                .limit(BACKFILL_PER_RUN)
            )
        )
    for resume_id in ids:
        await read_in_background(resume_id)
    return len(ids)


async def read_in_background(resume_id: uuid.UUID) -> None:
    """Read a résumé after the response went out (its own database session)."""
    if resume_id in _reading:
        return
    _reading.add(resume_id)
    try:
        async with session_factory() as db:
            resume = await db.scalar(
                select(Resume)
                .options(defer(Resume.file_data))
                .where(Resume.id == resume_id)
            )
            if resume is None or resume.parsed_history_at is not None:
                return
            if resume.read_attempts >= MAX_ATTEMPTS:
                return
            # Counted first: a reading that crashes or hangs still counts.
            resume.read_attempts += 1
            await db.commit()
            await read_resume(resume)
            await db.commit()
    except Exception as exc:  # a background task must never crash the app
        # Only the kind of error: never the résumé's text.
        logger.warning("reading résumé %s failed: %s", resume_id, type(exc).__name__)
    finally:
        _reading.discard(resume_id)
