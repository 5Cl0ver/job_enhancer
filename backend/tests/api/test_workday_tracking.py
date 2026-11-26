"""Spec 034: a Workday application submitted for a job never saved is saved
from the page and marked Applied, once; and the ready check names an
out-of-date Job Catcher. All names are invented."""

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extension import ExtensionInstall
from app.models.user import User
from app.services import apply_runs, releases

POSTING = (
    "https://northwind.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/"
    "Applications-Developer-II_JR-1001"
)
CREATE = {
    "url": POSTING,
    "title": "Applications Developer II",
    "company": "Northwind",
    "location": "Portland, OR",
}


async def _jobs(client: AsyncClient) -> list[dict]:
    return (await client.get("/v1/saved-jobs/")).json()


@pytest.mark.asyncio
async def test_an_unsaved_application_is_saved_and_marked_applied_once(
    client: AsyncClient,
):
    body = {"title": CREATE["title"], "company": CREATE["company"], "create": CREATE}
    r = await client.post("/v1/saved-jobs/mark-applied", json=body)
    assert r.status_code == 200
    assert r.json() == {"matched": True, "created": True}
    jobs = await _jobs(client)
    assert len(jobs) == 1
    job = jobs[0]
    assert job["job_listing"]["title"] == "Applications Developer II"
    assert job["job_listing"]["apply_url"] == POSTING
    assert job["applied_at"] is not None
    assert job["origin"] == "extension"

    # The tracker fires twice (a double click): still one job.
    r = await client.post("/v1/saved-jobs/mark-applied", json=body)
    assert r.json() == {"matched": True, "created": False}
    assert len(await _jobs(client)) == 1


@pytest.mark.asyncio
async def test_a_saved_job_is_moved_never_copied(client: AsyncClient):
    saved = (
        await client.post(
            "/v1/saved-jobs/manual",
            json={**CREATE, "location": "Portland, OR"},
        )
    ).json()
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": CREATE["title"], "company": "Northwind", "create": CREATE},
    )
    assert r.json() == {"matched": True, "created": False}
    jobs = await _jobs(client)
    assert [j["id"] for j in jobs] == [saved["id"]]
    assert jobs[0]["applied_at"] is not None


@pytest.mark.asyncio
async def test_another_job_at_the_same_company_is_never_the_one(client: AsyncClient):
    """With the job's own title known, a different saved job at that company
    isn't moved (the old company-only fallback): this one is saved instead."""
    other = (
        await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": "https://northwind.wd5.myworkdayjobs.com/en-US/External/job/X_JR-2",
                "title": "Data Analyst",
                "company": "Northwind",
            },
        )
    ).json()
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": CREATE["title"], "company": "Northwind", "create": CREATE},
    )
    assert r.json() == {"matched": True, "created": True}
    jobs = {j["id"]: j for j in await _jobs(client)}
    assert len(jobs) == 2
    assert jobs[other["id"]]["applied_at"] is None


@pytest.mark.asyncio
async def test_without_create_nothing_is_invented(client: AsyncClient):
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": "Ghost Job", "company": "Nobody Ltd"},
    )
    assert r.json() == {"matched": False, "created": False}
    assert await _jobs(client) == []


@pytest.mark.asyncio
async def test_create_needs_a_real_link(client: AsyncClient):
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={
            "title": "X",
            "company": "Y",
            "create": {**CREATE, "url": "javascript:alert(1)"},
        },
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_ready_check_names_an_out_of_date_job_catcher(
    db_session: AsyncSession, test_user: User, monkeypatch
):
    async def newest():
        return releases._empty() | {"version": "0.45.0"}

    monkeypatch.setattr(releases, "latest", newest)
    status = await apply_runs.job_catcher_status(db_session, test_user.id)
    assert status["latest"] == "0.45.0" and status["outdated"] is False

    db_session.add(
        ExtensionInstall(
            user_id=test_user.id, install_id="install-old1", version="0.42.0"
        )
    )
    await db_session.commit()
    status = await apply_runs.job_catcher_status(db_session, test_user.id)
    # New enough to work, but not the newest: called out by name.
    assert status["ready"] is True and status["outdated"] is True
    assert status["version"] == "0.42.0" and status["latest"] == "0.45.0"

    db_session.add(
        ExtensionInstall(
            user_id=test_user.id,
            install_id="install-new1",
            version="0.45.0",
            last_seen_at=apply_runs._now() + timedelta(seconds=1),
        )
    )
    await db_session.commit()
    status = await apply_runs.job_catcher_status(db_session, test_user.id)
    assert status["outdated"] is False


@pytest.mark.asyncio
async def test_no_release_known_is_never_out_of_date(
    db_session: AsyncSession, test_user: User
):
    db_session.add(
        ExtensionInstall(
            user_id=test_user.id, install_id="install-any1", version="0.42.0"
        )
    )
    await db_session.commit()
    status = await apply_runs.job_catcher_status(db_session, test_user.id)
    assert status["latest"] is None and status["outdated"] is False
