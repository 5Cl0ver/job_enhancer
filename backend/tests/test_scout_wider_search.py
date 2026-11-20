"""Claude Scout casts a wider, correctly placed net (spec 011): titles as
plain words with related ones, the degree rule honoured and off by default,
LinkedIn's place learned and kept, each search's result count reported, and a
low score no longer hiding a job everywhere for good. Invented data."""

from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import AsyncClient
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.scout import ScoutFinding, ScoutMission, ScoutRun
from app.schemas.scout import SkipRules, TrackCreate, TrackUpdate
from app.services import scout_instructions as instr
from app.services import scout_runs, scout_tracks
from tests.test_mcp_scout import JOB_URL, _capture, _setup, _setup_second_run
from tests.test_mcp_server import _connected_user

LANDED = (
    "https://www.linkedin.com/jobs/search-results/?keywords=IT+Systems+Administrator"
    "&geoId=104170880&f_TPR=r86400&distance=25"
)


def _q(url):
    return parse_qs(urlsplit(url).query)


class TestDegreeRule:
    def test_off_by_default(self):
        assert SkipRules().degree_only is False
        assert TrackCreate(name="IT Admin").skip_rules.degree_only is False

    def test_the_steps_follow_the_switch_and_never_cap_when_off(self):
        steps = instr.ORIGINALS["playbook"]
        assert "track.skip" in steps
        assert "When degree_only is false" in steps
        assert "never skip a job or lower its score for a degree" in steps
        line = instr.rubric_text(instr.RUBRIC)
        assert "experience met" in line and "equal to a degree" in line
        assert "Pay that isn't listed counts as met" in line


@pytest.mark.asyncio
class TestLinkedInPlace:
    async def test_brief_carries_the_place_and_radius(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="w1@test.dev")
        await _setup(maker, "w1@test.dev")
        brief = await mcp_mod.get_scout_brief()
        assert brief["place"] == {
            "location": "Springfield, IL",
            "geo_id": None,
            "radius_miles": 25,
            "linkedin_distance": 25,
        }
        q = _q(brief["start_urls"][0])
        assert q["keywords"] == ["IT Systems Administrator"]
        assert q["location"] == ["Springfield, IL"] and q["distance"] == ["25"]
        assert q["f_TPR"] == ["r604800"] and q["sortBy"] == ["DD"]
        assert "geoId" not in q and "f_WT" not in q

    async def test_a_fixed_place_is_kept_for_this_and_later_runs(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="w2@test.dev")
        _, _, run_id = await _setup(maker, "w2@test.dev", job_count=10)
        await mcp_mod.get_scout_brief()
        rows = [{"company": "Vellacor", "title": "IT Systems Administrator"}]
        out = await mcp_mod.check_jobs(
            str(run_id), rows, total_results=40, page_url=LANDED, place_fixed=True
        )
        assert "The place is saved" in out["next"]
        assert _q(out["next_page_url"])["geoId"] == ["104170880"]
        async with maker() as db:
            run = await db.get(ScoutRun, run_id)
            mission = await db.get(ScoutMission, run.mission_id)
            assert mission.linkedin_geo_id == "104170880"
        await mcp_mod.finish_scout_run(str(run_id), "")
        _, _, second = await _setup_second_run(maker, "w2@test.dev")
        brief = await mcp_mod.get_scout_brief(str(second))
        assert brief["place"]["geo_id"] == "104170880"
        assert _q(brief["start_urls"][0])["geoId"] == ["104170880"]

    async def test_without_place_fixed_the_landed_id_isnt_trusted(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="w3@test.dev")
        _, _, run_id = await _setup(maker, "w3@test.dev")
        await mcp_mod.get_scout_brief()
        await mcp_mod.check_jobs(
            str(run_id),
            [{"company": "Vellacor", "title": "IT Systems Administrator"}],
            page_url=LANDED,
        )
        async with maker() as db:
            run = await db.get(ScoutRun, run_id)
            mission = await db.get(ScoutMission, run.mission_id)
            assert mission.linkedin_geo_id is None

    async def test_a_new_place_forgets_the_old_id(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="w4@test.dev")
        user_id, _, run_id = await _setup(maker, "w4@test.dev")
        async with maker() as db:
            run = await db.get(ScoutRun, run_id)
            mission = await db.get(ScoutMission, run.mission_id)
            mission.linkedin_geo_id = "104170880"
            await db.commit()
            from app.schemas.scout import MissionUpdate

            await scout_runs.update_mission(
                db, mission.id, user_id, MissionUpdate(min_fit=7)
            )
            assert mission.linkedin_geo_id == "104170880"
            await scout_runs.update_mission(
                db, mission.id, user_id, MissionUpdate(location="Beaverton, OR")
            )
            assert mission.linkedin_geo_id is None

    async def test_result_counts_and_dropped_filters_are_reported(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="w5@test.dev")
        _, _, run_id = await _setup(maker, "w5@test.dev", job_count=10)
        await mcp_mod.get_scout_brief()
        await mcp_mod.check_jobs(
            str(run_id),
            [{"company": "Vellacor", "title": "IT Systems Administrator"}],
            total_results=4,
            page_url=LANDED,  # no location or sortBy: the redirect dropped them
        )
        async with maker() as db:
            run = await db.get(ScoutRun, run_id)
            (out,) = await scout_runs.runs_out(db, [run])
            assert out.links[0].title == "IT Systems Administrator"
            assert out.links[0].total == 4 and out.links[0].pages == 1
            assert out.links[0].dropped == ["location", "sortBy"]
            assert "_links" not in (out.looked_at or {})


