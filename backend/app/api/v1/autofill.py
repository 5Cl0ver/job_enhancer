"""Autofill bundle for Job Catcher (spec 015, contracts/autofill-bundle.md)."""

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.services import autofill_bundle as svc
from app.services import resume_history

router = APIRouter()


@router.get("/bundle")
async def get_bundle(
    background: BackgroundTasks,
    version: str | None = Query(None, max_length=64),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Everything autofill needs, or ``{"changed": false}`` when the version
    the extension holds is still current."""
    current = await svc.bundle_version(db, user.id, user.email or "")
    if version and version == current:
        return {"changed": False, "version": current}
    bundle = await svc.build_bundle(db, user.id, user.email or "")
    # Not read into work history yet: read it after responding; the next change
    # check picks it up (the version includes when it was read).
    resume_id = bundle.pop("resume_id", None)
    if bundle["history_pending"] and resume_id is not None:
        background.add_task(resume_history.read_in_background, resume_id)
    return bundle
