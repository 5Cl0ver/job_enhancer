"""The run log: every Scout connector call, what Claude sent and what the app
answered, in plain words (spec 010). Never the resume, never the instruction
texts. Invented people and companies throughout."""

import json

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.scout import ScoutRunEvent
from app.services import scout_instructions as instr
from app.services import scout_log
from tests.test_mcp_scout import JOB_URL, ROWS, _capture, _setup, _setup_second_run
from tests.test_mcp_server import _connected_user
from tests.test_scout_resume_grounding import RESUME, _resume


async def _events(maker, run_id=None):
    async with maker() as db:
        q = select(ScoutRunEvent).order_by(ScoutRunEvent.created_at)
        if run_id:
            q = q.where(ScoutRunEvent.run_id == run_id)
        return list((await db.scalars(q)).all())


@pytest.mark.asyncio
class TestEveryCallIsLogged:
    async def test_a_run_from_start_to_finish(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="g1@test.dev")
        user_id, _, run_id = await _setup(maker, "g1@test.dev", job_count=1)
        await _resume(maker, user_id)
        await mcp_mod.get_scout_brief()
        await mcp_mod.get_master_profile()
        await mcp_mod.check_jobs(str(run_id), ROWS)
        await _capture(maker, user_id)
        await mcp_mod.report_job(str(run_id), JOB_URL, 8, "Ran Microsoft 365", "")
        await mcp_mod.finish_scout_run(str(run_id), "one strong match")
        events = await _events(maker, run_id)
        assert [e.tool for e in events] == [
            "get_scout_brief",
            "get_master_profile",
            "check_jobs",
            "report_job",
            "finish_scout_run",
        ]
        assert all(e.ok for e in events)
        summaries = [e.summary for e in events]
        assert summaries[0] == "Gave Claude the brief for LinkedIn; resume ready"
        assert summaries[1] == "Read your resume (not stored here)"
        assert summaries[2] == (
            "Checked 3 jobs on page 1: 1 to open, 2 titles didn't fit"
        )
        assert summaries[3] == (
            "Reported a job on linkedin.com: scored 8/10, a good fit, waiting for you"
        )
        assert summaries[4] == "Finished: 1 good fit"
        # What Claude sent, and what the app answered.
        assert events[2].request["rows"][1]["title"] == "Registered Nurse"
        assert events[2].response["open"] == [0]
        assert events[3].request["why_fit"] == "Ran Microsoft 365"

    async def test_no_instruction_texts_and_no_resume(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="g2@test.dev")
        user_id, _, run_id = await _setup(maker, "g2@test.dev")
        await _resume(maker, user_id)
        async with maker() as db:
            await instr.save(db, user_id, "playbook", text="My own steps, edited.")
            await db.commit()
        _, _, second = await _setup_second_run(maker, "g2@test.dev")
        await mcp_mod.get_scout_brief(str(second))
        await mcp_mod.get_master_profile()
        stored = json.dumps(
            [(e.summary, e.request, e.response) for e in await _events(maker)]
        )
        assert "My own steps" not in stored
        assert instr.RULES[:40] not in stored
        assert "MS-102" not in stored and "Avery" not in stored  # the resume
        (brief,) = [
            e for e in await _events(maker, second) if e.tool == "get_scout_brief"
        ]
        assert brief.response["playbook"].startswith("[Main steps: your edit of ")
        assert brief.response["start_urls"]

    async def test_a_refused_call_is_logged_and_still_refused(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="g3@test.dev")
        _, _, run_id = await _setup(maker, "g3@test.dev")
        await mcp_mod.get_scout_brief()
        with pytest.raises(ValueError, match="at most 30"):
            await mcp_mod.check_jobs(
                str(run_id), [{"company": "Vellacor", "title": "T"}] * 31
            )
        out = await mcp_mod.report_job(
            str(run_id), "https://www.linkedin.com/jobs/search/?keywords=x", 8, "", ""
        )
        assert out["outcome"] == "rejected_link"
        refused, rejected = (await _events(maker, run_id))[1:]
        assert refused.ok is False and refused.summary.startswith(
            "Refused: Send at most 30"
        )
        assert refused.response == {"error": refused.summary.removeprefix("Refused: ")}
        assert rejected.ok is True and "link turned down" in rejected.summary

    async def test_reading_the_resume_with_no_search_going_isnt_logged(
        self, engine, monkeypatch
    ):
        maker = await _connected_user(engine, monkeypatch, email="g4@test.dev")
        user_id, _, _ = await _setup(maker, "g4@test.dev")  # queued, not running
        await _resume(maker, user_id, RESUME)
        assert "Avery" in await mcp_mod.get_master_profile()
        assert await _events(maker) == []


class TestTrimAndCap:
    def test_long_detail_is_trimmed(self):
        out = scout_log.trim({"rows": ["x" * 100] * 200})
        assert set(out) == {"trimmed"} and len(out["trimmed"]) == scout_log.MAX_DETAIL
        assert scout_log.trim({"a": 1}) == {"a": 1}
        assert scout_log.trim(None) is None
        assert scout_log.trim("text") == {"value": "text"}

    @pytest.mark.asyncio
    async def test_at_most_400_entries_then_a_count(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="t1@test.dev")
        _, _, run_id = await _setup(maker, "t1@test.dev")
        await mcp_mod.get_scout_brief()
        monkeypatch.setattr(scout_log, "MAX_EVENTS", 4)
        for _ in range(6):
            await mcp_mod.check_jobs(str(run_id), [])
        events = await _events(maker, run_id)
        assert len(events) == 4
        assert events[-1].tool == "more"
        # brief, 2 checks, then the last slot counts the other 4 checks
        assert events[-1].summary == "4 more calls not logged"
