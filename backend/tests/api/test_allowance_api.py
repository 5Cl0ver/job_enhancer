"""Fair use over HTTP and the owner's view (spec 019 part C). Invented data."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.middleware.auth import touch_active
from app.models.extension import ExtensionInstall
from app.models.usage import AppSetting, UsageCounter
from app.models.user import User
from app.services import allowance, job_search, releases

pytestmark = pytest.mark.asyncio


async def _set(db: AsyncSession, **values):
    db.add(AppSetting(key="allowances", value=values))
    await db.commit()


async def _resume(client: AsyncClient) -> str:
    with patch(
        "app.api.v1.ai.resume_parser.parse_resume",
        new=AsyncMock(return_value="Base resume text"),
    ):
        r = await client.post(
            "/v1/ai/resumes",
            files={"file": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
    return r.json()["id"]


async def test_usage_shows_whats_left(client: AsyncClient):
    r = await client.get("/v1/usage")
    assert r.status_code == 200
    body = r.json()
    assert body["exempt"] is False
    assert body["kinds"]["live_search"] == {
        "used": 0,
        "limit": 5,
        "left": 5,
        "on": True,
    }
    assert body["shared"]["jsearch_month"] == {"used": 0, "cap": 200, "reserve": 40}


async def test_over_the_ai_allowance_is_a_friendly_429_and_nothing_spent(
    client: AsyncClient, db_session: AsyncSession
):
    await _set(db_session, ai_document=1)
    resume_id = await _resume(client)
    body = {"resume_id": resume_id, "document_type": "cover_letter"}
    with patch(
        "app.api.v1.ai.ai_service.generate_cover_letter",
        new=AsyncMock(return_value=("Dear Hiring Team", "m", 10)),
    ):
        assert (await client.post("/v1/ai/generate", json=body)).status_code == 201
        over = await client.post("/v1/ai/generate", json=body)
    assert over.status_code == 429
    detail = over.json()["detail"]
    assert detail["code"] == "ALLOWANCE" and detail["kind"] == "ai_document"
    assert "midnight (Pacific)" in detail["message"]
    used = (await client.get("/v1/usage")).json()["kinds"]["ai_document"]["used"]
    assert used == 1


async def test_a_failed_document_is_given_back(
    client: AsyncClient, db_session: AsyncSession
):
    resume_id = await _resume(client)
    with (
        patch(
            "app.api.v1.ai.ai_service.generate_cover_letter",
            new=AsyncMock(side_effect=RuntimeError("model gone")),
        ),
        pytest.raises(RuntimeError),
    ):  # the test client re-raises the 500
        await client.post(
            "/v1/ai/generate",
            json={"resume_id": resume_id, "document_type": "cover_letter"},
        )
    used = (await client.get("/v1/usage")).json()["kinds"]["ai_document"]["used"]
    assert used == 0


async def test_over_live_searches_falls_back_to_the_pool(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    await _set(db_session, live_search=1)
    fetched = []

    async def fake_ingest(db, q, location, page, page_size, sources, user=None):
        fetched.append(q)

    monkeypatch.setattr(job_search, "_ingest_live", fake_ingest)
    first = await client.get("/v1/jobs/", params={"q": "analyst", "refresh": "true"})
    assert first.status_code == 200 and first.json()["live"] is True
    second = await client.get("/v1/jobs/", params={"q": "analyst", "refresh": "true"})
    assert second.status_code == 200
    assert second.json()["live"] is False
    assert "live searches" in second.json()["note"]
    assert fetched == ["analyst"]


async def test_jsearch_is_skipped_past_the_shared_limit(
    db_session: AsyncSession, test_user: User, monkeypatch
):
    await _set(db_session, jsearch_month_cap=1, jsearch_owner_reserve=1)
    monkeypatch.setattr(job_search.settings, "jsearch_api_key", "k")
    seen = []
    monkeypatch.setattr(job_search, "get_sources", lambda s: seen.append(set(s)) or [])
    await job_search._ingest_live(
        db_session, "q", None, 1, 20, frozenset({"jsearch", "adzuna"}), test_user
    )
    assert seen == [{"adzuna"}]


async def test_admin_allowances_round_trip_and_validation(
    admin_client: AsyncClient,
):
    r = await admin_client.get("/v1/admin/allowances")
    assert r.json()["live_search"] == 5
    r = await admin_client.put("/v1/admin/allowances", json={"live_search": 2})
    assert r.status_code == 200 and r.json()["live_search"] == 2
    assert (await admin_client.get("/v1/admin/allowances")).json()["live_search"] == 2
    for bad in (
        {"live_search": -1},
        {"live_search": "5"},
        {"surprise": 1},
        {"jsearch_owner_reserve": 500},
    ):
        assert (
            await admin_client.put("/v1/admin/allowances", json=bad)
        ).status_code == 422


async def test_allowances_are_admin_only(client: AsyncClient):
    assert (await client.get("/v1/admin/allowances")).status_code == 403
    assert (
        await client.put("/v1/admin/allowances", json={"live_search": 99})
    ).status_code == 403


async def test_admin_user_list_shows_setup_job_catcher_and_use(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    monkeypatch,
):
    async def fake_latest():
        return releases._empty() | {"version": "0.38.0"}

    monkeypatch.setattr(releases, "latest", fake_latest)
    db_session.add(
        ExtensionInstall(
            user_id=test_user.id, install_id="install-abc123", version="0.37.0"
        )
    )
    db_session.add(
        UsageCounter(
            user_id=test_user.id,
            kind="live_search",
            period=allowance.period_for("live_search"),
            count=2,
        )
    )
    await db_session.commit()
    rows = (await admin_client.get("/v1/admin/users")).json()
    row = next(r for r in rows if r["email"] == test_user.email)
    assert row["onboarding"]["job_catcher"] is True
    assert row["onboarding"]["resume"] is False
    assert row["job_catcher"]["version"] == "0.37.0"
    assert row["job_catcher"]["outdated"] is True
    assert row["usage_today"] == {"live_search": 2}
    assert row["usage_month"] == {"live_search": 2}


async def test_last_active_is_noted_at_most_every_15_minutes(
    db_session: AsyncSession, test_user: User
):
    await touch_active(db_session, test_user)
    first = test_user.last_active_at
    assert first is not None
    await touch_active(db_session, test_user)
    assert test_user.last_active_at == first  # within 15 minutes: no write
    test_user.last_active_at = datetime.now(UTC) - timedelta(minutes=20)
    await touch_active(db_session, test_user)
    assert test_user.last_active_at > first


async def test_export_includes_usage(client: AsyncClient, db_session: AsyncSession):
    await client.get("/v1/jobs/", params={"q": "zz-nothing"})  # empty pool: live
    export = json.loads((await client.get("/v1/users/me/export")).content)
    assert export["usage"][0]["kind"] == "live_search"
    rows = (await db_session.scalars(select(UsageCounter))).all()
    assert rows


async def test_usage_needs_sign_in(anon_client: AsyncClient):
    assert (await anon_client.get("/v1/usage")).status_code == 401
