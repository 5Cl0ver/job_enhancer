"""Admin service — platform statistics and service health checks."""

import logging
import time
from datetime import UTC, datetime, timedelta

import httpx
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User
from app.schemas.user import AdminJobCatcher, AdminUserRow, UserProfile

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 5.0


class ServiceStatus(BaseModel):
    name: str
    status: str  # healthy | degraded | down
    latency_ms: int | None = None
    detail: str | None = None


class DailySignup(BaseModel):
    date: str
    count: int


class PlatformStats(BaseModel):
    total_users: int
    active_7d: int
    active_30d: int
    new_7d: int
    signups_by_day: list[DailySignup]  # last 30 days


async def get_platform_stats(db: AsyncSession) -> PlatformStats:
    now = datetime.now(tz=UTC)
    day_7 = now - timedelta(days=7)
    day_30 = now - timedelta(days=30)

    total_users = (await db.scalar(select(func.count()).select_from(User))) or 0
    active_7d = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.last_active_at >= day_7, User.deleted_at.is_(None))
        )
    ) or 0
    active_30d = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.last_active_at >= day_30, User.deleted_at.is_(None))
        )
    ) or 0
    new_7d = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.created_at >= day_7, User.deleted_at.is_(None))
        )
    ) or 0

    signups_by_day: list[DailySignup] = []
    for days_back in range(29, -1, -1):
        day_start = now - timedelta(days=days_back + 1)
        day_end = now - timedelta(days=days_back)
        count = (
            await db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.created_at >= day_start, User.created_at < day_end)
            )
        ) or 0
        signups_by_day.append(
            DailySignup(date=day_start.date().isoformat(), count=count)
        )

    return PlatformStats(
        total_users=total_users,
        active_7d=active_7d,
        active_30d=active_30d,
        new_7d=new_7d,
        signups_by_day=signups_by_day,
    )


async def _check_endpoint(
    name: str, url: str, headers: dict | None = None
) -> ServiceStatus:
    try:
        start = time.monotonic()
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=headers or {}, timeout=_HTTP_TIMEOUT)
        latency_ms = int((time.monotonic() - start) * 1000)
        if r.status_code < 500:
            return ServiceStatus(name=name, status="healthy", latency_ms=latency_ms)
        return ServiceStatus(
            name=name,
            status="degraded",
            latency_ms=latency_ms,
            detail=f"HTTP {r.status_code}",
        )
    except Exception as exc:
        logger.warning("Health check failed for %s: %s", name, exc)
        return ServiceStatus(name=name, status="down", detail=str(exc))


async def check_service_health(db: AsyncSession) -> list[ServiceStatus]:
    statuses: list[ServiceStatus] = []

    # DB latency
    try:
        start = time.monotonic()
        await db.scalar(select(func.now()))
        latency_ms = int((time.monotonic() - start) * 1000)
        statuses.append(
            ServiceStatus(name="Database", status="healthy", latency_ms=latency_ms)
        )
    except Exception as exc:
        statuses.append(ServiceStatus(name="Database", status="down", detail=str(exc)))

    # External APIs (checked concurrently)
    import asyncio

    checks = await asyncio.gather(
        _check_endpoint(
            "NVIDIA NIM",
            "https://integrate.api.nvidia.com/v1/models",
            headers={"Authorization": f"Bearer {settings.nvidia_api_key}"},
        ),
        _check_endpoint(
            "Adzuna",
            f"https://api.adzuna.com/v1/api/jobs/us/search/1?app_id={settings.adzuna_app_id}&app_key={settings.adzuna_app_key}&results_per_page=1&what=python",
        ),
        _check_endpoint(
            "JSearch",
            "https://jsearch.p.rapidapi.com/search?query=test&num_pages=1",
            headers={
                "x-rapidapi-host": "jsearch.p.rapidapi.com",
                "x-rapidapi-key": settings.jsearch_api_key,
            },
        ),
    )
    statuses.extend(checks)
    return statuses


# --------------------------------------------------------------------------- #
# The owner's user list (spec 019 part C, US7)
# --------------------------------------------------------------------------- #


async def _users_with(db: AsyncSession, model, user_ids: list) -> set:
    return set(
        await db.scalars(
            select(model.user_id).where(model.user_id.in_(user_ids)).distinct()
        )
    )


async def user_rows(db: AsyncSession, users: list[User]) -> list[AdminUserRow]:
    """Each person's setup progress, Job Catcher version, real last activity
    and free-service use, in a few batched queries (one page of users)."""
    from app.models.email_account import EmailAccount
    from app.models.extension import ExtensionInstall
    from app.models.onboarding import UserOnboarding
    from app.models.resume import Resume
    from app.models.saved_job import SavedJob
    from app.services import allowance, releases

    ids = [u.id for u in users]
    if not ids:
        return []
    onboarding = {
        r.user_id: r
        for r in await db.scalars(
            select(UserOnboarding).where(UserOnboarding.user_id.in_(ids))
        )
    }
    with_resume = await _users_with(db, Resume, ids)
    with_job = await _users_with(db, SavedJob, ids)
    with_email = await _users_with(db, EmailAccount, ids)
    newest: dict = {}
    for install in await db.scalars(
        select(ExtensionInstall)
        .where(ExtensionInstall.user_id.in_(ids))
        .order_by(ExtensionInstall.last_seen_at.desc())
    ):
        newest.setdefault(install.user_id, install)
    latest = (await releases.latest()).get("version")
    today, month = await allowance.usage_by_user(db, ids)

    rows = []
    for u in users:
        ob = onboarding.get(u.id)
        jc = newest.get(u.id)
        rows.append(
            AdminUserRow(
                **UserProfile.model_validate(u).model_dump(),
                last_active_at=u.last_active_at,
                onboarding={
                    "welcome_done": bool(ob and ob.welcome_done_at),
                    "resume": u.id in with_resume,
                    "profile": bool(ob and ob.profile_reviewed_at),
                    "job_catcher": jc is not None,
                    "first_job": u.id in with_job,
                    "email": u.id in with_email,
                    "claude": bool((ob and ob.claude_seen_at) or u.claude_project_url),
                },
                job_catcher=(
                    AdminJobCatcher(
                        version=jc.version,
                        last_seen_at=jc.last_seen_at,
                        outdated=releases.is_older(jc.version, latest),
                    )
                    if jc
                    else None
                ),
                usage_today=today.get(u.id, {}),
                usage_month=month.get(u.id, {}),
            )
        )
    return rows
