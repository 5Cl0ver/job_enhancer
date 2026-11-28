"""The app and the Apply / Scout flow (spec 040). Invented data throughout.

- A fix Claude calls done while Job Catcher's reading of the page still shows
  the old answer (and nothing on the page changed) goes back to Claude once.
- "Also write a cover letter for this job" with Use it on the résumé.
- Scout: a sign-in wall asks the user and waits; the run log says so; a
  running search says what Claude did last.
- The server keeps itself awake on Render only.
"""

import pytest

import app.mcp_server as mcp_mod
from app.models.scout import ScoutRun
from app.services import apply_runs as svc
from app.services import apply_sheet as sheet_svc
from app.services import keep_warm
from app.services import scout_runs as scout_svc
from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text
from tests.test_apply_flow_fixes_038 import (
    GUESSED,
    PAGE,
    _continue,
    _fix,
    _live,
    _paused,
    _run,
)
from tests.test_apply_resume_review import _written
from tests.test_mcp_scout import _setup
from tests.test_mcp_server import _connected_user
from tests.test_scout_log import _events


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


# --------------------------------------------------------------------------- #
# A fix the page says wasn't made
# --------------------------------------------------------------------------- #


def test_still_old_reads_the_kth_box():
    fix = {"q": "Prefix", "k": 2, "now": "Mr.", "to": "Dr."}
    boxes = [{"q": "Prefix", "a": "Ms."}, {"q": "Prefix *", "a": "mr"}]
    assert sheet_svc.still_old(boxes, fix) is True
    assert sheet_svc.still_old([{"q": "Prefix", "a": "Dr."}] * 2, fix) is False
    assert sheet_svc.still_old(boxes[:1], fix) is False  # no second box: unknown
    assert sheet_svc.still_old(boxes, {**fix, "to": None, "ask": "why?"}) is False


async def _sent_fix(engine, monkeypatch):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    fix_id = await _fix(maker, user, run_id)
    await _continue(maker, user, run_id)
    return maker, user, run_id, rid, fix_id


@pytest.mark.asyncio
async def test_a_fix_the_page_never_showed_goes_back_to_claude_once(
    engine, monkeypatch
):
    maker, user, run_id, rid, fix_id = await _sent_fix(engine, monkeypatch)
    # Job Catcher's latest reading (from before the fix was sent): unchanged.
    out = await mcp_mod.mark_fixes(rid, done=[fix_id])
    assert [f["id"] for f in out["not_on_page"]] == [fix_id]
    assert out["not_on_page"][0]["now_on_page"] == "Mr."
    assert "make the change now" in out["next"]
    run = await _run(maker, run_id)
    (fix,) = run.fixes
    assert fix["status"] == "sent" and fix["doubted"] and "claude_done" not in fix
    assert run.events[-1]["kind"] == "fix_not_seen"
    # Said done again: Claude's word stands (never asked twice).
    again = await mcp_mod.mark_fixes(rid, done=[fix_id])
    assert "not_on_page" not in again
    (fix,) = (await _run(maker, run_id)).fixes
    assert fix["status"] == "sent" and fix["claude_done"]


@pytest.mark.asyncio
async def test_a_page_that_changed_is_never_doubted(engine, monkeypatch):
    maker, user, run_id, rid, fix_id = await _sent_fix(engine, monkeypatch)
    # Claude ticked something on the page after it got the fix: Job Catcher
    # may just not read this box, so Claude's word stands.
    changed = [*GUESSED[:2], {"q": "Prefix", "a": "Mr.", "claude": True}]
    changed[0] = {**changed[0], "a": "Samuel"}
    await _live(maker, user, run_id, changed, "My Information")
    out = await mcp_mod.mark_fixes(rid, done=[fix_id])
    assert "not_on_page" not in out
    (fix,) = (await _run(maker, run_id)).fixes
    assert fix["claude_done"] and not fix.get("doubted")


@pytest.mark.asyncio
async def test_a_fix_the_page_shows_is_done(engine, monkeypatch):
    maker, user, run_id, rid, fix_id = await _sent_fix(engine, monkeypatch)
    made = [*GUESSED[:2], {"q": "Prefix", "a": "Dr."}]
    await _live(maker, user, run_id, made, "My Information")
    out = await mcp_mod.mark_fixes(rid, done=[fix_id])
    assert "not_on_page" not in out
    (fix,) = (await _run(maker, run_id)).fixes
    assert fix["status"] == "done"


@pytest.mark.asyncio
async def test_the_owner_can_do_a_doubted_fix_themselves(engine, monkeypatch):
    maker, user, run_id, rid, fix_id = await _sent_fix(engine, monkeypatch)
    await mcp_mod.mark_fixes(rid, done=[fix_id])
    async with maker() as db:
        await svc.did_it_myself(db, user.id, run_id, fix_id)
        await db.commit()
    (fix,) = (await _run(maker, run_id)).fixes
    assert fix["status"] == "done" and fix["by_you"] is True


