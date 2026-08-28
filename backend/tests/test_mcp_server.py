"""Tests for the MCP connector — the Claude-facing tool surface.

The tools themselves run inside FastMCP's auth context (a Supabase JWT), so we
test the two things that matter without that machinery: that the tools are
registered as Claude will see them, and that the save_job path actually persists
a Claude-discovered job into the user's tracker (via the same validated
manual-save service the tool calls).
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import app.mcp_server as mcp_mod
from app.mcp_server import mcp
from app.models.saved_job import SavedJob
from app.models.user import User
from app.schemas.collection import CollectionCreate
from app.schemas.saved_job import ManualJobCreate
from app.services import collections as col_svc
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
    "list_collections",
    "move_to_collection",
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


async def _connected_user(engine, monkeypatch, email="claude@test.dev"):
    """Wire the tools to the test DB and to a token claiming `email`, the way a
    real connector call arrives. Returns the session factory."""
    maker = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with maker() as s:
        await create_user(s, email=email, name="Claude User")
        await s.commit()
    monkeypatch.setattr(mcp_mod, "AsyncSessionLocal", maker)
    monkeypatch.setattr(
        mcp_mod,
        "get_access_token",
        lambda: type("Tok", (), {"claims": {"email": email}})(),
    )
    return maker


@pytest.mark.asyncio
async def test_save_job_files_into_a_named_collection(engine, monkeypatch):
    """The point of the collection argument: a job Claude saves lands in the
    user's folder, not just the default one."""
    maker = await _connected_user(engine, monkeypatch)
    async with maker() as s:
        user = await s.scalar(select(User).where(User.email == "claude@test.dev"))
        col = await col_svc.create_collection(
            s, user.id, CollectionCreate(name="Claude")
        )
        col_id = col.id
        await s.commit()

    out = await mcp_mod.save_job(
        title="Staff Engineer",
        company="Initech",
        apply_url="https://boards.greenhouse.io/initech/jobs/7",
        collection="claude",  # case-insensitive on purpose
    )
    assert out["collection"] == "Claude"

    async with maker() as s:
        sj = await s.scalar(
            select(SavedJob).where(SavedJob.id == uuid.UUID(out["job_id"]))
        )
        assert sj.collection_id == col_id


@pytest.mark.asyncio
async def test_move_to_collection_refiles_an_existing_job(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch, email="mover@test.dev")
    async with maker() as s:
        user = await s.scalar(select(User).where(User.email == "mover@test.dev"))
        col = await col_svc.create_collection(
            s, user.id, CollectionCreate(name="Dream Jobs")
        )
        col_id = col.id
        await s.commit()

    saved = await mcp_mod.save_job(
        title="Principal Engineer",
        company="Hooli",
        apply_url="https://boards.greenhouse.io/hooli/jobs/3",
    )
    moved = await mcp_mod.move_to_collection(saved["job_id"], "Dream Jobs")
    assert moved["collection"] == "Dream Jobs"

    async with maker() as s:
        sj = await s.scalar(
            select(SavedJob).where(SavedJob.id == uuid.UUID(saved["job_id"]))
        )
        assert sj.collection_id == col_id


@pytest.mark.asyncio
async def test_unknown_collection_names_the_real_ones(engine, monkeypatch):
    """A wrong folder name must not silently save to the default — it errors with
    the user's actual collections so Claude can retry correctly."""
    await _connected_user(engine, monkeypatch, email="strict@test.dev")
    with pytest.raises(ValueError, match="No collection named 'Nope'"):
        await mcp_mod.save_job(
            title="Engineer",
            company="Acme",
            apply_url="https://boards.greenhouse.io/acme/jobs/1",
            collection="Nope",
        )


@pytest.mark.asyncio
async def test_saving_an_already_saved_job_still_refiles_it(engine, monkeypatch):
    """Regression: save_manual_job returns an already-saved job untouched, so the
    folder on the payload never landed. Naming a collection is explicit — a second
    save into a folder must file it there, not silently drop the instruction."""
    maker = await _connected_user(engine, monkeypatch, email="refile@test.dev")
    async with maker() as s:
        user = await s.scalar(select(User).where(User.email == "refile@test.dev"))
        col = await col_svc.create_collection(
            s, user.id, CollectionCreate(name="Shortlist")
        )
        col_id = col.id
        await s.commit()

    args = dict(
        title="Data Engineer",
        company="Globex",
        apply_url="https://boards.greenhouse.io/globex/jobs/11",
    )
    first = await mcp_mod.save_job(**args)
    assert first["collection"] is None

    second = await mcp_mod.save_job(**args, collection="Shortlist")
    assert second["job_id"] == first["job_id"]  # same job, not a duplicate
    assert second["collection"] == "Shortlist"

    async with maker() as s:
        sj = await s.scalar(
            select(SavedJob).where(SavedJob.id == uuid.UUID(first["job_id"]))
        )
        assert sj.collection_id == col_id


@pytest.mark.asyncio
async def test_saving_without_a_collection_leaves_the_job_unfiled(engine, monkeypatch):
    """The docstring promises the app's own behavior: no folder named, no folder
    assigned. Guards against quietly defaulting into the default collection."""
    maker = await _connected_user(engine, monkeypatch, email="unfiled@test.dev")
    out = await mcp_mod.save_job(
        title="SRE",
        company="Soylent",
        apply_url="https://boards.greenhouse.io/soylent/jobs/2",
    )
    assert out["collection"] is None
    async with maker() as s:
        sj = await s.scalar(
            select(SavedJob).where(SavedJob.id == uuid.UUID(out["job_id"]))
        )
        assert sj.collection_id is None


@pytest.mark.asyncio
async def test_a_name_matching_two_collections_asks_instead_of_guessing(
    engine, monkeypatch
):
    """uq_collection_user_name is case-sensitive, so "Remote" and "remote" can both
    exist while our matching is case-insensitive. Filing into whichever sorted
    first would be a silent misfile."""
    maker = await _connected_user(engine, monkeypatch, email="ambiguous@test.dev")
    async with maker() as s:
        user = await s.scalar(select(User).where(User.email == "ambiguous@test.dev"))
        await col_svc.create_collection(s, user.id, CollectionCreate(name="Remote"))
        await col_svc.create_collection(s, user.id, CollectionCreate(name="remote"))
        await s.commit()

    with pytest.raises(ValueError, match="matches more than one"):
        await mcp_mod.save_job(
            title="Engineer",
            company="Acme",
            apply_url="https://boards.greenhouse.io/acme/jobs/4",
            collection="REMOTE",
        )
