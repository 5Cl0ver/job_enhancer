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

    # Saving the same manual job again is a duplicate
    again = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://www.linkedin.com/jobs/view/999",
            "title": "Staff Engineer",
            "company": "LinkedIn Find Co",
            "location": "Remote",
        },
    )
    assert again.status_code == 409


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