@pytest.mark.asyncio
class TestWhatsHidden:
    async def test_a_low_score_hides_a_job_only_for_its_own_resume_type(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="h1@test.dev")
        user_id, track_id, run_id = await _setup(maker, "h1@test.dev")
        await mcp_mod.get_scout_brief()
        await _capture(maker, user_id)
        out = await mcp_mod.report_job(str(run_id), JOB_URL, 3, "", "needs a degree")
        assert out["outcome"] == "below_bar"
        await mcp_mod.finish_scout_run(str(run_id), "")
        row = [
            {
                "company": "Brambleworks",
                "title": "IT Systems Administrator",
                "url": JOB_URL,
            }
        ]
        # The same resume type: still seen.
        _, _, again = await _setup_second_run(maker, "h1@test.dev")
        await mcp_mod.get_scout_brief(str(again))
        assert (await mcp_mod.check_jobs(str(again), row))["open"] == []
        await mcp_mod.finish_scout_run(str(again), "")
        # Another resume type: a fresh look.
        _, _, other = await _setup(maker, "h1@test.dev", track_name="Help Desk")
        await mcp_mod.get_scout_brief(str(other))
        assert (await mcp_mod.check_jobs(str(other), row))["open"] == [0]
        await mcp_mod.finish_scout_run(str(other), "")
        # The first type's rules change: a fresh look there too.
        async with maker() as db:
            await scout_tracks.update_track(
                db,
                track_id,
                user_id,
                TrackUpdate(skip_rules=SkipRules(degree_only=False)),
            )
            await db.commit()
        async with maker() as db:
            first = await db.get(ScoutRun, run_id)
            fresh = (await scout_runs.queue_run(db, first.mission_id, user_id)).id
            await db.commit()
        await mcp_mod.get_scout_brief(str(fresh))
        assert (await mcp_mod.check_jobs(str(fresh), row))["open"] == [0]

    async def test_a_job_the_user_decided_on_stays_hidden_everywhere(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="h2@test.dev")
        user_id, _, run_id = await _setup(maker, "h2@test.dev")
        await mcp_mod.get_scout_brief()
        await _capture(maker, user_id)
        out = await mcp_mod.report_job(str(run_id), JOB_URL, 9, "Ran M365", "")
        assert out["outcome"] == "picked"
        await mcp_mod.finish_scout_run(str(run_id), "")
        _, _, other = await _setup(maker, "h2@test.dev", track_name="Help Desk")
        await mcp_mod.get_scout_brief(str(other))
        row = [
            {
                "company": "Brambleworks",
                "title": "IT Systems Administrator",
                "url": JOB_URL,
            }
        ]
        assert (await mcp_mod.check_jobs(str(other), row))["open"] == []

    async def test_only_reported_jobs_are_hidden_not_listed_ones(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="h3@test.dev")
        _, _, run_id = await _setup(maker, "h3@test.dev")
        await mcp_mod.get_scout_brief()
        row = [{"company": "Quillstone", "title": "IT Administrator", "url": JOB_URL}]
        await mcp_mod.check_jobs(str(run_id), row)  # listed, never opened
        await mcp_mod.finish_scout_run(str(run_id), "")
        _, _, again = await _setup_second_run(maker, "h3@test.dev")
        await mcp_mod.get_scout_brief(str(again))
        assert (await mcp_mod.check_jobs(str(again), row))["open"] == [0]
        async with maker() as db:
            assert (await db.scalars(select(ScoutFinding))).all() == []


@pytest.mark.asyncio
class TestPassedTitlesOnThePage:
    async def test_view_and_start_fresh(
        self, client: AsyncClient, db_session, test_user
    ):
        r = await client.post(
            "/v1/scout/tracks",
            json={
                "name": "IT Admin",
                "target_titles": ["IT Administrator"],
                "related_titles": ["Systems Administrator", "M365 Admin"],
            },
        )
        track = r.json()
        assert track["related_titles"] == ["Systems Administrator", "M365 Admin"]
        assert track["exact_titles"] is False
        assert track["skip_rules"]["degree_only"] is False
        import uuid

        from app.models.scout import ScoutPass

        for title in ("registered nurse", "registered nurse", "barista"):
            db_session.add(
                ScoutPass(
                    id=uuid.uuid4(),
                    user_id=test_user.id,
                    track_id=uuid.UUID(track["id"]),
                    company_key=f"co {title}",
                    title_key=title,
                )
            )
        await db_session.flush()
        r = await client.get(f"/v1/scout/tracks/{track['id']}/passes")
        assert r.json()["count"] == 3
        assert r.json()["titles"][0] == {"title": "registered nurse", "times": 2}
        r = await client.post(f"/v1/scout/tracks/{track['id']}/start-fresh")
        assert r.status_code == 204
        r = await client.get(f"/v1/scout/tracks/{track['id']}/passes")
        assert r.json()["count"] == 0 and r.json()["since"] is not None
