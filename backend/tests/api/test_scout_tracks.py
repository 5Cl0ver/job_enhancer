"""Claude Scout resume types (tracks): CRUD, limits, ownership, job tagging."""

import uuid

import pytest
from httpx import AsyncClient

from app.models.resume import Resume
from app.models.resume_track import ResumeTrack
from app.models.user import User
from tests.api.test_email import _create_saved_job

IT_ADMIN = {
    "name": "IT Admin",
    "target_titles": ["IT Systems Administrator", "Jira Administrator", " "],
    "key_skills": ["Microsoft 365", "Entra ID", "microsoft 365"],
    "skip_rules": {"degree_only": True, "max_years": 7, "exclude": ["clearance"]},
    "min_pay": 70000,
}


async def _resume(db, user_id, filename="it-admin.pdf"):
    r = Resume(
        id=uuid.uuid4(),
        user_id=user_id,
        filename=filename,
        mime_type="application/pdf",
        file_size_bytes=10,
        is_active=False,
    )
    db.add(r)
    await db.flush()
    return r


async def _other_user(db):
    other = User(id=uuid.uuid4(), email="other@test.dev")
    db.add(other)
    await db.flush()
    return other


@pytest.mark.asyncio
class TestTracks:
    async def test_create_list_edit_delete(
        self, client: AsyncClient, db_session, test_user
    ):
        resume = await _resume(db_session, test_user.id)
        r = await client.post(
            "/v1/scout/tracks", json={**IT_ADMIN, "resume_id": str(resume.id)}
        )
        assert r.status_code == 201, r.text
        track = r.json()
        # Blanks and case-insensitive repeats are dropped; order kept.
        assert track["target_titles"] == [
            "IT Systems Administrator",
            "Jira Administrator",
        ]
        assert track["key_skills"] == ["Microsoft 365", "Entra ID"]
        assert track["resume_filename"] == "it-admin.pdf"
        assert track["skip_rules"] == {
            "degree_only": True,
            "max_years": 7,
            "exclude": ["clearance"],
        }

        r = await client.patch(
            f"/v1/scout/tracks/{track['id']}",
            json={"name": "IT Admin & Jira", "min_pay": 75000, "resume_id": None},
        )
        assert r.status_code == 200
        body = r.json()
        assert (body["name"], body["min_pay"], body["resume_id"]) == (
            "IT Admin & Jira",
            75000,
            None,
        )
        assert body["target_titles"] == track["target_titles"]  # untouched

        listed = (await client.get("/v1/scout/tracks")).json()
        assert [t["name"] for t in listed] == ["IT Admin & Jira"]

        assert (
            await client.delete(f"/v1/scout/tracks/{track['id']}")
        ).status_code == 204
        assert (await client.get("/v1/scout/tracks")).json() == []

    async def test_names_are_unique_in_any_case(self, client: AsyncClient):
        assert (await client.post("/v1/scout/tracks", json=IT_ADMIN)).status_code == 201
        r = await client.post("/v1/scout/tracks", json={**IT_ADMIN, "name": "it admin"})
        assert r.status_code == 409 and "already" in r.json()["detail"]

    async def test_at_most_eight(self, client: AsyncClient):
        for i in range(8):
            r = await client.post("/v1/scout/tracks", json={"name": f"Type {i}"})
            assert r.status_code == 201
        r = await client.post("/v1/scout/tracks", json={"name": "Ninth"})
        assert r.status_code == 422 and "up to 8" in r.json()["detail"]

    async def test_bad_input_is_rejected(self, client: AsyncClient):
        assert (
            await client.post("/v1/scout/tracks", json={"name": "   "})
        ).status_code == 422
        too_many = {"name": "X", "target_titles": [f"Title {i}" for i in range(16)]}
        assert (await client.post("/v1/scout/tracks", json=too_many)).status_code == 422
        assert (
            await client.post("/v1/scout/tracks", json={"name": "X", "min_pay": -5})
        ).status_code == 422

    async def test_someone_elses_resume_cannot_be_attached(
        self, client: AsyncClient, db_session
    ):
        other = await _other_user(db_session)
        theirs = await _resume(db_session, other.id)
        r = await client.post(
            "/v1/scout/tracks", json={**IT_ADMIN, "resume_id": str(theirs.id)}
        )
        assert r.status_code == 422

    async def test_someone_elses_track_is_not_found(
        self, client: AsyncClient, db_session
    ):
        other = await _other_user(db_session)
        theirs = ResumeTrack(
            id=uuid.uuid4(),
            user_id=other.id,
            name="Theirs",
            target_titles=[],
            key_skills=[],
            skip_rules={},
        )
        db_session.add(theirs)
        await db_session.flush()
        assert (
            await client.patch(f"/v1/scout/tracks/{theirs.id}", json={"name": "Mine"})
        ).status_code == 404
        assert (await client.delete(f"/v1/scout/tracks/{theirs.id}")).status_code == 404
        assert (await client.get("/v1/scout/tracks")).json() == []


@pytest.mark.asyncio
class TestJobsTaggedWithATrack:
    async def test_tag_count_and_untag_on_delete(
        self, client: AsyncClient, db_session, test_user
    ):
        track = (await client.post("/v1/scout/tracks", json=IT_ADMIN)).json()
        job = await _create_saved_job(
            db_session, test_user, "Brambleworks", "IT Systems Administrator"
        )

        r = await client.patch(
            f"/v1/saved-jobs/{job.id}", json={"track_id": track["id"]}
        )
        assert r.status_code == 200 and r.json()["track_id"] == track["id"]
        assert (await client.get("/v1/scout/tracks")).json()[0]["job_count"] == 1

        await client.delete(f"/v1/scout/tracks/{track['id']}")
        await db_session.refresh(job)
        assert job.track_id is None  # the job stays saved, just untagged

    async def test_cannot_tag_with_someone_elses_track(
        self, client: AsyncClient, db_session, test_user
    ):
        other = await _other_user(db_session)
        theirs = ResumeTrack(
            id=uuid.uuid4(),
            user_id=other.id,
            name="Theirs",
            target_titles=[],
            key_skills=[],
            skip_rules={},
        )
        db_session.add(theirs)
        job = await _create_saved_job(db_session, test_user, "Vellacor", "Data Analyst")
        r = await client.patch(
            f"/v1/saved-jobs/{job.id}", json={"track_id": str(theirs.id)}
        )
        assert r.status_code == 404
