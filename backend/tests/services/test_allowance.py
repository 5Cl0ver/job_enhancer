"""Fair use of the shared free services (spec 019 part C, research R9).
Invented accounts only."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.usage import AppSetting, UsageCounter
from app.models.user import User
from app.services import allowance

pytestmark = pytest.mark.asyncio

# 2026-11-24 23:30 Pacific is 2026-11-25 07:30 UTC.
LATE = datetime(2026, 11, 25, 7, 30, tzinfo=UTC)


async def _set(db: AsyncSession, **values):
    db.add(AppSetting(key="allowances", value=values))
    await db.commit()


def test_periods_and_reset_are_pacific():
    assert allowance.period_for("live_search", LATE) == "2026-11-24"
    assert allowance.period_for("jsearch_month", LATE) == "2026-11"
    assert allowance.resets_at(LATE) == datetime(2026, 11, 25, 8, 0, tzinfo=UTC)


async def test_spend_until_the_limit_then_nothing_is_spent(
    db_session: AsyncSession, test_user: User
):
    await _set(db_session, ai_document=2)
    await allowance.spend(db_session, test_user, "ai_document")
    await allowance.spend(db_session, test_user, "ai_document")
    with pytest.raises(allowance.AllowanceExceeded) as over:
        await allowance.spend(db_session, test_user, "ai_document")
    assert over.value.detail()["code"] == "ALLOWANCE"
    assert over.value.detail()["limit"] == 2
    assert "my_claude" in over.value.detail()["alternatives"]
    out = await allowance.usage(db_session, test_user)
    assert out["kinds"]["ai_document"] | {"on": None} == {
        "used": 2,
        "limit": 2,
        "left": 0,
        "on": None,
    }


async def test_a_new_day_starts_fresh(db_session: AsyncSession, test_user: User):
    await _set(db_session, live_search=1)
    await allowance.spend(db_session, test_user, "live_search", LATE)
    with pytest.raises(allowance.AllowanceExceeded):
        await allowance.spend(db_session, test_user, "live_search", LATE)
    next_day = datetime(2026, 11, 25, 9, 0, tzinfo=UTC)
    await allowance.spend(db_session, test_user, "live_search", next_day)


async def test_admin_is_counted_never_stopped(
    db_session: AsyncSession, admin_user: User
):
    await _set(db_session, ai_document=0)
    for _ in range(3):
        await allowance.spend(db_session, admin_user, "ai_document")
    out = await allowance.usage(db_session, admin_user)
    assert out["exempt"] is True and out["kinds"]["ai_document"]["used"] == 3


async def test_a_timeout_is_not_given_back(db_session: AsyncSession, test_user: User):
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        async with allowance.spending(db_session, test_user, "ai_document"):
            raise HTTPException(503, "AI generation timed out — the model is busy.")
    out = await allowance.usage(db_session, test_user)
    assert out["kinds"]["ai_document"]["used"] == 1


async def test_a_failed_call_gives_it_back(db_session: AsyncSession, test_user: User):
    with pytest.raises(RuntimeError):
        async with allowance.spending(db_session, test_user, "ai_document"):
            raise RuntimeError("model down")
    out = await allowance.usage(db_session, test_user)
    assert out["kinds"]["ai_document"]["used"] == 0
    # Never below zero.
    period = allowance.period_for("ai_document")
    await allowance.refund(db_session, test_user.id, "ai_document", period)
    count = await db_session.scalar(select(UsageCounter.count))
    assert count == 0


async def test_jsearch_keeps_the_owners_reserve(
    db_session: AsyncSession, test_user: User, admin_user: User
):
    await _set(db_session, jsearch_month_cap=3, jsearch_owner_reserve=1)
    assert await allowance.jsearch_take(db_session, test_user)
    assert await allowance.jsearch_take(db_session, test_user)
    assert not await allowance.jsearch_take(db_session, test_user)  # reserve left
    assert await allowance.jsearch_take(db_session, admin_user)  # the owner's
    assert not await allowance.jsearch_take(db_session, admin_user)  # the cap
    shared = await db_session.scalar(
        select(UsageCounter.count).where(UsageCounter.user_id.is_(None))
    )
    mine = await db_session.scalar(
        select(UsageCounter.count).where(UsageCounter.user_id == test_user.id)
    )
    assert shared == 3
    assert mine == 2  # the refused third one isn't counted against them


async def test_one_person_cant_take_everyones_jsearch_month(
    db_session: AsyncSession, test_user: User
):
    await _set(db_session, jsearch_person_month=2)
    assert await allowance.jsearch_take(db_session, test_user)
    assert await allowance.jsearch_take(db_session, test_user)
    assert not await allowance.jsearch_take(db_session, test_user)
    # A scheduled job is not a person: it may use the owner's part.
    assert await allowance.jsearch_take(db_session, allowance.SYSTEM)


def test_settings_are_validated():
    assert allowance.validate({"live_search": 3})["live_search"] == 3
    for bad in (
        {"live_search": -1},
        {"live_search": 10_001},
        {"live_search": True},
        {"live_search": "5"},
        {"surprise": 1},
        {"jsearch_month_cap": 10, "jsearch_owner_reserve": 11},
        {"jsearch_month_cap": 10, "jsearch_person_month": 11},
    ):
        with pytest.raises(ValueError):
            allowance.validate(bad)


async def test_broken_stored_settings_fall_back(db_session: AsyncSession):
    await _set(db_session, ai_document="lots", live_search=-5, ai_read=7)
    cfg = await allowance.limits(db_session)
    assert cfg["ai_document"] == 10 and cfg["live_search"] == 5 and cfg["ai_read"] == 7


async def test_ai_kinds_are_off_while_ai_is_paused(
    db_session: AsyncSession, test_user: User
):
    out = await allowance.usage(db_session, test_user)
    assert out["kinds"]["live_search"]["on"] is True
    assert out["kinds"]["ai_document"]["on"] is False


async def test_old_daily_counters_are_purged(engine, test_user: User):
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with maker() as db:
        db.add(
            UsageCounter(
                user_id=test_user.id, kind="live_search", period="2024-01-01", count=1
            )
        )
        db.add(
            UsageCounter(
                user_id=test_user.id, kind="live_search", period="2026-11-01", count=1
            )
        )
        db.add(
            UsageCounter(user_id=None, kind="jsearch_month", period="2024-01", count=9)
        )
        await db.commit()
    assert await allowance.purge_old_usage(maker, LATE) == 1
    async with maker() as db:
        assert len((await db.scalars(select(UsageCounter))).all()) == 2
