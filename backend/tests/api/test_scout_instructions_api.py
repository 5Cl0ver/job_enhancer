"""The page's side of the Instructions tab and the run log (spec 010):
owner only, checked at the edge, the locked parts read-only. Invented data."""

import uuid

import pytest
from httpx import AsyncClient

from app.models.scout import ScoutInstructionVersion, ScoutRun, ScoutRunEvent
from app.services import scout_instructions as instr
from tests.api.test_scout_tracks import _other_user


@pytest.mark.asyncio
class TestInstructionsPage:
    async def test_everything_claude_is_told(self, client: AsyncClient):
        r = await client.get("/v1/scout/instructions")
        assert r.status_code == 200
        body = r.json()
        assert [s["key"] for s in body["sections"]] == list(instr.KEYS)
        assert body["locked_rules"] == instr.RULES
        assert body["rubric_text"].startswith("Rubric (out of 10")
        names = [t["name"] for t in body["tools"]]
        assert {"get_scout_brief", "check_jobs", "set_search_titles"} <= set(names)
        assert all(t["description"] for t in body["tools"])
        assert "Job Scout" in body["connector_note"]
        assert body["fixed_limits"][0]["value"] == "30 days"

    async def test_save_history_restore_reset(self, client: AsyncClient):
        r = await client.put("/v1/scout/instructions/playbook", json={"text": "Mine."})
        assert r.status_code == 200 and r.json()["edited"] is True
        r = await client.put(
            "/v1/scout/instructions/limits", json={"values": {"search_pages": 6}}
        )
        assert r.json()["current"] == {
            "links": 6,
            "search_pages": 6,
            "titles": 8,
            "companies": 15,
        }
        r = await client.post("/v1/scout/instructions/playbook/reset")
        assert r.json()["edited"] is False
        hist = (await client.get("/v1/scout/instructions/playbook/history")).json()
        assert [h["reset"] for h in hist] == [True, False]
        r = await client.post(
            f"/v1/scout/instructions/playbook/restore/{hist[1]['id']}"
        )
        assert r.json()["current"] == "Mine."

    async def test_refused_with_the_reason(self, client: AsyncClient):
        r = await client.put(
            "/v1/scout/instructions/rubric",
            json={"values": {**instr.RUBRIC, "skills": 5}},
        )
        assert r.status_code == 422 and "now 11" in r.json()["detail"]
        r = await client.put("/v1/scout/instructions/rules", json={"text": "x"})
        assert r.status_code == 404
        r = await client.put(
            "/v1/scout/instructions/playbook", json={"text": "x" * 20001}
        )
        assert r.status_code == 422

    async def test_another_users_version_cant_be_restored(
        self, client: AsyncClient, db_session
    ):
        other = await _other_user(db_session)
        theirs = ScoutInstructionVersion(
            id=uuid.uuid4(), user_id=other.id, key="playbook", body="Theirs."
        )
        db_session.add(theirs)
        await db_session.flush()
        r = await client.post(f"/v1/scout/instructions/playbook/restore/{theirs.id}")
        assert r.status_code == 404
        r = await client.get("/v1/scout/instructions")
        playbook = r.json()["sections"][0]
        assert playbook["edited"] is False


@pytest.mark.asyncio
class TestPreviewAndLog:
    async def test_preview_creates_nothing(self, client: AsyncClient):
        track = (
            await client.post("/v1/scout/tracks", json={"name": "IT Admin"})
        ).json()
        mission = (
            await client.post(
                "/v1/scout/missions",
                json={"source": "indeed", "track_id": track["id"]},
            )
        ).json()
        r = await client.get(f"/v1/scout/missions/{mission['id']}/preview")
        assert r.status_code == 200
        body = r.json()
        assert body["preview"] is True and body["run_id"] is None
        assert body["playbook"].endswith(instr.RULES)
        assert (await client.get("/v1/scout/runs")).json() == []

    async def test_the_log_is_the_owners_only(
        self, client: AsyncClient, db_session, test_user
    ):
        track = (
            await client.post("/v1/scout/tracks", json={"name": "IT Admin"})
        ).json()
        mission = (
            await client.post(
                "/v1/scout/missions",
                json={"source": "linkedin", "track_id": track["id"]},
            )
        ).json()
        run = (await client.post(f"/v1/scout/missions/{mission['id']}/runs")).json()
        db_session.add(
            ScoutRunEvent(
                id=uuid.uuid4(),
                user_id=test_user.id,
                run_id=uuid.UUID(run["id"]),
                tool="check_jobs",
                summary="Checked 3 jobs on page 1: 1 to open",
                request={"rows": []},
                response={"open": [0]},
                ok=True,
            )
        )
        await db_session.flush()
        r = await client.get(f"/v1/scout/runs/{run['id']}/log")
        assert r.status_code == 200
        assert [e["summary"] for e in r.json()] == [
            "Checked 3 jobs on page 1: 1 to open"
        ]
        assert run["instructions"]["playbook"] is None  # the original
        # Someone else's run: no such run for this user.
        other = await _other_user(db_session)
        theirs = ScoutRun(
            id=uuid.uuid4(),
            user_id=other.id,
            criteria={},
            playbook_version="x",
            status="done",
        )
        db_session.add(theirs)
        await db_session.flush()
        assert (await client.get(f"/v1/scout/runs/{theirs.id}/log")).status_code == 404
