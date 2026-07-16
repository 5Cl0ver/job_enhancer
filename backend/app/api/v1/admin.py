"""Admin dashboard endpoints (US6 — Admin Dashboard)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import require_admin
from app.models.user import User
from app.schemas.user import UserProfile
from app.services import admin_service

router = APIRouter()


@router.get("/stats", response_model=admin_service.PlatformStats)
async def get_stats(
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> admin_service.PlatformStats:
    return await admin_service.get_platform_stats(db)


@router.get("/health", response_model=list[admin_service.ServiceStatus])
async def get_health(
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[admin_service.ServiceStatus]:
    return await admin_service.check_service_health(db)


@router.get("/users", response_model=list[UserProfile])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UserProfile]:
    offset = (page - 1) * page_size
    result = await db.execute(
        select(User)
        .where(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    return [UserProfile.model_validate(u) for u in result.scalars().all()]
