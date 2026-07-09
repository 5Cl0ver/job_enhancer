"""Admin service — platform statistics and service health checks."""

import logging
import time
from datetime import datetime, timedelta, timezone

import httpx
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User

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
    now = datetime.now(tz=timezone.utc)
    day_7 = now - timedelta(days=7)
    day_30 = now - timedelta(days=30)

    total_users = (await db.scalar(select(func.count()).select_from(User))) or 0
    active_7d = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.updated_at >= day_7, User.deleted_at.is_(None))
        )
    ) or 0
    active_30d = (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.updated_at >= day_30, User.deleted_at.is_(None))
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
        signups_by_day.append(DailySignup(date=day_start.date().isoformat(), count=count))

    return PlatformStats(
        total_users=total_users,
        active_7d=active_7d,
        active_30d=active_30d,
        new_7d=new_7d,
        signups_by_day=signups_by_day,
    )


async def _check_endpoint(name: str, url: str, headers: dict | None = None) -> ServiceStatus:
    try:
        start = time.monotonic()
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=headers or {}, timeout=_HTTP_TIMEOUT)
        latency_ms = int((time.monotonic() - start) * 1000)
        if r.status_code < 500:
            return ServiceStatus(name=name, status="healthy", latency_ms=latency_ms)
        return ServiceStatus(
            name=name, status="degraded", latency_ms=latency_ms, detail=f"HTTP {r.status_code}"
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
        statuses.append(ServiceStatus(name="Database", status="healthy", latency_ms=latency_ms))
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
