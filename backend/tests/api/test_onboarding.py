"""Onboarding: the Welcome's progress and the Getting started checklist
(spec 019 part B). Invented data only."""

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.extension import ExtensionInstall
from app.models.job_listing import JobListing
from app.models.onboarding import UserOnboarding
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services import onboarding as svc

pytestmark = pytest.mark.asyncio


def _done(body: dict) -> dict[str, bool]:
    return {i["key"]: i["done"] for i in body["items"]}


async def test_a_new_account_starts_at_the_welcome(client: AsyncClient):
    r = await client.get("/v1/onboarding")
    assert r.status_code == 200
    body = r.json()
    assert body["welcome"] == {"step": 0, "done": False}
    assert body["checklist_hidden"] is False
    assert [i["key"] for i in body["items"]] == [
        "resume",
        "profile",
        "job_catcher",
        "first_job",
        "email",
        "claude",
    ]
    assert [i["required"] for i in body["items"]] == [True] * 4 + [False] * 2
    assert (body["required_done"], body["required_total"]) == (0, 4)


async def test_patch_moves_finishes_and_reopens_the_welcome(client: AsyncClient):
    r = await client.patch("/v1/onboarding", json={"welcome_step": 2})
    assert r.json()["welcome"] == {"step": 2, "done": False}
    for bad in ({"welcome_step": 99}, {"welcome_done": "yes"}, {"role": "admin"}):
        assert (await client.patch("/v1/onboarding", json=bad)).status_code == 422
    r = await client.patch("/v1/onboarding", json={"welcome_step": 4})
    assert r.json()["welcome"]["step"] == 4
    r = await client.patch("/v1/onboarding", json={"welcome_done": True})
    assert r.json()["welcome"]["done"] is True
    # Settings → Show the welcome again: back to the start.
    r = await client.patch("/v1/onboarding", json={"welcome_done": False})
    assert r.json()["welcome"] == {"step": 0, "done": False}


async def test_profile_reviewed_and_hidden_checklist_are_kept(client: AsyncClient):
    r = await client.patch(
        "/v1/onboarding", json={"profile_reviewed": True, "checklist_hidden": True}
    )
    body = r.json()
    assert _done(body)["profile"] is True
    assert body["checklist_hidden"] is True
    # Another device sees the same.
    again = (await client.get("/v1/onboarding")).json()
    assert again["checklist_hidden"] is True and _done(again)["profile"] is True


async def test_ticks_come_from_real_state(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    db_session.add(
        Resume(
            id=uuid.uuid4(),
            user_id=test_user.id,
            filename="wren.pdf",
            mime_type="application/pdf",
            file_size_bytes=4,
            file_data=b"%PDF",
            extracted_text="Wren Tester",
            is_active=True,
        )
    )
    db_session.add(
        ExtensionInstall(
            user_id=test_user.id, install_id="install-abc123", version="0.37.0"
        )
    )
    job = JobListing(
        id=uuid.uuid4(),
        external_id="manual_1",
        source="manual",
        title="Data Analyst",
        company="Tidewell Labs",
        location="Remote",
        apply_url="https://example.com/apply",
        content_hash="h1",
        title_normalized="data analyst",
        company_normalized="tidewell labs",
    )
    db_session.add(job)
    await db_session.flush()
    db_session.add(SavedJob(user_id=test_user.id, job_listing_id=job.id))
    await db_session.commit()

    body = (await client.get("/v1/onboarding")).json()
    assert _done(body) == {
        "resume": True,
        "profile": False,
        "job_catcher": True,
        "first_job": True,
        "email": False,
        "claude": False,
    }
    assert body["required_done"] == 3


async def test_a_claude_project_link_counts_as_claude(
    client: AsyncClient, db_session: AsyncSession, test_user: User
):
    test_user.claude_project_url = "https://claude.ai/project/abc"
    await db_session.commit()
    assert _done((await client.get("/v1/onboarding")).json())["claude"] is True


async def test_the_claude_connector_ticks_claude_and_is_throttled(
    client: AsyncClient, engine, db_session: AsyncSession, test_user: User
):
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    svc._claude_ticked.clear()
    await svc.touch_claude(maker, test_user.id)  # before the app's first load
    row = await db_session.get(UserOnboarding, test_user.id)
    first = row.claude_seen_at
    assert first is not None and row.welcome_done_at is None

    calls = []

    def counting():
        calls.append(1)
        return maker()

    await svc.touch_claude(counting, test_user.id)  # within the hour: no DB at all
    assert calls == []
    await db_session.refresh(row)
    assert row.claude_seen_at == first
    assert _done((await client.get("/v1/onboarding")).json())["claude"] is True


async def test_a_failing_claude_tick_never_raises(test_user: User):
    svc._claude_ticked.clear()

    def broken():
        raise RuntimeError("database down")

    await svc.touch_claude(broken, test_user.id)


async def test_a_second_first_load_never_fails(
    db_session: AsyncSession, test_user: User
):
    a = await svc.get_or_create(db_session, test_user)
    b = await svc.get_or_create(db_session, test_user)
    assert a is b


async def test_export_includes_onboarding(client: AsyncClient):
    await client.patch("/v1/onboarding", json={"welcome_step": 1})
    export = json.loads((await client.get("/v1/users/me/export")).content)
    assert export["onboarding"]["welcome_step"] == 1


async def test_onboarding_needs_sign_in(anon_client: AsyncClient):
    assert (await anon_client.get("/v1/onboarding")).status_code == 401
