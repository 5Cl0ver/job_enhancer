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
        # The error's type only: its text can carry the request URL and its key.
        return ServiceStatus(name=name, status="down", detail=type(exc).__name__)


_EXTERNAL_EVERY_S = 600
_external: tuple[float, list[ServiceStatus]] | None = None


async def _jsearch_status(db: AsyncSession) -> ServiceStatus:
    from app.services import allowance

    if not settings.jsearch_api_key:
        return ServiceStatus(name="JSearch", status="down", detail="No key set")
    shared = await allowance.usage_shared(db)
    return ServiceStatus(
        name="JSearch",
        status="healthy" if shared["used"] < shared["cap"] else "degraded",
        detail=f"{shared['used']} of {shared['cap']} used this month (not pinged)",
    )


async def check_service_health(
    db: AsyncSession, ping_external: bool = True
) -> list[ServiceStatus]:
    """The database (always), NVIDIA and Adzuna (pinged at most every 10
    minutes; with ``ping_external`` off, only a fresh answer already in hand
    is given, else they're left out) and JSearch (counted, never pinged)."""
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

    # External APIs, checked at most every 10 minutes (each Adzuna check spends
    # one of its daily calls). JSearch is never pinged: every request costs one
    # of the ~200 shared a month (spec 019), so it shows this month's count.
    global _external
    fresh = _external is not None and (
        time.monotonic() - _external[0] <= _EXTERNAL_EVERY_S
    )
    if fresh:
        statuses.extend(_external[1])
    elif ping_external:
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
        )
        # Only a clean bill of health is kept: a problem is checked again next time.
        _external = (
            (time.monotonic(), list(checks))
            if all(c.status == "healthy" for c in checks)
            else None
        )
        statuses.extend(checks)
    statuses.append(await _jsearch_status(db))
    return statuses


# The pinged services: the watch asks them at most every 6 hours (each Adzuna
# check spends one of its daily calls), and again on the next run while one
# looked down, to be sure or to see it back.
_PINGED = ("NVIDIA NIM", "Adzuna")
_WATCH_PING_EVERY_S = 6 * 3600
_watch_pinged_at: float | None = None
# One bad reading isn't an outage (a timeout happens): it takes 2 in a row.
DOWN_READINGS = 2
# Each service at the last watch: {"state": "up"|"down", "streak": downs in
# a row, "noted": its outage is in Bugs & ideas}. After a restart it's
# empty, and the outage reports themselves say what was down.
_health_last: dict[str, dict] = {}


async def health_watch(session_factory) -> None:
    """Every 15 minutes (spec 032): the health checks, and a service down 2
    readings in a row is one caught report per outage; coming back adds a
    line to its history. The database is checked every time; NVIDIA and
    Adzuna at most every 6 hours (sooner only to confirm a bad reading);
    JSearch is only counted, never pinged. Never raises."""
    from app.services import bug_reports

    global _watch_pinged_at
    try:
        suspect = any(
            (_health_last.get(name) or {}).get("state") == "down" for name in _PINGED
        )
        ping = (
            suspect
            or _watch_pinged_at is None
            or time.monotonic() - _watch_pinged_at >= _WATCH_PING_EVERY_S
        )
        now: dict[str, dict] = {}
        async with session_factory() as db:
            statuses = await check_service_health(db, ping_external=ping)
            for s in statuses:
                down = s.status == "down"
                before = _health_last.get(s.name) or {}
                streak = before.get("streak", 0) + 1 if down else 0
                noted = bool(before.get("noted")) and down
                try:
                    async with db.begin_nested():
                        if down and streak >= DOWN_READINGS and not noted:
                            if not await bug_reports.outage_open(db, s.name):
                                await bug_reports.service_down(db, s.name, s.detail)
                            noted = True
                        elif not down and before.get("state") != "up":
                            # Up again (or first look since a restart).
                            if await bug_reports.outage_open(db, s.name):
                                await bug_reports.service_up(db, s.name)
                except Exception:  # noqa: BLE001 — never report the reporting
                    logger.warning("Health watch: %s not noted", s.name, exc_info=True)
                    continue
                now[s.name] = {
                    "state": "down" if down else "up",
                    "streak": streak,
                    "noted": noted,
                }
            await db.commit()
        # Only once it's kept: a failed write is tried again next time.
        _health_last.update(now)
        if ping:
            _watch_pinged_at = time.monotonic()
    except Exception:  # noqa: BLE001
        logger.warning("Health watch failed", exc_info=True)


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
