"""Tests for the MCP connector — the Claude-facing tool surface.

The tools themselves run inside FastMCP's auth context (a Supabase JWT), so we
test the two things that matter without that machinery: that the tools are
registered as Claude will see them, and that the save_job path actually persists
a Claude-discovered job into the user's tracker (via the same validated
manual-save service the tool calls).
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import app.mcp_server as mcp_mod
from app.mcp_server import mcp
from app.models.saved_job import SavedJob
from app.schemas.saved_job import ManualJobCreate
from app.services import saved_jobs as sj_svc
from app.services.users import create_user

EXPECTED_TOOLS = {
    "list_jobs",
    "get_job",
    "get_master_profile",
    "get_pipeline",
    "save_job",
    "save_draft",
    "set_status",
    "mark_emailed",
    "flag_for_research",
}


@pytest.mark.asyncio
async def test_expected_tools_are_registered():
    names = {t.name for t in await mcp.list_tools()}
    assert names >= EXPECTED_TOOLS


@pytest.mark.asyncio
async def test_save_job_exposes_the_fields_claude_needs():
    tool = next(t for t in await mcp.list_tools() if t.name == "save_job")
    schema = tool.parameters or {}
    props = set(schema.get("properties", {}))
    # Claude must be able to supply the core posting fields.
    assert {"title", "company", "apply_url"} <= props
    required = set(schema.get("required", []))
    assert {"title", "company", "apply_url"} <= required


@pytest.mark.asyncio
async def test_claude_discovered_job_lands_in_tracker(db_session, test_user):
    # Mirrors what save_job does internally: build the validated payload from the
    # fields Claude supplies, then persist via the shared manual-save path.
    data = ManualJobCreate(
        url="https://boards.greenhouse.io/acme/jobs/123",
        title="Backend Engineer",
        company="Acme",
        location="Portland, OR",
        is_remote=True,
        description="Build APIs at scale.",
        salary_min=120000,
        salary_max=150000,
        salary_period="yearly",
    )
    sj = await sj_svc.save_manual_job(db_session, test_user.id, data)
    await db_session.commit()

    rows = (
        await db_session.scalars(
            select(SavedJob).where(SavedJob.user_id == test_user.id)
        )
    ).all()
    assert any(s.id == sj.id for s in rows)
    assert sj.job_listing.title == "Backend Engineer"
    assert sj.job_listing.company == "Acme"
    assert sj.job_listing.is_remote is True


@pytest.mark.asyncio
async def test_save_job_tool_end_to_end(engine, monkeypatch):
    """Drive the actual save_job tool through its real code path: identity from
    the token's email claim, its own DB session, commit — the way Claude calls
    it. We point the tool's session factory + token resolver at the test DB."""
    maker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with maker() as s:
        await create_user(s, email="claude@test.dev", name="Claude User")
        await s.commit()

    monkeypatch.setattr(mcp_mod, "AsyncSessionLocal", maker)
    monkeypatch.setattr(
        mcp_mod,
        "get_access_token",
        lambda: type("Tok", (), {"claims": {"email": "claude@test.dev"}})(),
    )

    out = await mcp_mod.save_job(
        title="Platform Engineer",
        company="Umbrella",
        apply_url="https://boards.greenhouse.io/umbrella/jobs/9",
        location="Seattle, WA",
        salary_min=140000,
        salary_period="yearly",
    )
    assert out["title"] == "Platform Engineer"
    assert out["company"] == "Umbrella"

    async with maker() as s:
        rows = (await s.scalars(select(SavedJob))).all()
        assert any(str(r.id) == out["job_id"] for r in rows)
