"""Every Scout run scores against the user's real resume (spec 009, US1).

Claude reads it through the connector's get_master_profile tool; the brief
only says whether there is one. The resume itself is never stored on a run, a
finding or anywhere else Scout keeps. Invented people and companies throughout.
"""

import json
import uuid

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.resume import Resume
from app.models.scout import ScoutFinding, ScoutRun
from tests.test_mcp_scout import JOB_URL, _capture, _setup
from tests.test_mcp_server import _connected_user

RESUME = (
    "Avery Quill — IT Systems Administrator\n"
    "Brambleworks (2021–2025): ran Microsoft 365, Entra ID and Intune for 400 "
    "staff; automated onboarding with PowerShell.\n"
    "Certifications: MS-102 Microsoft 365 Administrator."
)


async def _resume(maker, user_id, text=RESUME, *, active=True):
    async with maker() as db:
        db.add(
            Resume(
                id=uuid.uuid4(),
                user_id=user_id,
                filename="resume.pdf",
                mime_type="application/pdf",
                file_size_bytes=1000,
                extracted_text=text,
                is_active=active,
            )
        )
        await db.commit()


@pytest.mark.asyncio
class TestBriefSaysToReadTheResume:
    async def test_with_a_resume_claude_reads_it_first(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="rg1@test.dev")
        user_id, _, _ = await _setup(maker, "rg1@test.dev")
        await _resume(maker, user_id)
        out = await mcp_mod.get_scout_brief()
        assert out["resume_ready"] is True
        assert out["next"].startswith("Call get_master_profile once")
        assert "start URL" in out["next"]
        assert "get_master_profile ONCE" in out["playbook"]
        assert "against the resume" in out["playbook"]

    @pytest.mark.parametrize(
        ("text", "active"), [(None, True), ("   ", True), (RESUME, False)]
    )
    async def test_no_usable_resume_scores_against_the_resume_type(
        self, engine, monkeypatch, text, active
    ):
        email = f"rg2-{uuid.uuid4().hex[:6]}@test.dev"
        maker = await _connected_user(engine, monkeypatch, email=email)
        user_id, _, _ = await _setup(maker, email)
        await _resume(maker, user_id, text, active=active)
        out = await mcp_mod.get_scout_brief()
        assert out["resume_ready"] is False
        assert "get_master_profile" not in out["next"]
        assert out["start_urls"]  # the run still goes

    async def test_the_brief_stays_small(self, engine, monkeypatch):
        maker = await _connected_user(engine, monkeypatch, email="rg3@test.dev")
        user_id, _, _ = await _setup(maker, "rg3@test.dev")
        await _resume(maker, user_id, RESUME * 40)
        out = await mcp_mod.get_scout_brief()
        assert len(json.dumps(out)) < 6000  # the resume isn't in it


@pytest.mark.asyncio
async def test_the_resume_is_never_stored_by_scout(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch, email="rg4@test.dev")
    user_id, _, run_id = await _setup(maker, "rg4@test.dev")
    await _resume(maker, user_id)
    await mcp_mod.get_scout_brief()
    await mcp_mod.check_jobs(
        str(run_id),
        [
            {
                "company": "Brambleworks",
                "title": "IT Systems Administrator",
                "url": JOB_URL,
            }
        ],
    )
    await _capture(maker, user_id)
    await mcp_mod.report_job(str(run_id), JOB_URL, 8, "Ran Microsoft 365", "")
    async with maker() as db:
        run = await db.get(ScoutRun, run_id)
        stored = json.dumps([run.criteria, run.stats])
        stored += json.dumps(
            [
                (f.why_fit, f.gaps, f.app_note)
                for f in (await db.scalars(select(ScoutFinding))).all()
            ]
        )
    assert "MS-102" not in stored and "Avery" not in stored
