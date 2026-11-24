"""Everything Job Catcher's autofill needs, in one answer (spec 015).

The extension keeps a copy of this bundle so pressing Autofill never waits on
the server (a free server sleeps). It asks again with the version it holds; an
unchanged account answers ``{"changed": false}`` after reading only a few
timestamps, never the answers themselves.

The bundle: profile, email, remembered answers, and the active résumé's name
(its bytes come from ``GET /v1/ai/resumes/active/file`` only when it changes),
and the résumé read into work history + education (services/resume_history.py;
``history_pending`` while that reading hasn't happened yet).
"""

import hashlib
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.models.application_profile import ApplicationProfile
from app.models.custom_answer import CustomAnswer
from app.models.resume import Resume
from app.models.taught_field import TaughtField
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
    taught_count, taught_at = (
        await db.execute(
            select(func.count(), func.max(TaughtField.updated_at)).where(
                TaughtField.user_id == user_id
            )
        )
    ).one()
    resume = (
        await db.execute(
            select(Resume.id, Resume.created_at, Resume.parsed_history_at)
            .where(Resume.user_id == user_id, Resume.is_active.is_(True))
            .order_by(Resume.created_at.desc())
            .limit(1)
        )
    ).first()
    parts = [
        email,
        profile_at,
        count,
        answers_at,
        taught_count,
        taught_at,
        *(resume or (None, None, None)),
    ]
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
    taught = list(
        await db.scalars(
            select(TaughtField)
            .where(TaughtField.user_id == user_id)
            .order_by(TaughtField.site, TaughtField.created_at)
        )
    )
    resume = await db.scalar(
        select(Resume)
        .options(defer(Resume.file_data))  # never load the file itself here
        .where(Resume.user_id == user_id, Resume.is_active.is_(True))
        .order_by(Resume.created_at.desc())
        .limit(1)
    )
    read = resume is not None and resume.parsed_history_at is not None
    from app.models.user import User

    promoted_at = await db.scalar(
        select(User.learn_promoted_at).where(User.id == user_id)
    )
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
        # Boxes the user pointed at and taught (spec 017), per site.
        "taught": [
            {
                "id": str(t.id),
                "site": t.site,
                "fingerprint": t.fingerprint,
                "profile_key": t.profile_key,
                "answer": t.answer,
                # The most recent wins when site answers become everywhere
                # answers (spec 020).
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            }
            for t in taught
        ],
        # Job Catcher already turned this account's one-site answers into
        # answers for every site (spec 020): never again.
        "promoted": promoted_at is not None,
        "history": (resume.parsed_history or None) if read else None,
        "history_pending": resume is not None
        and not read
        and bool(resume.extracted_text),
        "resume_id": resume.id if resume is not None else None,
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
