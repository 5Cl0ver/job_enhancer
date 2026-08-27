"""Integration tests for saved jobs: save, duplicates, manual add, update, delete."""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_listing import JobListing
from app.services.dedup import job_content_hash, normalize


@pytest_asyncio.fixture
async def sample_job(db_session: AsyncSession) -> JobListing:
    title, company, location = "Python Developer", "Acme Corp", "New York, NY"
    tn, cn, ln = normalize(title), normalize(company), normalize(location)
    job = JobListing(
        id=uuid.uuid4(),
        external_id="adzuna_12345",
        source="adzuna",
        title=title,
        company=company,
        location=location,
        is_remote=False,
        apply_url="https://example.com/apply",
        content_hash=job_content_hash(tn, cn, ln),
        title_normalized=tn,
        company_normalized=cn,
    )
    db_session.add(job)
    await db_session.commit()
    return job


@pytest.mark.asyncio
async def test_save_and_list_job(client: AsyncClient, sample_job: JobListing):
    response = await client.post(
        "/v1/saved-jobs/", json={"job_listing_id": str(sample_job.id)}
    )
    assert response.status_code == 201
    saved = response.json()
    assert saved["job_listing"]["title"] == sample_job.title
    assert saved["applied_at"] is None

    response = await client.get("/v1/saved-jobs/")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_duplicate_save_rejected(client: AsyncClient, sample_job: JobListing):
    first = await client.post(
        "/v1/saved-jobs/", json={"job_listing_id": str(sample_job.id)}
    )
    assert first.status_code == 201
    duplicate = await client.post(
        "/v1/saved-jobs/", json={"job_listing_id": str(sample_job.id)}
    )
    assert duplicate.status_code == 409


@pytest.mark.asyncio
async def test_manual_add_job(client: AsyncClient):
    """FR-004a: paste a URL + details, job becomes trackable."""
    response = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://www.linkedin.com/jobs/view/999",
            "title": "Staff Engineer",
            "company": "LinkedIn Find Co",
            "location": "Remote",
            "is_remote": True,
        },
    )
    assert response.status_code == 201
    saved = response.json()
    assert saved["job_listing"]["source"] == "manual"
    assert saved["job_listing"]["apply_url"] == "https://www.linkedin.com/jobs/view/999"

    # Re-saving from the capture card is idempotent — it updates the listing's
    # details (see test below) rather than erroring with a duplicate.
    again = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://www.linkedin.com/jobs/view/999",
            "title": "Staff Engineer",
            "company": "LinkedIn Find Co",
            "location": "Remote",
        },
    )
    assert again.status_code == 201


@pytest.mark.asyncio
async def test_manual_resave_updates_edited_description(client: AsyncClient):
    """Editing the description in the capture card and re-saving must stick,
    even though the job is already in the tracker (title/company/location are
    unchanged, so it resolves to the same listing)."""
    base = {
        "url": "https://example.com/edit/1",
        "title": "Support Engineer",
        "company": "EditCo",
        "location": "Remote",
        "is_remote": True,
    }
    first = await client.post(
        "/v1/saved-jobs/manual", json={**base, "description": "Auto-extracted blurb."}
    )
    assert first.status_code == 201
    assert first.json()["job_listing"]["description"] == "Auto-extracted blurb."

    edited = await client.post(
        "/v1/saved-jobs/manual", json={**base, "description": "My corrected description."}
    )
    assert edited.status_code == 201
    assert edited.json()["job_listing"]["description"] == "My corrected description."


@pytest.mark.asyncio
async def test_manual_add_stores_rich_fields(client: AsyncClient):
    """Description / salary / job_type captured by the extension are persisted."""
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://example.com/rich/1",
            "title": "Platform Engineer",
            "company": "RichCo",
            "location": "Remote",
            "is_remote": True,
            "description": "Build and run our platform. Kubernetes, Go, on-call.",
            "salary_min": 120000,
            "salary_max": 160000,
            "job_type": "FULL_TIME",
        },
    )
    assert r.status_code == 201
    jl = r.json()["job_listing"]
    assert jl["description"].startswith("Build and run our platform")
    assert jl["salary_min"] == 120000
    assert jl["salary_max"] == 160000
    assert jl["job_type"] == "FULL_TIME"


