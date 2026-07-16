"""Integration tests for saved searches + the New Matches feed (FR-024)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_listing import JobListing
from app.services.dedup import job_content_hash, normalize


async def _insert_listing(db: AsyncSession, title: str, company: str) -> JobListing:
    tn, cn, ln = normalize(title), normalize(company), normalize("Remote")
    job = JobListing(
        id=uuid.uuid4(),
        external_id=f"adzuna_{uuid.uuid4()}",
        source="adzuna",
        title=title,
        company=company,
        location="Remote",
        is_remote=True,
        apply_url="https://example.com/a",
        content_hash=job_content_hash(tn, cn, ln),
        title_normalized=tn,
        company_normalized=cn,
        # Explicit microsecond timestamp — SQLite's CURRENT_TIMESTAMP only has
        # second precision, which ties with last_viewed_at in fast tests.
        created_at=datetime.now(UTC),
    )
    db.add(job)
    await db.commit()
    return job


@pytest.mark.asyncio
async def test_create_list_delete_saved_search(client: AsyncClient):
    response = await client.post(
        "/v1/saved-searches/", json={"q": "python developer", "remote_only": True}
    )
    assert response.status_code == 201
    search = response.json()
    assert search["name"] == "python developer · remote"

    response = await client.get("/v1/saved-searches/")
    assert len(response.json()) == 1

    response = await client.delete(f"/v1/saved-searches/{search['id']}")
    assert response.status_code == 204
    assert (await client.get("/v1/saved-searches/")).json() == []


@pytest.mark.asyncio
async def test_new_matches_feed_flow(client: AsyncClient, db_session: AsyncSession):
    """New listings matching a saved search appear in the feed until seen."""
    from sqlalchemy import update

    from app.models.saved_search import SavedSearch

    search = (
        await client.post("/v1/saved-searches/", json={"q": "rust engineer"})
    ).json()

    # Backdate the search so the listing below is unambiguously "new"
    await db_session.execute(
        update(SavedSearch)
        .where(SavedSearch.id == uuid.UUID(search["id"]))
        .values(last_viewed_at=datetime.now(UTC) - timedelta(minutes=5))
    )
    await db_session.commit()

    # A matching listing arrives after the search was last viewed
    await _insert_listing(db_session, "Senior Rust Engineer", "Crab Co")

    response = await client.get("/v1/saved-searches/matches")
    assert response.status_code == 200
    feed = response.json()
    assert feed["total_new"] == 1
    assert feed["matches"][0]["new_jobs"][0]["company"] == "Crab Co"

    # Mark seen — feed empties
    assert (await client.post("/v1/saved-searches/mark-seen")).status_code == 204
    feed = (await client.get("/v1/saved-searches/matches")).json()
    assert feed["total_new"] == 0


@pytest.mark.asyncio
async def test_saved_search_limit(client: AsyncClient):
    for i in range(10):
        r = await client.post("/v1/saved-searches/", json={"q": f"query {i}"})
        assert r.status_code == 201
    over = await client.post("/v1/saved-searches/", json={"q": "one too many"})
    assert over.status_code == 400
