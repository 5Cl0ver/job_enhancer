"""Fixes from Bugs & ideas (spec 036), the server's half.

- A: the browser's Back left the form. Claude is told to move between steps
  only with the form's own buttons, and a tab back on the job listing after
  the application moved on is refused with what to do.
- E: get_apply_brief without a run_id never carries on with another job's
  open application; the start line's run code names the run; the app's busy
  answer says which job is going.
"""

import uuid

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRun
from app.models.user import User
from app.services import apply_runs as svc
from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text
from app.services.users import create_user
from tests.test_mcp_apply import _job_catcher, _run, _setup
from tests.test_mcp_server import _connected_user

BACK = "never the browser's Back"
SMART = "https://smartapply.indeed.com/beta/indeedapply/form/questions/1"
VIEWJOB = "https://www.indeed.com/viewjob?jk=abc123def456"


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


# --------------------------------------------------------------------------- #
# A. Only the form's own buttons
# --------------------------------------------------------------------------- #


def test_the_playbook_and_rules_say_never_the_browser_s_back():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION >= "2026.12.03"
    assert "**Moving between steps: only the form's own buttons.**" in text
    assert "Never use the browser's Back or Forward inside an application" in text
    assert 'what="Left the form with browser Back"' in text
    # Every "go back to a step" says how.
    assert text.count(BACK) >= 2
    assert BACK in svc.FIX_NOTE


@pytest.mark.asyncio
async def test_a_review_fix_says_how_to_go_back(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "fix", "Use my other email.", by="app")
        await db.commit()
    out = await mcp_mod.wait_for_you(rid)
    assert out["decision"] == "fix" and BACK in out["next"]


