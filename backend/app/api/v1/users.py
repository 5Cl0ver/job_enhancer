"""User account endpoints (US6 — Account Management): profile, export, delete."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.collection import Collection
from app.models.generated_document import GeneratedDocument
from app.models.pipeline_stage import PipelineStage
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.schemas.user import UserProfile, UserUpdate
from app.services.users import soft_delete_user

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
