"""Fair use of the shared free services (spec 019 part C, research R9).

Each person gets a daily allowance of each kind; the day resets at midnight
US-Pacific. The owner (admin) is counted but never stopped. Live searches also
spend the one shared JSearch month (about 200 requests for everyone), and
everyone but the owner stops before the owner's reserve.

Spend *before* the paid call (two requests at the edge can't both get
through), refund if it then fails. Over the allowance nothing is spent.
"""

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.models.usage import AppSetting, UsageCounter
from app.models.user import User

logger = logging.getLogger(__name__)

PACIFIC = ZoneInfo("America/Los_Angeles")
DAILY_KINDS = ("ai_document", "ai_read", "ai_autofill", "live_search")
JSEARCH = "jsearch_month"
# One person's share of the shared JSearch month, so two people can't use it
# all up for everyone else.
JSEARCH_PERSON = "jsearch_person_month"
SETTING_KEY = "allowances"
DEFAULTS: dict[str, int] = {
    "ai_document": 10,
    "ai_read": 5,
    "ai_autofill": 100,
    "live_search": 5,
    "jsearch_month_cap": 200,
    "jsearch_owner_reserve": 40,
    "jsearch_person_month": 30,
}
MAX_VALUE = 10_000

_NAMES = {
    "ai_document": ("free AI documents", ["my_claude"]),
    "ai_read": ("free résumé reads", []),
    "ai_autofill": ("free AI autofill helps", []),
    "live_search": ("live searches", []),
}


class AllowanceExceeded(Exception):
    """Over today's allowance: nothing was spent."""

    def __init__(self, kind: str, limit: int, now: datetime | None = None):
        self.kind = kind
        self.limit = limit
        self.resets_at = resets_at(now)
        what, self.alternatives = _NAMES.get(kind, (kind, []))
        self.message = (
            f"You've used today's {limit} {what}. They come back at midnight (Pacific)."
        )
        super().__init__(self.message)

    def detail(self) -> dict:
        return {
            "code": "ALLOWANCE",
            "kind": self.kind,
            "limit": self.limit,
            "resets_at": self.resets_at.isoformat(),
            "message": self.message,
            "alternatives": self.alternatives,
        }


def _now(now: datetime | None = None) -> datetime:
    return now or datetime.now(UTC)


def period_for(kind: str, now: datetime | None = None) -> str:
    """A Pacific day ("2026-11-24"), or the Pacific month for the shared row."""
    local = _now(now).astimezone(PACIFIC)
    if kind in (JSEARCH, JSEARCH_PERSON):
        return local.strftime("%Y-%m")
    return local.date().isoformat()


def resets_at(now: datetime | None = None) -> datetime:
    """The next midnight in US-Pacific, in UTC."""
    local = _now(now).astimezone(PACIFIC)
    midnight = datetime.combine(local.date() + timedelta(days=1), time(), PACIFIC)
    return midnight.astimezone(UTC)


def validate(values: dict) -> dict[str, int]:
    """Owner input → a full, safe allowances dict, or ValueError in plain words."""
    unknown = set(values) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"Unknown setting: {', '.join(sorted(unknown))}")
    out = dict(DEFAULTS)
    for key, value in values.items():
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{key} must be a whole number")
        if not 0 <= value <= MAX_VALUE:
            raise ValueError(f"{key} must be between 0 and {MAX_VALUE}")
        out[key] = value
    if out["jsearch_owner_reserve"] > out["jsearch_month_cap"]:
        raise ValueError("The owner's reserve can't be more than the monthly cap")
    if out["jsearch_person_month"] > out["jsearch_month_cap"]:
        raise ValueError("One person's share can't be more than the monthly cap")
    return out


async def limits(db: AsyncSession) -> dict[str, int]:
    """The allowance numbers: the owner's settings over the defaults. A stored
    value that's missing or broken falls back to its default."""
    row = await db.get(AppSetting, SETTING_KEY)
    out = dict(DEFAULTS)
    if row and isinstance(row.value, dict):
        for key, value in row.value.items():
            if (
                key in DEFAULTS
                and isinstance(value, int)
                and not isinstance(value, bool)
                and 0 <= value <= MAX_VALUE
            ):
                out[key] = value
    return out


async def save_limits(db: AsyncSession, values: dict) -> dict[str, int]:
    clean = validate(values)
    row = await db.get(AppSetting, SETTING_KEY)
    if row is None:
        db.add(AppSetting(key=SETTING_KEY, value=clean))
    else:
        row.value = clean
    await db.commit()
    return clean


