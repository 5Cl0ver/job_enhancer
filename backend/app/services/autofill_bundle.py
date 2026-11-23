"""Everything Job Catcher's autofill needs, in one answer (spec 015).

The extension keeps a copy of this bundle so pressing Autofill never waits on
the server (a free server sleeps). It asks again with the version it holds; an
unchanged account answers ``{"changed": false}`` after reading only a few
timestamps, never the answers themselves.

The bundle: profile, email, remembered answers, and the active résumé's name
(its bytes come from ``GET /v1/ai/resumes/active/file`` only when it changes).
Work history and education join it in spec 015 PR D; until then ``history``
is null.
"""

import hashlib
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application_profile import ApplicationProfile
from app.models.custom_answer import CustomAnswer
from app.models.resume import Resume
from app.schemas.user import ApplicationProfileSchema


async def bundle_version(db: AsyncSession, user_id: uuid.UUID, email: str) -> str:
    """A short hash of what the bundle is made of — reads only timestamps."""
    profile_at = await db.scalar(
        select(ApplicationProfile.updated_at).where(
            ApplicationProfile.user_id == user_id
        )
    )
    count, answers_at = (
        await db.execute(
            select(func.count(), func.max(CustomAnswer.updated_at)).where(
                CustomAnswer.user_id == user_id
            )
        )
    ).one()
    resume = (
        await db.execute(
            select(Resume.id, Resume.created_at).where(
                Resume.user_id == user_id, Resume.is_active.is_(True)
            )
        )
    ).first()
    parts = [email, profile_at, count, answers_at, *(resume or (None, None))]
    raw = "|".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


async def build_bundle(db: AsyncSession, user_id: uuid.UUID, email: str) -> dict:
    profile = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user_id)
    )
    answers = list(
        await db.scalars(
            select(CustomAnswer)
            .where(CustomAnswer.user_id == user_id)
            .order_by(CustomAnswer.question_key)
        )
    )
    resume = (
        await db.execute(
            select(Resume.id, Resume.filename, Resume.mime_type, Resume.created_at)
            .where(Resume.user_id == user_id, Resume.is_active.is_(True))
            .limit(1)
        )
    ).first()
    return {
        "changed": True,
        "version": await bundle_version(db, user_id, email),
        "email": email,
        "profile": (
            ApplicationProfileSchema.model_validate(profile)
            if profile is not None
            else ApplicationProfileSchema()
        ).model_dump(),
        "answers": [
            {
                "question_key": a.question_key,
                "question_text": a.question_text,
                "answer": a.answer,
            }
            for a in answers
        ],
        "history": None,
        "history_pending": False,
        "resume": (
            {
                "id": str(resume.id),
                "filename": resume.filename,
                "mime": resume.mime_type,
                "updated_at": resume.created_at.isoformat(),
            }
            if resume
            else None
        ),
    }
