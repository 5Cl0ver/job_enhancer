"""User account endpoints (US6 — Account Management): profile, export, delete."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.application_profile import ApplicationProfile
from app.models.collection import Collection
from app.models.custom_answer import CustomAnswer
from app.models.generated_document import GeneratedDocument
from app.models.pipeline_stage import PipelineStage
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.schemas.user import (
    ApplicationProfileSchema,
    CustomAnswerSchema,
    CustomAnswersUpsert,
    CustomAnswersUsed,
    ProfileFillResult,
    UserProfile,
    UserUpdate,
)
from app.services.profile_extract import extract_profile
from app.services.users import soft_delete_user
from app.utils.rate_limit import rate_limit_key

_limiter = Limiter(key_func=rate_limit_key)

router = APIRouter()


@router.get("/me", response_model=UserProfile)
async def get_profile(user: User = Depends(get_current_user)) -> UserProfile:
    return UserProfile.model_validate(user)


@router.patch("/me", response_model=UserProfile)
async def update_profile(
    data: UserUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return UserProfile.model_validate(user)


@router.get("/me/application-profile", response_model=ApplicationProfileSchema)
async def get_application_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApplicationProfileSchema:
    """The user's profile vault (empty defaults if never filled)."""
    profile = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )
    if profile is None:
        return ApplicationProfileSchema()
    return ApplicationProfileSchema.model_validate(profile)


@router.put("/me/application-profile", response_model=ApplicationProfileSchema)
async def update_application_profile(
    data: ApplicationProfileSchema,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApplicationProfileSchema:
    """Upsert the profile vault. Only the fields sent are changed, so partial
    saves from the Settings form never wipe other answers."""
    profile = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )
    if profile is None:
        profile = ApplicationProfile(user_id=user.id)
        db.add(profile)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return ApplicationProfileSchema.model_validate(profile)


@router.post("/me/application-profile/from-resume", response_model=ProfileFillResult)
@_limiter.limit("5/minute")
async def fill_profile_from_resume(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileFillResult:
    """Fill EMPTY vault fields from the active resume (regex + LLM hybrid).
    User-entered answers are never overwritten, and fields a resume can't
    state (work auth, salary, notice) are never guessed."""
    resume = await db.scalar(
        select(Resume).where(Resume.user_id == user.id, Resume.is_active.is_(True))
    )
    if not resume or not resume.extracted_text:
        raise HTTPException(status_code=404, detail="Upload a resume first")

    extracted = await extract_profile(resume.extracted_text)

    profile = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )
    if profile is None:
        profile = ApplicationProfile(user_id=user.id)
        db.add(profile)

    filled: list[str] = []
    for key, value in extracted.items():
        if getattr(profile, key, None) in (None, ""):
            setattr(profile, key, value)
            filled.append(key)

    await db.commit()
    await db.refresh(profile)
    return ProfileFillResult(
        profile=ApplicationProfileSchema.model_validate(profile),
        filled=sorted(filled),
    )


# ---------------------------------------------------------------------------
# Learn-as-you-go: remembered answers to questions the profile can't map.
# ---------------------------------------------------------------------------


@router.get("/me/custom-answers", response_model=list[CustomAnswerSchema])
async def get_custom_answers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CustomAnswerSchema]:
    """The autofill memory — answers keyed by a normalized question. The
    extension fetches these to fill custom questions on any form."""
    rows = await db.scalars(select(CustomAnswer).where(CustomAnswer.user_id == user.id))
    return [CustomAnswerSchema.model_validate(r) for r in rows]


@router.put("/me/custom-answers", response_model=list[CustomAnswerSchema])
async def upsert_custom_answers(
    data: CustomAnswersUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CustomAnswerSchema]:
    """Save answers the user just taught us — upsert by question_key so
    re-answering a question updates it instead of duplicating."""
    existing = {
        r.question_key: r
        for r in await db.scalars(
            select(CustomAnswer).where(CustomAnswer.user_id == user.id)
        )
    }
    for item in data.answers:
        row = existing.get(item.question_key)
        if row is None:
            row = CustomAnswer(user_id=user.id, question_key=item.question_key)
            db.add(row)
            existing[item.question_key] = row
        row.question_text = item.question_text
        row.answer = item.answer
    await db.commit()
    rows = await db.scalars(select(CustomAnswer).where(CustomAnswer.user_id == user.id))
    return [CustomAnswerSchema.model_validate(r) for r in rows]


