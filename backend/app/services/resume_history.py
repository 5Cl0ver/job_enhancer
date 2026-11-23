"""A résumé read once into work history and education (spec 015, R2).

Autofill fills Workday's experience blocks and education questions from this.
Reading takes the AI 10–20 s, so it happens ONCE per résumé — after upload, or
the first time the autofill bundle finds it missing — and is stored on the
résumé row (``parsed_history``). A failed reading stores empty lists, so it is
not retried on every request; a new résumé is read again.
"""

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.database import AsyncSessionLocal
from app.models.resume import Resume
from app.services import ai_service

logger = logging.getLogger(__name__)

# Résumés being read right now (one reading at a time per résumé).
_reading: set[uuid.UUID] = set()
# Replaceable in tests.
session_factory = AsyncSessionLocal


async def read_resume(resume: Resume) -> dict:
    """Read the résumé's text into {work, education} and store it on the row
    (the caller commits). A reading that found nothing at all is NOT stored —
    most likely the AI was unavailable — so it's tried again next time."""
    text = resume.extracted_text or ""
    history = {
        "work": await ai_service.parse_work_history(text),
        "education": await ai_service.parse_education(text),
    }
    if history["work"] or history["education"]:
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