@pytest.mark.asyncio
async def test_manual_add_accepts_decimal_salary(client: AsyncClient):
    """Regression: Indeed lists salaries with cents ("$80,708.90 a year"); the
    strict int fields 422'd on those floats and the save failed."""
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://example.com/decimal/1",
            "title": "Web Developer",
            "company": "Civic Canvas",
            "location": "Los Angeles, CA",
            "salary_min": 80708.90,
            "salary_max": 101756.95,
        },
    )
    assert r.status_code == 201
    jl = r.json()["job_listing"]
    assert jl["salary_min"] == 80709
    assert jl["salary_max"] == 101757


@pytest.mark.asyncio
async def test_manual_add_stores_hourly_salary_period(client: AsyncClient):
    """Hourly listings ($50-$100/hr) keep their period so the UI can label
    them honestly instead of showing $50 as an annual salary."""
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://example.com/hourly/1",
            "title": "Staff Software Engineer - AI Trainer",
            "company": "DataAnnotation",
            "location": "Remote in Pomona, CA",
            "is_remote": True,
            "salary_min": 50,
            "salary_max": 100,
            "salary_period": "hourly",
            "job_type": "Part-time, Contract, Full-time",
        },
    )
    assert r.status_code == 201
    jl = r.json()["job_listing"]
    assert jl["salary_min"] == 50
    assert jl["salary_max"] == 100
    assert jl["salary_period"] == "hourly"
    assert jl["job_type"] == "Part-time, Contract, Full-time"


@pytest.mark.asyncio
async def test_check_saved_reflects_tracker(client: AsyncClient):
    """POST /check returns saved=False before saving, True after (extension pre-check)."""
    job = {
        "title": "Platform Engineer",
        "company": "CheckCo",
        "location": "Remote",
    }
    before = await client.post("/v1/saved-jobs/check", json=job)
    assert before.status_code == 200
    assert before.json()["saved"] is False

    await client.post(
        "/v1/saved-jobs/manual",
        json={"url": "https://example.com/checkco/1", "is_remote": True, **job},
    )

    after = await client.post("/v1/saved-jobs/check", json=job)
    assert after.json()["saved"] is True

    # A different job is still not saved.
    other = await client.post(
        "/v1/saved-jobs/check", json={"title": "Someone Else", "company": "X"}
    )
    assert other.json()["saved"] is False


@pytest.mark.asyncio
async def test_check_flags_thin_listing_and_backfill_upgrades_it(client: AsyncClient):
    """Passive backfill flow: save thin from a feed -> /check says needs_details
    -> extension sends full details from the job page -> listing upgraded."""
    job = {"title": "Web Developer", "company": "Civic Canvas", "location": "LA"}

    # Saved from the feed: no description.
    await client.post(
        "/v1/saved-jobs/manual",
        json={"url": "https://example.com/thin/1", **job},
    )
    check = (await client.post("/v1/saved-jobs/check", json=job)).json()
    assert check == {"saved": True, "needs_details": True}

    # Later, on the real job page, the extension captures everything.
    full_description = "Build accessible web apps for local government. " * 10
    backfill = await client.post(
        "/v1/saved-jobs/backfill",
        json={
            "url": "https://example.com/thin/1",
            **job,
            "description": full_description,
            "salary_min": 80709,
            "salary_max": 101757,
            "job_type": "FULL_TIME",
        },
    )
    assert backfill.status_code == 200
    body = backfill.json()
    assert body["updated"] is True
    assert set(body["fields"]) == {
        "description",
        "salary_min",
        "salary_max",
        "job_type",
    }

    # The listing is now rich: /check no longer asks for details...
    check2 = (await client.post("/v1/saved-jobs/check", json=job)).json()
    assert check2 == {"saved": True, "needs_details": False}
    # ...and the saved job carries the upgraded data.
    saved = (await client.get("/v1/saved-jobs/")).json()
    jl = next(
        s["job_listing"] for s in saved if s["job_listing"]["title"] == "Web Developer"
    )
    assert jl["description"] == full_description
    assert jl["salary_min"] == 80709
    assert jl["job_type"] == "FULL_TIME"