@router.post("/me/custom-answers/used", status_code=204)
async def mark_answers_used(
    data: CustomAnswersUsed,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Autofill just reused these learned answers — bump use_count + last_used_at
    for the Answer Library insights. Best-effort; unknown keys are ignored.
    updated_at is preserved (it means 'last edited', not 'last used')."""
    if not data.question_keys:
        return
    await db.execute(
        update(CustomAnswer)
        .where(
            CustomAnswer.user_id == user.id,
            CustomAnswer.question_key.in_(data.question_keys),
        )
        .values(
            use_count=CustomAnswer.use_count + 1,
            last_used_at=func.now(),
            updated_at=CustomAnswer.updated_at,  # don't let onupdate touch it
        )
    )
    await db.commit()


@router.delete("/me/custom-answers/{question_key:path}", status_code=204)
async def delete_custom_answer(
    question_key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Forget one learned answer (the user fixed/removed it in Settings)."""
    await db.execute(
        delete(CustomAnswer).where(
            CustomAnswer.user_id == user.id,
            CustomAnswer.question_key == question_key,
        )
    )
    await db.commit()


@router.get("/me/export")
async def export_data(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Serialize all user-owned data as a JSON download."""
    saved_jobs = (
        (
            await db.execute(
                select(SavedJob)
                .options(selectinload(SavedJob.job_listing))
                .where(SavedJob.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )

    collections = (
        (await db.execute(select(Collection).where(Collection.user_id == user.id)))
        .scalars()
        .all()
    )

    stages = (
        (
            await db.execute(
                select(PipelineStage).where(PipelineStage.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )

    resumes = (
        (await db.execute(select(Resume).where(Resume.user_id == user.id)))
        .scalars()
        .all()
    )

    documents = (
        (
            await db.execute(
                select(GeneratedDocument).where(GeneratedDocument.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )

    app_profile = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )

    custom_answers = (
        (await db.execute(select(CustomAnswer).where(CustomAnswer.user_id == user.id)))
        .scalars()
        .all()
    )

    def _dt(v: datetime | None) -> str | None:
        return v.isoformat() if v else None

    export = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "user": {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "created_at": _dt(user.created_at),
        },
        "saved_jobs": [
            {
                "id": str(sj.id),
                "job_listing": {
                    "title": sj.job_listing.title,
                    "company": sj.job_listing.company,
                    "location": sj.job_listing.location,
                    "apply_url": sj.job_listing.apply_url,
                    "source": sj.job_listing.source,
                },
                "notes": sj.notes,
                "applied_at": _dt(sj.applied_at),
                "created_at": _dt(sj.created_at),
            }
            for sj in saved_jobs
        ],
        "collections": [
            {"id": str(c.id), "name": c.name, "is_default": c.is_default}
            for c in collections
        ],
        "pipeline_stages": [
            {"id": str(s.id), "name": s.name, "sort_order": s.sort_order}
            for s in stages
        ],
        "resumes": [
            {
                "id": str(r.id),
                "filename": r.filename,
                "created_at": _dt(r.created_at),
            }
            for r in resumes
        ],
        "generated_documents": [
            {
                "id": str(d.id),
                "document_type": d.document_type,
                "created_at": _dt(d.created_at),
            }
            for d in documents
        ],
        "application_profile": (
            ApplicationProfileSchema.model_validate(app_profile).model_dump()
            if app_profile
            else None
        ),
        "custom_answers": [
            {
                "question_key": a.question_key,
                "question_text": a.question_text,
                "answer": a.answer,
                "use_count": a.use_count,
                "updated_at": _dt(a.updated_at),
                "last_used_at": _dt(a.last_used_at),
            }
            for a in custom_answers
        ],
    }

    json_bytes = json.dumps(export, indent=2).encode()
    return StreamingResponse(
        iter([json_bytes]),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="job_enhancer_export.json"'
        },
    )


@router.delete("/me", status_code=204)
async def delete_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete the current user account (FR-020).

    The account is deactivated immediately; all owned rows and stored
    files are permanently purged after a 30-day grace period by the
    daily `purge_deleted_users` job (cascade via FK).
    """
    await soft_delete_user(db, user)