def _who(user_id: uuid.UUID | None):
    return (
        UsageCounter.user_id.is_(None)
        if user_id is None
        else UsageCounter.user_id == user_id
    )


async def _bump(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    kind: str,
    period: str,
    limit: int | None,
    _retry: bool = True,
) -> bool:
    """Add one if under ``limit`` (None: no limit). Atomic per row: the
    conditional UPDATE can't take two requests past the limit."""
    where = (_who(user_id), UsageCounter.kind == kind, UsageCounter.period == period)
    stmt = (
        update(UsageCounter)
        .where(*where)
        .values(count=UsageCounter.count + 1)
        .execution_options(synchronize_session=False)
    )
    if limit is not None:
        stmt = stmt.where(UsageCounter.count < limit)
    if (await db.execute(stmt)).rowcount:
        return True
    if await db.scalar(select(UsageCounter.id).where(*where)) is not None:
        return False  # the row is there and at the limit
    if limit is not None and limit <= 0:
        return False
    try:
        async with db.begin_nested():
            db.add(UsageCounter(user_id=user_id, kind=kind, period=period, count=1))
            await db.flush()
        return True
    except IntegrityError:  # someone else made the row first: count on it
        if not _retry:
            return False
        return await _bump(db, user_id, kind, period, limit, _retry=False)


async def spend(
    db: AsyncSession, user: User, kind: str, now: datetime | None = None
) -> str:
    """Count one use of ``kind`` today; raise AllowanceExceeded when over (and
    count nothing). Admins are counted, never stopped. Returns the period, for
    ``refund``. Commits."""
    period = period_for(kind, now)
    limit = (await limits(db))[kind]
    exempt = user.role == "admin"
    ok = await _bump(db, user.id, kind, period, None if exempt else limit)
    await db.commit()
    if not ok:
        raise AllowanceExceeded(kind, limit, now)
    return period


async def refund(db: AsyncSession, user_id: uuid.UUID, kind: str, period: str) -> None:
    """Give one back (the paid call failed). Never below zero; never raises."""
    try:
        await db.execute(
            update(UsageCounter)
            .where(
                _who(user_id),
                UsageCounter.kind == kind,
                UsageCounter.period == period,
                UsageCounter.count > 0,
            )
            .values(count=UsageCounter.count - 1)
            .execution_options(synchronize_session=False)
        )
        await db.commit()
    except Exception:
        logger.warning("Allowance refund failed for %s", kind)
        with suppress(Exception):
            await db.rollback()


@asynccontextmanager
async def spending(db: AsyncSession, user: User, kind: str) -> AsyncIterator[None]:
    """``async with spending(db, user, "ai_document"): <paid call>``: spent
    first, given back if the call fails."""
    user_id = user.id  # read now: a rollback expires the user
    period = await spend(db, user, kind)
    try:
        yield
    except BaseException as exc:
        with suppress(Exception):
            await db.rollback()
        # A timeout may still have been done (and paid for) by the provider.
        if not _timed_out(exc):
            await refund(db, user_id, kind, period)
        raise


def _timed_out(exc: BaseException) -> bool:
    return isinstance(exc, TimeoutError) or "timed out" in str(
        getattr(exc, "detail", "")
    )


class _System:
    """A scheduled job, not a person: may use the owner's part of JSearch."""


SYSTEM = _System()


async def jsearch_take(db: AsyncSession, who: "User | _System") -> bool:
    """One request from the shared JSearch month, if ``who`` may: each person
    up to their own monthly share, and everyone stops at cap minus the owner's
    reserve; the owner and ``SYSTEM`` go to the cap. Commits."""
    cfg = await limits(db)
    cap = cfg["jsearch_month_cap"]
    owner = isinstance(who, _System) or who.role == "admin"
    month = period_for(JSEARCH)
    if not owner and not await _bump(
        db, who.id, JSEARCH_PERSON, month, cfg["jsearch_person_month"]
    ):
        await db.commit()
        return False
    limit = cap if owner else max(0, cap - cfg["jsearch_owner_reserve"])
    ok = await _bump(db, None, JSEARCH, month, limit)
    if not ok and not owner:  # the shared month is full: give their share back
        await db.execute(
            update(UsageCounter)
            .where(
                _who(who.id),
                UsageCounter.kind == JSEARCH_PERSON,
                UsageCounter.period == month,
                UsageCounter.count > 0,
            )
            .values(count=UsageCounter.count - 1)
            .execution_options(synchronize_session=False)
        )
    await db.commit()
    return ok


