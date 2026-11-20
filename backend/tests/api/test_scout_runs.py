"""Claude Scout page endpoints: saved searches, Start, runs, extension captures."""

import pytest
from httpx import AsyncClient

from tests.api.test_scout_tracks import IT_ADMIN, _other_user

DESCRIPTION = "Quillstone is hiring a Jira Administrator. " * 10


async def _track(client: AsyncClient) -> str:
    r = await client.post("/v1/scout/tracks", json=IT_ADMIN)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
class TestMissions:
    async def test_create_names_itself_edit_delete(self, client: AsyncClient):
        track_id = await _track(client)
        r = await client.post(
            "/v1/scout/missions",
            json={"source": "linkedin", "track_id": track_id, "posted_within_days": 7},
        )
        assert r.status_code == 201, r.text
        mission = r.json()
        assert mission["name"] == "LinkedIn · IT Admin · 5 · last 7 days"
        assert mission["min_fit"] == 6 and mission["remote"] == "any"

        r = await client.patch(
            f"/v1/scout/missions/{mission['id']}",
            json={"job_count": 3, "min_pay": None},
        )
        assert r.json()["job_count"] == 3
        # An automatic name follows the search; a name the user typed stays.
        assert r.json()["name"] == "LinkedIn · IT Admin · 3 · last 7 days"
        r = await client.patch(
            f"/v1/scout/missions/{mission['id']}", json={"name": "Morning LinkedIn"}
        )
        r = await client.patch(
            f"/v1/scout/missions/{mission['id']}", json={"job_count": 4}
        )
        assert r.json()["name"] == "Morning LinkedIn"
        assert len((await client.get("/v1/scout/missions")).json()) == 1
        assert (
            await client.delete(f"/v1/scout/missions/{mission['id']}")
        ).status_code == 204
        assert (await client.get("/v1/scout/missions")).json() == []

    async def test_within_n_miles_is_kept_and_can_be_cleared(self, client: AsyncClient):
        track_id = await _track(client)
        r = await client.post(
            "/v1/scout/missions",
            json={
                "source": "linkedin",
                "track_id": track_id,
                "location": "Springfield, IL",
                "radius_miles": 25,
            },
        )
        assert r.status_code == 201, r.text
        mission = r.json()
        assert mission["radius_miles"] == 25

        run = (await client.post(f"/v1/scout/missions/{mission['id']}/runs")).json()
        assert run["status"] == "queued"
        await client.post(f"/v1/scout/runs/{run['id']}/stop")

        r = await client.patch(
            f"/v1/scout/missions/{mission['id']}", json={"radius_miles": None}
        )
        assert r.json()["radius_miles"] is None

    @pytest.mark.parametrize(
        "bad",
        [
            {"source": "glassdoor"},
            {"job_count": 11},
            {"posted_within_days": 5},
            {"min_fit": 11},
            {"radius_miles": 7},
        ],
    )
    async def test_bad_input(self, client: AsyncClient, bad):
        track_id = await _track(client)
        body = {"source": "linkedin", "track_id": track_id, **bad}
        assert (await client.post("/v1/scout/missions", json=body)).status_code == 422

    async def test_cannot_use_someone_elses_resume_type(
        self, client: AsyncClient, db_session
    ):
        from app.models.resume_track import ResumeTrack

        other = await _other_user(db_session)
        theirs = ResumeTrack(
            user_id=other.id,
            name="Theirs",
            target_titles=[],
            key_skills=[],
            skip_rules={},
        )
        db_session.add(theirs)
        await db_session.flush()
        r = await client.post(
            "/v1/scout/missions", json={"source": "indeed", "track_id": str(theirs.id)}
        )
        assert r.status_code == 404


@pytest.mark.asyncio
class TestRuns:
    async def test_start_queues_a_run_and_stop_ends_it(self, client: AsyncClient):
        track_id = await _track(client)
        mission = (
            await client.post(
                "/v1/scout/missions", json={"source": "indeed", "track_id": track_id}
            )
        ).json()
        r = await client.post(f"/v1/scout/missions/{mission['id']}/runs")
        assert r.status_code == 201, r.text
        run = r.json()
        assert run["status"] == "queued" and run["target"] == 5
        assert run["track_name"] == "IT Admin"
        assert run["counts"]["saved"] == 0

        listed = (await client.get("/v1/scout/runs")).json()
        assert [x["id"] for x in listed] == [run["id"]]
        # Queued counts as open: the user presses Start, then pastes the line.
        assert (await client.get("/v1/scout/runs/active")).json() == {
            "run_id": run["id"]
        }

        stopped = (await client.post(f"/v1/scout/runs/{run['id']}/stop")).json()
        assert stopped["status"] == "stopped"
        assert (await client.get(f"/v1/scout/runs/{run['id']}")).json()[
            "findings"
        ] == []

    async def test_capture_needs_an_open_run_and_a_posting_link(
        self, client: AsyncClient, db_session
    ):
        from app.models.scout import ScoutRun

        track_id = await _track(client)
        mission = (
            await client.post(
                "/v1/scout/missions", json={"source": "linkedin", "track_id": track_id}
            )
        ).json()
        body = {
            "url": "https://www.linkedin.com/jobs/view/4099/",
            "title": "Jira Administrator",
            "company": "Quillstone",
            "description": DESCRIPTION,
        }
        assert (await client.post("/v1/scout/captures", json=body)).json() == {
            "stored": False
        }

        run = (await client.post(f"/v1/scout/missions/{mission['id']}/runs")).json()
        row = await db_session.get(ScoutRun, __import__("uuid").UUID(run["id"]))
        row.status = "running"
        await db_session.flush()
        assert (await client.get("/v1/scout/runs/active")).json()["run_id"] == run["id"]
        assert (await client.post("/v1/scout/captures", json=body)).json() == {
            "stored": True
        }
        search = {**body, "url": "https://www.linkedin.com/jobs/search/?keywords=jira"}
        assert (await client.post("/v1/scout/captures", json=search)).json() == {
            "stored": False
        }
        short = {**body, "description": "Too short to be the real posting."}
        assert (await client.post("/v1/scout/captures", json=short)).status_code == 422
