"""Errors the app and Job Catcher catch themselves (spec 032, research R6).

``POST /v1/bugs/caught`` takes a crash or a failure from anyone signed in
(the app) or a Job Catcher pass. It never stores who sent it, never returns
the report and never says who else hit it: only whether it was kept. 20 a
minute per person; past 30 new reports an hour, only the "too many" report
counts them (repeats of a kept one always count).
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_user_or_pass
from app.models.user import User
from app.schemas.bug_reports import BugContext
from app.services import bug_reports as svc
from app.utils.rate_limit import rate_limit_key

router = APIRouter()
_limiter = Limiter(key_func=rate_limit_key)
logger = logging.getLogger(__name__)


class CaughtIn(BaseModel):
    section: Literal["app", "job_catcher"] = "app"
    kind: Literal["crash", "save_failed", "resume_failed", "fill_failed", "other"]
    place: str = Field(default="", max_length=2000)
    message: str = Field(default="", max_length=300)
    context: BugContext = Field(default_factory=BugContext)


class CaughtOut(BaseModel):
    kept: bool


@router.post("/caught", status_code=202, response_model=CaughtOut)
@_limiter.limit("20/minute")
async def caught(
    request: Request,
    data: CaughtIn,
    _user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> CaughtOut:
    kept = await svc.catch_safely(
        db,
        section=data.section,
        kind=data.kind,
        place=data.place,
        message=data.message,
        context=data.context.model_dump(exclude_none=True),
        key=svc.caught_key(data.message) or None,
    )
    try:
        await db.commit()
    except Exception:  # noqa: BLE001 — a report that can't be kept isn't one
        logger.warning("Couldn't keep a caught error", exc_info=True)
        await db.rollback()
        kept = False
    return CaughtOut(kept=kept)