AUTO_FETCH = "auto_fetch"
AUTO_FETCH_PER_DAY = 30


async def take_auto_fetch(db: AsyncSession, user: User) -> bool:
    """One of today's automatic fetches for a search with nothing here yet:
    free for the person, but each one spends the job boards' daily quotas, so
    at most 30 a day each (the owner is counted, never stopped). Commits."""
    ok = await _bump(
        db,
        user.id,
        AUTO_FETCH,
        period_for(AUTO_FETCH),
        None if user.role == "admin" else AUTO_FETCH_PER_DAY,
    )
    await db.commit()
    return ok


async def usage_shared(db: AsyncSession, now: datetime | None = None) -> dict:
    """The shared JSearch month so far (owner only)."""
    cfg = await limits(db)
    used = await db.scalar(
        select(UsageCounter.count).where(
            UsageCounter.user_id.is_(None),
            UsageCounter.kind == JSEARCH,
            UsageCounter.period == period_for(JSEARCH, now),
        )
    )
    return {
        "used": used or 0,
        "cap": cfg["jsearch_month_cap"],
        "reserve": cfg["jsearch_owner_reserve"],
    }


async def usage(db: AsyncSession, user: User, now: datetime | None = None) -> dict:
    """What's left today, for the "N of M left today" labels (GET /v1/usage)."""
    cfg = await limits(db)
    day = period_for("ai_document", now)
    rows = dict(
        (
            await db.execute(
                select(UsageCounter.kind, UsageCounter.count).where(
                    UsageCounter.user_id == user.id, UsageCounter.period == day
                )
            )
        ).all()
    )
    on = kinds_on()
    return {
        "exempt": user.role == "admin",
        "resets_at": resets_at(now).isoformat(),
        "kinds": {
            kind: {
                "used": rows.get(kind, 0),
                "limit": cfg[kind],
                "left": max(0, cfg[kind] - rows.get(kind, 0)),
                "on": on[kind],
            }
            for kind in DAILY_KINDS
        },
        # The shared month's numbers are for the owner only.
        "shared": (
            {JSEARCH: await usage_shared(db, now)} if user.role == "admin" else {}
        ),
    }


def kinds_on() -> dict[str, bool]:
    """Which kinds are in use right now. AI is paused (spec 019 R13), so only
    live searches show a "left today" label until the AI phase."""
    return {
        "ai_document": settings.ai_writing_on,
        "ai_read": settings.ai_in_profile_fill,
        "ai_autofill": settings.ai_writing_on,
        "live_search": True,
    }


async def usage_by_user(
    db: AsyncSession, user_ids: list[uuid.UUID], now: datetime | None = None
) -> tuple[dict, dict]:
    """Per user: {kind: count} today, and {kind: total} this Pacific month
    (the owner's user list)."""
    if not user_ids:
        return {}, {}
    day = period_for("ai_document", now)
    month = period_for(JSEARCH, now)
    today: dict = {}
    for uid, kind, count in await db.execute(
        select(UsageCounter.user_id, UsageCounter.kind, UsageCounter.count).where(
            UsageCounter.user_id.in_(user_ids), UsageCounter.period == day
        )
    ):
        today.setdefault(uid, {})[kind] = count
    this_month: dict = {}
    for uid, kind, total in await db.execute(
        select(UsageCounter.user_id, UsageCounter.kind, func.sum(UsageCounter.count))
        .where(
            UsageCounter.user_id.in_(user_ids),
            # the month's days, and the monthly rows (each person's JSearch)
            UsageCounter.period.like(f"{month}-%") | (UsageCounter.period == month),
        )
        .group_by(UsageCounter.user_id, UsageCounter.kind)
    ):
        this_month.setdefault(uid, {})[kind] = int(total or 0)
    return today, this_month


async def purge_old_usage(
    session_factory: async_sessionmaker[AsyncSession], now: datetime | None = None
) -> int:
    """Daily counters older than 400 days go (a year of history is kept). Runs
    on the scheduler, never on a request."""
    cutoff = (_now(now).astimezone(PACIFIC).date() - timedelta(days=400)).isoformat()
    async with session_factory() as db:
        result = await db.execute(
            delete(UsageCounter).where(
                UsageCounter.kind != JSEARCH, UsageCounter.period < cutoff
            )
        )
        await db.commit()
        return result.rowcount or 0
