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


# ---- PR #67 review ---------------------------------------------------------


def test_workday_posting_reads_the_site_and_requisition():
    from app.services.saved_jobs import workday_posting

    assert workday_posting(POSTING) == ("northwind.wd5.myworkdayjobs.com", "jr-1001")
    assert workday_posting(POSTING + "/apply/applyManually") == (
        "northwind.wd5.myworkdayjobs.com",
        "jr-1001",
    )
    shared = (
        "https://wd3.myworkdaysite.com/en-US/recruiting/cascadia/External/job/X_R-7"
    )
    assert workday_posting(shared) == ("wd3.myworkdaysite.com/cascadia", "r-7")
    assert workday_posting("https://example.com/job/X_R-7") is None


@pytest.mark.asyncio
async def test_the_same_posting_saved_from_another_address_is_the_one(
    client: AsyncClient,
):
    """Saved from a board's link (other title, other company name), applied on
    Workday: the same site and requisition id find it; nothing is created."""
    saved = (
        await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": "https://northwind.wd5.myworkdayjobs.com/External/job/"
                "Remote/App-Dev-2_JR-1001?source=board",
                "title": "App Developer 2 (Remote)",
                "company": "Northwind Labs",
            },
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
async def test_a_site_name_company_finds_the_one_job_with_that_title(
    client: AsyncClient,
):
    """A Workday site called "jj": the page's company is just "Jj". The one
    saved, not-yet-applied job with that exact title is the job — no copy."""
    saved = (
        await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": "https://careers.example.test/jobs/77",
                "title": "Applications Developer II",
                "company": "Juniper & Jasper",
            },
        )
    ).json()
    create = {
        **CREATE,
        "url": CREATE["url"].replace("northwind", "jj"),
        "company": "Jj",
    }
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": create["title"], "company": "Jj", "create": create},
    )
    assert r.json() == {"matched": True, "created": False}
    jobs = await _jobs(client)
    assert [j["id"] for j in jobs] == [saved["id"]]


@pytest.mark.asyncio
async def test_two_saved_jobs_with_that_title_are_never_guessed(client: AsyncClient):
    for n, company in enumerate(["Juniper & Jasper", "Jasper Juniper"]):
        await client.post(
            "/v1/saved-jobs/manual",
            json={
                "url": f"https://careers.example.test/jobs/{n}",
                "title": "Applications Developer II",
                "company": company,
            },
        )
    create = {
        **CREATE,
        "url": CREATE["url"].replace("northwind", "jj"),
        "company": "Jj",
    }
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": create["title"], "company": "Jj", "create": create},
    )
    assert r.json() == {"matched": True, "created": True}
    jobs = await _jobs(client)
    assert len(jobs) == 3
    assert sum(1 for j in jobs if j["applied_at"]) == 1


@pytest.mark.asyncio
async def test_a_same_titled_job_at_another_company_is_never_the_one(
    client: AsyncClient,
):
    await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://careers.example.test/jobs/5",
            "title": "Applications Developer II",
            "company": "Tidewell Labs",
        },
    )
    create = {
        **CREATE,
        "url": CREATE["url"].replace("northwind", "jj"),
        "company": "Jj",
    }
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": create["title"], "company": "Jj", "create": create},
    )
    assert r.json() == {"matched": True, "created": True}


@pytest.mark.asyncio
async def test_a_job_already_had_is_never_reported_as_created(
    client: AsyncClient, monkeypatch
):
    """save_manual_job hands back a job the user already had (same title,
    company and place): "Marked applied", not "Saved and marked applied"."""
    from app.services import saved_jobs

    await client.post(
        "/v1/saved-jobs/manual",
        json={**CREATE, "url": "https://careers.example.test/jobs/9"},
    )

    async def no_match(*_a, **_k):
        return False

    async def no_title(*_a, **_k):
        return None

    monkeypatch.setattr(saved_jobs, "mark_applied", no_match)
    monkeypatch.setattr(saved_jobs, "_only_by_title", no_title)
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": CREATE["title"], "company": "Northwind", "create": CREATE},
    )
    assert r.json() == {"matched": True, "created": False}
    assert len(await _jobs(client)) == 1


@pytest.mark.asyncio
async def test_installs_tell_computers_apart(client: AsyncClient):
    for install, browser in [
        ("install-home1", "Chrome 142 (Windows)"),
        ("install-laptop", "Chrome 141 (macOS)"),
    ]:
        await client.post(
            "/v1/extension/hello",
            json={"install_id": install, "version": "0.44.0", "browser": browser},
        )
    rows = (await client.get("/v1/extension/installs")).json()
    assert sorted((r["install_id"], r["browser"]) for r in rows) == [
        ("install-home1", "Chrome 142 (Windows)"),
        ("install-laptop", "Chrome 141 (macOS)"),
    ]


def test_a_site_name_is_short_for_a_company():
    from app.services.saved_jobs import short_for

    assert short_for("jj", "Juniper & Jasper")
    assert short_for("acmecorp", "Acme Corp")
    assert short_for("northwind", "Northwind Labs")
    assert short_for("bah", "Birch Alder Hollis")
    assert not short_for("jj", "Tidewell Labs")
    assert not short_for("x", "Xylo Systems")
    # A mere prefix is never enough.
    assert not short_for("intel", "Intelligent Systems Inc")
    assert not short_for("ge", "Gemini Labs")
    assert not short_for("gm", "GMR Marketing")
    assert not short_for("pg", "PGA Tour")
    assert not short_for("ab", "Abbott")