@pytest.mark.asyncio
async def test_backfill_never_downgrades_or_touches_unsaved(client: AsyncClient):
    job = {"title": "Data Engineer", "company": "PipeCo", "location": "Remote"}
    long_desc = "Design and operate our data pipelines end to end. " * 8
    await client.post(
        "/v1/saved-jobs/manual",
        json={"url": "https://example.com/rich/2", "description": long_desc, **job},
    )

    # A shorter description must NOT replace the longer one.
    r = await client.post(
        "/v1/saved-jobs/backfill",
        json={
            "url": "https://example.com/rich/2",
            "description": "Short blurb.",
            **job,
        },
    )
    assert r.json()["updated"] is False

    # A job the user never saved is a no-op, not an error.
    r2 = await client.post(
        "/v1/saved-jobs/backfill",
        json={
            "url": "https://example.com/nope/1",
            "title": "Never Saved",
            "company": "GhostCo",
            "description": long_desc,
        },
    )
    assert r2.status_code == 200
    assert r2.json() == {"updated": False, "fields": []}


@pytest.mark.asyncio
async def test_backfill_corrects_false_remote_flag(client: AsyncClient):
    """Early captures falsely flagged on-site jobs as Remote (whole-page text
    scan). A backfill from the job's own page corrects the flag."""
    job = {
        "title": "Junior ML Engineer",
        "company": "Tax Relief Advocates",
        "location": "Irvine, CA",
    }
    await client.post(
        "/v1/saved-jobs/manual",
        json={"url": "https://example.com/tra/1", "is_remote": True, **job},  # wrong
    )
    r = await client.post(
        "/v1/saved-jobs/backfill",
        json={
            "url": "https://example.com/tra/1",
            "is_remote": False,  # what the job page actually says
            "description": "Join our Irvine office as a junior ML engineer. " * 8,
            **job,
        },
    )
    assert r.json()["updated"] is True
    assert "is_remote" in r.json()["fields"]
    saved = (await client.get("/v1/saved-jobs/")).json()
    jl = next(
        s["job_listing"]
        for s in saved
        if s["job_listing"]["company"] == "Tax Relief Advocates"
    )
    assert jl["is_remote"] is False


@pytest.mark.asyncio
async def test_manual_add_rejects_non_http_url(client: AsyncClient):
    response = await client.post(
        "/v1/saved-jobs/manual",
        json={"url": "javascript:alert(1)", "title": "X", "company": "Y"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_update_and_delete_saved_job(client: AsyncClient, sample_job: JobListing):
    saved = (
        await client.post(
            "/v1/saved-jobs/", json={"job_listing_id": str(sample_job.id)}
        )
    ).json()

    response = await client.patch(
        f"/v1/saved-jobs/{saved['id']}", json={"notes": "Referred by Sam"}
    )
    assert response.status_code == 200
    assert response.json()["notes"] == "Referred by Sam"

    response = await client.delete(f"/v1/saved-jobs/{saved['id']}")
    assert response.status_code == 204

    response = await client.get("/v1/saved-jobs/")
    assert response.json() == []


@pytest.mark.asyncio
async def test_mark_applied_moves_job_to_applied(client: AsyncClient):
    """Auto-track: submit detected on an ATS page -> saved job moves to Applied."""
    await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://boards.greenhouse.io/acme/jobs/1",
            "title": "Backend Engineer",
            "company": "Acme Corp",
            "location": "NYC",
        },
    )

    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": "Backend Engineer", "company": "Acme Corp"},
    )
    assert r.status_code == 200
    assert r.json()["matched"] is True

    saved = (await client.get("/v1/saved-jobs/")).json()
    sj = next(s for s in saved if s["job_listing"]["title"] == "Backend Engineer")
    assert sj["applied_at"] is not None

    # A job that was never saved: honest no-op, nothing invented.
    r2 = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": "Ghost Job", "company": "NoCo"},
    )
    assert r2.json()["matched"] is False


@pytest.mark.asyncio
async def test_manual_add_drops_negative_salary_sentinel(client: AsyncClient):
    """Indeed sends -1 for 'no max'; it must be dropped, not stored/shown."""
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://example.com/sentinel/1",
            "title": "Development Operations Engineer",
            "company": "Speed Express",
            "salary_min": 80000,
            "salary_max": -1,
        },
    )
    assert r.status_code == 201
    jl = r.json()["job_listing"]
    assert jl["salary_min"] == 80000
    assert jl["salary_max"] is None


