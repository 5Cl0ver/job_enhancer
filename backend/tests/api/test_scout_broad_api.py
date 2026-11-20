"""The page's side of the "Anything I'd be good at" search (spec 009): making
one, starting it, the titles it tried, and what each run searched. Invented
people and companies throughout."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from app.models.resume import Resume
from app.models.scout import ScoutTitle
from app.services import scout_runs
from tests.api.test_scout_tracks import _other_user

SEARCH = {
    "source": "linkedin",
    "broad": True,
    "location": "Springfield, IL",
    "overrides": {"always": ["Jira Administrator"], "never": [], "avoid": ["sales"]},
}


async def _resume(db, user_id, text="IT Systems Administrator, Microsoft 365"):
    db.add(
        Resume(
            id=uuid.uuid4(),
            user_id=user_id,
            filename="resume.pdf",
            mime_type="application/pdf",
            file_size_bytes=10,
            extracted_text=text,
            is_active=True,
        )
    )
    await db.flush()


@pytest.mark.asyncio
class TestBroadSearchOnThePage:
    async def test_make_one_without_a_resume_type(self, client: AsyncClient):
        r = await client.post("/v1/scout/missions", json=SEARCH)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["broad"] is True
        assert body["collection_name"] == "Claude's picks"
        assert body["overrides"]["always"] == ["Jira Administrator"]
        assert "Anything I'd be good at" in body["name"]
        # The hidden resume type behind it is never listed.
        assert (await client.get("/v1/scout/tracks")).json() == []
        listed = (await client.get("/v1/scout/missions")).json()
        assert [m["broad"] for m in listed] == [True]

    async def test_a_scoped_search_still_needs_a_resume_type(self, client):
        r = await client.post("/v1/scout/missions", json={"source": "linkedin"})
        assert r.status_code == 422

    async def test_overrides_are_limited(self, client):
        too_many = {**SEARCH, "overrides": {"never": [f"T{i}" for i in range(21)]}}
        assert (
            await client.post("/v1/scout/missions", json=too_many)
        ).status_code == 422

    async def test_start_needs_a_resume(self, client, db_session, test_user):
        mission = (await client.post("/v1/scout/missions", json=SEARCH)).json()
        r = await client.post(f"/v1/scout/missions/{mission['id']}/runs")
        assert r.status_code == 422 and "resume" in r.json()["detail"]
        await _resume(db_session, test_user.id)
        r = await client.post(f"/v1/scout/missions/{mission['id']}/runs")
        assert r.status_code == 201
        assert r.json()["broad"] is True and r.json()["titles"] == []

    async def test_pin_and_block_by_editing_the_overrides(self, client):
        mission = (await client.post("/v1/scout/missions", json=SEARCH)).json()
        r = await client.patch(
            f"/v1/scout/missions/{mission['id']}",
            json={
                "overrides": {
                    "always": ["Jira Administrator", "Microsoft 365 Administrator"],
                    "never": ["Help Desk Technician"],
                    "avoid": ["sales"],
                }
            },
        )
        assert r.status_code == 200
        assert r.json()["overrides"]["never"] == ["Help Desk Technician"]


@pytest.mark.asyncio
class TestTitlesTried:
    async def test_lists_each_title_with_how_it_did(
        self, client, db_session, test_user
    ):
        mission = (await client.post("/v1/scout/missions", json=SEARCH)).json()
        now = datetime.now(UTC)
        for title, runs, fits, ago in (
            ("Desktop Support", 3, 0, 1),
            ("Microsoft 365 Administrator", 2, 3, 3),
            ("Jira Administrator", 4, 0, 2),
            ("Identity Analyst", 1, 0, 0),
        ):
            db_session.add(
                ScoutTitle(
                    id=uuid.uuid4(),
                    user_id=test_user.id,
                    mission_id=uuid.UUID(mission["id"]),
                    title=title,
                    title_key=title.lower(),
                    runs=runs,
                    good_fits=fits,
                    last_tried_at=now - timedelta(days=ago),
                )
            )
        await db_session.flush()
        r = await client.get(f"/v1/scout/missions/{mission['id']}/titles")
        assert r.status_code == 200
        rows = r.json()
        assert [t["title"] for t in rows] == [
            "Microsoft 365 Administrator",  # most good fits
            "Identity Analyst",  # then the most recent
            "Desktop Support",
            "Jira Administrator",
        ]
        by = {t["title"]: t for t in rows}
        assert by["Desktop Support"]["resting"] is True
        # An Always title never rests.
        assert by["Jira Administrator"]["always"] is True
        assert by["Jira Administrator"]["resting"] is False

    async def test_only_for_a_broad_search_of_your_own(
        self, client, db_session, test_user
    ):
        other = await _other_user(db_session)
        from app.schemas.scout import MissionCreate

        theirs = await scout_runs.create_mission(
            db_session, other.id, MissionCreate(source="linkedin", broad=True)
        )
        await db_session.flush()
        r = await client.get(f"/v1/scout/missions/{theirs.id}/titles")
        assert r.status_code == 404
        track = (
            await client.post("/v1/scout/tracks", json={"name": "IT Admin"})
        ).json()
        scoped = (
            await client.post(
                "/v1/scout/missions",
                json={"source": "linkedin", "track_id": track["id"]},
            )
        ).json()
        r = await client.get(f"/v1/scout/missions/{scoped['id']}/titles")
        assert r.status_code == 404
        assert scoped["broad"] is False
