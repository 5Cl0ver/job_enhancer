"""Sites to skip endpoints (spec 024): the user's own list, owner only."""

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.skipped_site import (
    SiteSuggestion,
    SkippedSiteAdded,
    SkippedSiteCreate,
    SkippedSiteOut,
)
from app.services import skipped_sites as svc

router = APIRouter()


@router.get("", response_model=list[SkippedSiteOut])
async def list_sites(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SkippedSiteOut]:
    rows = await svc.list_sites(db, user.id)
    return [SkippedSiteOut.model_validate(r) for r in rows]


@router.post("", response_model=SkippedSiteAdded, status_code=201)
async def add_site(
    data: SkippedSiteCreate,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SkippedSiteAdded:
    """400 when it isn't a site or the list is full; 409 ``needs_confirm`` for
    a site Claude Scout searches, until ``confirm`` is true; 200 when it was on
    the list already."""
    site, new = await svc.add(db, user.id, data.site, confirm=data.confirm)
    await db.commit()
    if not new:
        response.status_code = 200
    return SkippedSiteAdded(id=site.id, host=site.host, already=not new)


@router.get("/suggestions", response_model=list[SiteSuggestion])
async def suggestions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SiteSuggestion]:
    return [SiteSuggestion(**s) for s in await svc.suggestions(db, user.id)]


@router.delete("/{site_id}", status_code=204)
async def remove_site(
    site_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.remove(db, user.id, site_id)
    await db.commit()