@pytest.mark.asyncio
async def test_mark_applied_company_only_fallback(client: AsyncClient):
    """Indeed's confirmation states only the company — a company-only signal
    still tracks (newest not-yet-applied job at that company)."""
    await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://example.com/co/1",
            "title": "Desktop Engineer",
            "company": "Align Communications",
        },
    )
    r = await client.post(
        "/v1/saved-jobs/mark-applied",
        json={"title": "", "company": "Align Communications"},
    )
    assert r.status_code == 200
    assert r.json()["matched"] is True
    saved = (await client.get("/v1/saved-jobs/")).json()
    sj = next(s for s in saved if s["job_listing"]["company"] == "Align Communications")
    assert sj["applied_at"] is not None


@pytest.mark.asyncio
async def test_sync_imports_unknown_application(client: AsyncClient):
    """A job the user applied to on Indeed but never saved gets imported into
    the tracker, marked applied."""
    resp = await client.post(
        "/v1/saved-jobs/sync-applications",
        json={
            "applications": [
                {
                    "title": "IT Manager/Front End Lead",
                    "company": "Veriheal",
                    "location": "Portland, OR",
                    "stage": "Applied",
                }
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["imported"] == 1
    assert body["updated"] == 0
    assert body["outcomes"][0]["action"] == "imported"

    jobs = (await client.get("/v1/saved-jobs/")).json()
    imported = next(j for j in jobs if j["job_listing"]["company"] == "Veriheal")
    assert imported["job_listing"]["title"] == "IT Manager/Front End Lead"
    assert imported["applied_at"] is not None


@pytest.mark.asyncio
async def test_sync_updates_existing_saved_job_stage(client: AsyncClient):
    """A synced status ('Not selected' → Rejected) moves an already-saved job to
    the mapped stage instead of duplicating it."""
    await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://www.indeed.com/viewjob?jk=abc",
            "title": "Data Analyst",
            "company": "Initech",
            "location": "Remote",
        },
    )
    resp = await client.post(
        "/v1/saved-jobs/sync-applications",
        json={
            "applications": [
                {
                    "title": "Data Analyst",
                    "company": "Initech",
                    "location": "Remote",
                    "stage": "Rejected",
                }
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == 1
    assert body["imported"] == 0

    stages = (await client.get("/v1/pipeline-stages/")).json()
    rejected = next(s for s in stages if s["name"] == "Rejected")
    jobs = (await client.get("/v1/saved-jobs/")).json()
    # Only one Data Analyst — no duplicate created.
    analysts = [j for j in jobs if j["job_listing"]["title"] == "Data Analyst"]
    assert len(analysts) == 1
    assert analysts[0]["pipeline_stage_id"] == rejected["id"]
    assert analysts[0]["applied_at"] is not None


@pytest.mark.asyncio
async def test_sync_batch_mixes_update_and_import(client: AsyncClient):
    """A batch reconciles: known jobs update, unknown jobs import — one pass."""
    await client.post(
        "/v1/saved-jobs/manual",
        json={"url": "https://x.co/1", "title": "Backend Engineer", "company": "Hooli"},
    )
    resp = await client.post(
        "/v1/saved-jobs/sync-applications",
        json={
            "applications": [
                {"title": "Backend Engineer", "company": "Hooli", "stage": "Interview"},
                {
                    "title": "Frontend Engineer",
                    "company": "Pied Piper",
                    "stage": "Applied",
                },
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == 1
    assert body["imported"] == 1
    assert len(body["outcomes"]) == 2


@pytest.mark.asyncio
async def test_manual_resave_does_not_mutate_a_listing_another_user_saved(
    db_session: AsyncSession, test_user
):
    """job_listings is a SHARED pool: one user re-saving a manual job must never
    overwrite a listing another user also saved (isolation)."""
    from app.schemas.saved_job import ManualJobCreate
    from app.services import saved_jobs as svc
    from app.services.users import create_user

    payload = dict(
        url="https://example.com/j",
        title="Data Engineer",
        company="Globex",
        location="Remote",
    )
    a = await svc.save_manual_job(
        db_session, test_user.id, ManualJobCreate(**payload, description="Original")
    )
    user_b = await create_user(db_session, email="b_isolation@test.dev", name="B")
    b = await svc.save_manual_job(
        db_session,
        user_b.id,
        ManualJobCreate(**payload, description="B tries to overwrite"),
    )
    await db_session.flush()

    assert a.job_listing_id == b.job_listing_id  # same shared listing
    await db_session.refresh(a.job_listing)
    assert a.job_listing.description == "Original"  # B could not clobber it
