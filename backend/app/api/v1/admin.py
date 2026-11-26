"""Admin dashboard endpoints (US6 — Admin Dashboard)."""

import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import require_admin
from app.models.user import User
from app.schemas.apply import ProblemStatusIn
from app.schemas.user import AdminUserRow, AdminUserUpdate, AllowancesIn, UserProfile
from app.services import admin_service, allowance, apply_problems
from app.services.users import soft_delete_user

router = APIRouter()


async def _get_active_user_or_404(db: AsyncSession, user_id: uuid.UUID) -> User:
    """Load a non-deleted user by id, or raise 404."""
    target = await db.scalar(
        select(User).where(User.id == user_id, User.deleted_at.is_(None))
    )
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    return target


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


@router.get("/users", response_model=list[AdminUserRow])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserRow]:
    offset = (page - 1) * page_size
    result = await db.execute(
        select(User)
        .where(User.deleted_at.is_(None))
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    # Setup progress, Job Catcher, last active and use (spec 019 part C).
    return await admin_service.user_rows(db, list(result.scalars().all()))


@router.patch("/users/{user_id}", response_model=UserProfile)
async def update_user_role(
    user_id: uuid.UUID,
    data: AdminUserUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    """Promote/demote another user. An admin cannot change their own role
    (guards against accidentally locking the last admin out of the console)."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    target = await _get_active_user_or_404(db, user_id)
    target.role = data.role
    await db.commit()
    await db.refresh(target)
    return UserProfile.model_validate(target)


@router.delete("/users/{user_id}", status_code=204)
async def remove_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete another user's account (moderation). Reuses the same
    soft-delete + 30-day purge path as self-service deletion. Admins must use
    account settings to delete their own account, not this endpoint."""
    if user_id == admin.id:
        raise HTTPException(
            status_code=400,
            detail="Use account settings to delete your own account",
        )
    target = await _get_active_user_or_404(db, user_id)
    await soft_delete_user(db, target)


@router.get("/allowances")
async def get_allowances(
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """The daily free allowances and the shared live-search month (spec 019)."""
    return await allowance.limits(db)


@router.put("/allowances")
async def put_allowances(
    data: AllowancesIn,
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Change them; the new numbers apply from each person's next use."""
    current = await allowance.limits(db)
    try:
        return await allowance.save_limits(
            db, current | data.model_dump(exclude_none=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/apply-problems")
async def get_apply_problems(
    limit: int = Query(300, ge=1, le=300),
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Bug reports: what Claude ran into during applications, everyone's,
    newest first (spec 030), so the developer can fix it."""
    return await apply_problems.admin_list(db, limit)


@router.patch("/apply-problems/{run_id}/{problem_id}")
async def set_apply_problem(
    run_id: uuid.UUID,
    problem_id: str = Path(max_length=20),
    data: ProblemStatusIn = Body(...),
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark a bug report open, fixed or ignored."""
    try:
        out = await apply_problems.set_status(db, run_id, problem_id, data.status)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.commit()
    return out