def test_the_playbook_says_what_not_on_page_and_cover_letter_mean():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION >= "2026.12.06"
    assert "if `mark_fixes` returns `not_on_page`" in text
    assert "`cover_letter: true`" in text


# --------------------------------------------------------------------------- #
# A cover letter too
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_use_it_with_a_cover_letter_tells_claude_to_write_one(
    engine, monkeypatch
):
    maker, user, run_id, rid, _saved = await _written(engine, monkeypatch)
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.resume_decide(db, run, "use", None, by="app", letter=True)
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["decision"] == "use" and got["cover_letter"] is True
    assert "save_cover_letter" in got["next"] and "never invent" in got["next"]
    run = await _run(maker, run_id)
    assert run.status == "filling"
    assert run.events[-1]["text"] == (
        "You said use the résumé, and asked for a cover letter too."
    )


@pytest.mark.asyncio
async def test_use_it_alone_never_asks_for_a_letter(engine, monkeypatch):
    maker, user, run_id, rid, _saved = await _written(engine, monkeypatch)
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        # A letter only goes with Use it, never with a change.
        await svc.resume_decide(db, run, "change", "Shorter", by="app", letter=True)
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert "cover_letter" not in got and "letter" not in (
        (await _run(maker, run_id)).resume_check
    )


@pytest.mark.asyncio
async def test_the_resume_decision_route_takes_cover_letter(engine, monkeypatch):
    maker, user, run_id, rid, _saved = await _written(engine, monkeypatch)
    from app.api.v1 import apply as apply_api
    from app.schemas.apply import ResumeDecisionIn

    async with maker() as db:
        await apply_api.resume_decision(
            run_id, ResumeDecisionIn(decision="use", cover_letter=True), user, db
        )
    assert (await _run(maker, run_id)).resume_check["letter"] is True


# --------------------------------------------------------------------------- #
# Scout
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_sign_in_wall_asks_the_user_and_the_log_says_so(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch, email="w1@test.dev")
    _user_id, _, run_id = await _setup(maker, "w1@test.dev", job_count=3)
    await mcp_mod.get_scout_brief()
    page = "https://www.indeed.com/jobs?q=help+desk&start=10"
    out = await mcp_mod.scout_needs_you(str(run_id), "sign_in", page)
    assert "wants you to sign in" in out["tell_user"]
    assert "never sign in for you" in out["tell_user"]
    assert "Never end the run for this without asking" in out["next"]
    assert out["page_url"] == page
    async with maker() as db:
        assert (await db.get(ScoutRun, run_id)).status == "running"
    events = await _events(maker, run_id)
    assert events[-1].tool == "scout_needs_you"
    assert events[-1].summary == (
        "indeed.com wants you to sign in: Claude asked you to, and waits"
    )


@pytest.mark.asyncio
async def test_a_running_search_says_what_claude_did_last(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch, email="w2@test.dev")
    _user_id, _, run_id = await _setup(maker, "w2@test.dev", job_count=3)
    await mcp_mod.get_scout_brief()
    async with maker() as db:
        (out,) = await scout_svc.runs_out(db, [await db.get(ScoutRun, run_id)])
    assert out.last_step is not None
    assert out.last_step.summary.startswith("Gave Claude the brief")
    await mcp_mod.finish_scout_run(str(run_id), "done")
    async with maker() as db:
        (out,) = await scout_svc.runs_out(db, [await db.get(ScoutRun, run_id)])
    assert out.last_step is None  # only while it runs


def test_the_scout_rules_never_end_a_run_at_a_wall():
    from pathlib import Path

    rules = (Path(scout_svc.__file__).parents[1] / "scout" / "rules.md").read_text(
        encoding="utf-8"
    )
    assert "scout_needs_you" in rules and "never sign in yourself" in rules
    assert scout_svc.PLAYBOOK_VERSION >= "2026.11.28"


# --------------------------------------------------------------------------- #
# Keep warm
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_keep_warm_only_on_render(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert keep_warm.public_url() is None
    assert await keep_warm.ping() is False
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "http://not-https.example")
    assert keep_warm.public_url() is None
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://api.example.com/")
    assert keep_warm.public_url() == "https://api.example.com"
    seen = []

    class Resp:
        status_code = 200

    class Client:
        def __init__(self, **_kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def get(self, url):
            seen.append(url)
            return Resp()

    monkeypatch.setattr(keep_warm.httpx, "AsyncClient", Client)
    assert await keep_warm.ping() is True
    assert seen == ["https://api.example.com/health"]
    assert PAGE  # the same invented Workday page as spec 038