@pytest.mark.asyncio
async def test_review_fixes_say_how_to_go_back(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(
            db,
            run,
            "fix",
            None,
            by="app",
            fixes=[{"page": 1, "q": "First name", "a": "Sam", "to": "Samuel"}],
        )
        await db.commit()
    out = await mcp_mod.wait_for_you(rid)
    assert out["fixes"] and BACK in out["next"]


async def _on_smartapply(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.page_done(rid, SMART, "Contact information", [])
    return maker, user, run_id, rid


@pytest.mark.asyncio
async def test_back_on_the_listing_after_a_done_page_is_refused(engine, monkeypatch):
    maker, user, run_id, rid = await _on_smartapply(engine, monkeypatch)
    before = await _run(maker, run_id)
    out = await mcp_mod.page_done(rid, VIEWJOB, "Job listing", [])
    assert out["ok"] is False and out["not_now"] == "Your tab left the application."
    assert "Forward once" in out["next"] and "form's own Back" in out["next"]
    fill = await mcp_mod.fill_page(rid, VIEWJOB)
    assert fill["ok"] is False and "Forward once" in fill["next"]
    run = await _run(maker, run_id)
    # Nothing joined the run: no page, no listing host.
    assert len(run.pages) == len(before.pages) == 1
    assert "indeed.com" not in run.apply_hosts


@pytest.mark.asyncio
async def test_the_listing_before_any_page_and_easy_apply_are_fine(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert not svc._left_the_form(run, VIEWJOB)  # no page done yet
        run.pages = [{"n": 1, "url": "https://www.linkedin.com/jobs/view/77/apply"}]
        # LinkedIn's own Easy Apply stays on linkedin.com.
        assert not svc._left_the_form(run, "https://www.linkedin.com/jobs/view/77")
        run.pages = [{"n": 1, "url": SMART}]
        assert svc._left_the_form(run, VIEWJOB)
        assert svc._left_the_form(
            run, "https://www.indeed.com/jobs?q=it&vjk=abc123def456"
        )
        assert not svc._left_the_form(run, SMART)


# --------------------------------------------------------------------------- #
# E. The right run
# --------------------------------------------------------------------------- #


def test_board_jobs_are_read_from_the_address():
    assert svc._board_job("https://www.linkedin.com/jobs/view/123") == "linkedin:123"
    assert (
        svc._board_job("https://www.linkedin.com/jobs/view/it-engineer-at-acme-456/")
        == "linkedin:456"
    )
    assert (
        svc._board_job("https://www.linkedin.com/jobs/search/?currentJobId=789")
        == "linkedin:789"
    )
    assert svc._board_job(VIEWJOB) == "indeed:abc123def456"
    assert svc._board_job("https://www.indeed.com/jobs?vjk=ABC123DEF456") == (
        "indeed:abc123def456"
    )
    assert svc._board_job("https://www.linkedin.com/feed/") is None
    assert svc._board_job("https://acme.wd1.myworkdayjobs.com/job/1") is None


async def _two_jobs(engine, monkeypatch):
    """Run A open for a LinkedIn job; job B saved too."""
    maker = await _connected_user(engine, monkeypatch)
    a = await mcp_mod.save_job(
        title="Help Desk Analyst",
        company="Acme",
        apply_url="https://www.linkedin.com/jobs/view/1001",
        description="Help desk work. " * 50,
    )
    b = await mcp_mod.save_job(
        title="Systems Administrator",
        company="Globex",
        apply_url="https://www.indeed.com/viewjob?jk=feedbeef1234",
        description="Servers. " * 50,
    )
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == "claude@test.dev"))
        run = await svc.create_run(db, user, uuid.UUID(a["job_id"]))
        await db.commit()
    return maker, user, run.id, a, b


@pytest.mark.asyncio
async def test_a_tab_on_another_job_never_continues_the_open_run(engine, monkeypatch):
    maker, user, run_id, a, b = await _two_jobs(engine, monkeypatch)
    before = await _run(maker, run_id)
    # Another LinkedIn posting than the run's.
    out = await mcp_mod.get_apply_brief(
        page_url="https://www.linkedin.com/jobs/view/2002"
    )
    assert out["ok"] is False and out["not_now"] == "other_job"
    assert out["open_run"] == {
        "run_id": str(run_id),
        "run_code": str(run_id)[:8],
        "title": "Help Desk Analyst",
        "company": "Acme",
        "step": "waiting",
    }
    # The job's words stay in their field, never in the instruction.
    assert "Help Desk Analyst" not in out["next"] and "Acme" not in out["next"]
    assert f'get_apply_brief(run_id="{run_id}")' in out["next"]
    assert "playbook" not in out
    # Another of the user's saved jobs, on another board.
    out = await mcp_mod.get_apply_brief(
        page_url="https://www.indeed.com/viewjob?jk=feedbeef1234"
    )
    assert out["not_now"] == "other_job"
    after = await _run(maker, run_id)
    assert after.status == before.status == "waiting"
    assert after.events == before.events
    assert after.started_at is None and after.claude_at is None


@pytest.mark.asyncio
async def test_the_run_s_own_job_or_an_unknown_page_carries_on(engine, monkeypatch):
    maker, user, run_id, a, b = await _two_jobs(engine, monkeypatch)
    out = await mcp_mod.get_apply_brief(
        page_url="https://www.linkedin.com/jobs/search/?currentJobId=1001"
    )
    assert out["run_id"] == str(run_id) and out["step"] == "reading"
    assert out["run_code"] == str(run_id)[:8]
    # A page that names no job (the app, a search) changes nothing.
    out = await mcp_mod.get_apply_brief(page_url="https://www.google.com/")
    assert out["run_id"] == str(run_id)


@pytest.mark.asyncio
async def test_mid_application_another_hiring_site_is_another_job(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.page_done(
        rid, "https://acme.wd1.myworkdayjobs.com/apply/1", "My Information", []
    )
    out = await mcp_mod.get_apply_brief(
        page_url="https://boards.greenhouse.io/initech/jobs/55"
    )
    assert out["not_now"] == "other_job"
    out = await mcp_mod.get_apply_brief(
        page_url="https://acme.wd1.myworkdayjobs.com/apply/2"
    )
    assert out["run_id"] == rid


@pytest.mark.asyncio
async def test_the_run_code_names_the_user_s_own_run_only(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    code = str(run_id)[:8]
    out = await mcp_mod.get_apply_brief(code)
    assert out["run_id"] == str(run_id)
    # As the start line says it, any case.
    out = await mcp_mod.get_apply_brief(f"run {code.upper()}")
    assert out["run_id"] == str(run_id)
    # Every tool takes it.
    told = await mcp_mod.message_user(code, "Starting now.")
    assert told["run_id"] == str(run_id)
    # Someone else's run, by its code: not found.
    async with maker() as db:
        other = await create_user(db, email="other@test.dev", name="Other")
        theirs = ApplyRun(
            user_id=other.id,
            saved_job_id=(await db.get(ApplyRun, run_id)).saved_job_id,
            status="waiting",
            playbook_version=APPLY_PLAYBOOK_VERSION,
        )
        db.add(theirs)
        await db.commit()
    with pytest.raises(ValueError, match="No application with that run_id"):
        await mcp_mod.get_apply_brief(str(theirs.id)[:8])
    with pytest.raises(ValueError, match="isn't a valid id"):
        await mcp_mod.get_apply_brief("zzzzzzzz")


@pytest.mark.asyncio
async def test_busy_says_which_job_is_going(client):
    jobs = []
    for title, company, url in (
        ("Help Desk Analyst", "Acme", "https://jobs.lever.co/acme/1"),
        ("Network Technician", "Globex", "https://jobs.lever.co/globex/2"),
    ):
        r = await client.post(
            "/v1/saved-jobs/manual",
            json={"url": url, "title": title, "company": company},
        )
        assert r.status_code in (200, 201), r.text
        jobs.append(r.json()["id"])
    first = await client.post("/v1/apply/runs", json={"saved_job_id": jobs[0]})
    assert first.status_code == 201
    busy = await client.post("/v1/apply/runs", json={"saved_job_id": jobs[1]})
    assert busy.status_code == 409
    body = busy.json()
    assert body["open_run_id"] == first.json()["id"]
    assert body["open_title"] == "Help Desk Analyst"
    assert body["open_company"] == "Acme"
    # Stop it and start this one.
    stopped = await client.post(f"/v1/apply/runs/{body['open_run_id']}/stop")
    assert stopped.json()["status"] == "stopped"
    again = await client.post("/v1/apply/runs", json={"saved_job_id": jobs[1]})
    assert again.status_code == 201
    assert again.json()["job"]["company"] == "Globex"
