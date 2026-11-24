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

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.database import AsyncSessionLocal
from app.models.resume import Resume
from app.services import resume_reader

logger = logging.getLogger(__name__)

# Résumés being read right now (one reading at a time per résumé).
_reading: set[uuid.UUID] = set()
# Replaceable in tests.
session_factory = AsyncSessionLocal


async def read_resume(resume: Resume) -> dict:
    """Read the résumé's text into its details and store them on the row (the
    caller commits). A résumé with no text isn't stored, so it's tried again."""
    text = resume.extracted_text or ""
    history = resume_reader.read(text)
    if text.strip():
        resume.parsed_history = history
        resume.parsed_history_at = datetime.now(tz=UTC)
    return history


async def history_of(db: AsyncSession, resume: Resume) -> dict:
    """The stored reading, reading it now if it's missing."""
    if resume.parsed_history_at is not None and resume.parsed_history is not None:
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
            await read_resume(resume)
            await db.commit()
    except Exception as exc:  # a background task must never crash the app
        logger.warning("reading résumé %s failed: %s", resume_id, exc)
    finally:
        _reading.discard(resume_id)
