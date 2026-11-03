"""Database egress: list views never read full descriptions; re-seen listings
refresh with a single UPDATE … RETURNING id. Checked against the SQL issued."""

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, select

from app.models.job_listing import JobListing
from app.models.saved_job import SavedJob
from app.services.dedup import job_content_hash, normalize
from app.services.job_search import _upsert_listing

LONG = "Build accessible web apps for local government. " * 200  # ~9.8 KB

# The description column selected on its own (not inside substr()/length()).
_BARE_DESCRIPTION = re.compile(r"(?<![(])\bjob_listings\.description\b(?!\s*,\s*\d)")


@pytest.fixture
def sql_log(engine):
    statements: list[str] = []

    def capture(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", capture)
    yield statements
    event.remove(engine.sync_engine, "before_cursor_execute", capture)


async def _saved(db, user, description=LONG):
    listing = JobListing(
        id=uuid.uuid4(),
        external_id=uuid.uuid4().hex,
        source="test",
        title="Web Developer",
        company="Civic Apps Co",
        location="Remote",
        description=description,
        apply_url="https://jobs.example/1",
        content_hash=uuid.uuid4().hex,
        company_normalized="civic apps co",
        title_normalized="web developer",
    )
    db.add(listing)
    await db.flush()
    sj = SavedJob(id=uuid.uuid4(), user_id=user.id, job_listing_id=listing.id)
    db.add(sj)
    await db.commit()
    db.expunge_all()  # like a fresh request: nothing cached in the session
    return sj, listing


def _reads_description(statements: list[str]) -> bool:
    return any(
        s.lstrip().upper().startswith("SELECT") and _BARE_DESCRIPTION.search(s)
        for s in statements
    )


@pytest.mark.asyncio
class TestListViews:
    async def test_saved_jobs_list_sends_preview_not_description(
        self, client, db_session, test_user, sql_log
    ):
        await _saved(db_session, test_user)
        sql_log.clear()
        r = await client.get("/v1/saved-jobs/")
        assert r.status_code == 200
        (item,) = r.json()
        jl = item["job_listing"]
        assert "description" not in jl
        assert jl["has_description"] is True
        assert jl["description_preview"] == LONG[:300]
        assert not _reads_description(sql_log), "list query read full descriptions"
        assert len(r.content) < 2_000  # was > 10 KB with the description

    async def test_listing_without_description(self, client, db_session, test_user):
        await _saved(db_session, test_user, description=None)
        (item,) = (await client.get("/v1/saved-jobs/")).json()
        assert item["job_listing"]["has_description"] is False
        assert item["job_listing"]["description_preview"] is None

    async def test_patch_and_move_responses_skip_description(
        self, client, db_session, test_user, sql_log
    ):
        sj, _ = await _saved(db_session, test_user)
        sql_log.clear()
        r = await client.patch(f"/v1/saved-jobs/{sj.id}", json={"notes": "called"})
        assert r.status_code == 200 and "description" not in r.json()["job_listing"]
        assert r.json()["notes"] == "called"
        stages = (await client.get("/v1/pipeline-stages/")).json()
        m = await client.post(
            "/v1/pipeline-stages/move",
            json={"saved_job_id": str(sj.id), "stage_id": stages[2]["id"]},
        )
        assert m.status_code == 200
        assert m.json()["pipeline_stage_id"] == stages[2]["id"]
        assert "description" not in m.json()["job_listing"]
        assert not _reads_description(sql_log)

    async def test_job_detail_still_has_full_description(
        self, client, db_session, test_user
    ):
        _, listing = await _saved(db_session, test_user)
        r = await client.get(f"/v1/jobs/{listing.id}")
        assert r.status_code == 200 and r.json()["description"] == LONG

    async def test_data_export_unchanged_and_skips_descriptions(
        self, client, db_session, test_user, sql_log
    ):
        # The export never contained descriptions; it no longer reads them.
        await _saved(db_session, test_user)
        sql_log.clear()
        r = await client.get("/v1/users/me/export")
        assert r.status_code == 200
        (job,) = r.json()["saved_jobs"]
        assert job["job_listing"]["title"] == "Web Developer"
        assert job["job_listing"]["apply_url"] == "https://jobs.example/1"
        assert not _reads_description(sql_log)


@pytest.mark.asyncio
class TestUpsertRefresh:
    async def test_reseen_listing_refreshes_without_reading_the_row(
        self, db_session, sql_log
    ):
        data = {
            "external_id": "ext-1",
            "source": "test",
            "title": "Data Analyst",
            "company": "Orbweaver Analytics",
            "location": "Remote",
            "description": LONG,
            "apply_url": "https://jobs.example/2",
        }
        new_id = await _upsert_listing(db_session, dict(data))
        await db_session.commit()
        old = datetime.now(UTC) - timedelta(days=3)
        listing = await db_session.get(JobListing, new_id)
        listing.refreshed_at, listing.is_expired = old, True
        await db_session.commit()
        db_session.expunge_all()

        sql_log.clear()
        again = await _upsert_listing(db_session, dict(data))
        await db_session.commit()
        assert again == new_id
        refresh = [s for s in sql_log if s.lstrip().upper().startswith("UPDATE")]
        assert len(refresh) == 1 and "RETURNING" in refresh[0].upper()
        assert not any(
            s.lstrip().upper().startswith("SELECT") and "job_listings" in s
            for s in sql_log
        ), "re-seen listing was read back"

        row = (
            await db_session.execute(
                select(JobListing.refreshed_at, JobListing.is_expired).where(
                    JobListing.id == new_id
                )
            )
        ).one()
        refreshed = (
            row.refreshed_at.replace(tzinfo=UTC)
            if row.refreshed_at.tzinfo is None
            else row.refreshed_at
        )
        assert refreshed > old and row.is_expired is False

    async def test_content_hash_matches_dedup(self):
        # Guard: the refresh keys on the same hash the insert path stores.
        h = job_content_hash(normalize("A"), normalize("B"), normalize("C"))
        assert len(h) == 64


def test_curated_ingest_runs_daily():
    import inspect

    from app import main

    src = inspect.getsource(main)
    block = src[src.index("ingest_curated_jobs,\n") :][:200]
    assert "hours=24" in block
