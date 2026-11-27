"""Apply with Claude flow fixes (spec 038).

- A: the owner's Continue always reaches Claude: a message from the owner,
  and every answer says go on until Claude moves to the next step, even when
  the first answer was lost (a server restart cut it).
- B: a fix Claude couldn't make never stops the run: wait_for_you says carry
  on from the step you're on; Claude can decline a fix with a reason, and the
  owner can say "I did it myself".
- C: the owner's own fix may tick an optional consent; Claude never does on
  its own.
- D: Page by page skips the pause on a step with nothing to look at.
- E/F/G: the playbook on server restarts, Workday sign-outs and Submit; a
  blocked Submit press says what to do next.
"""

import pytest

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRun
from app.services import apply_runs as svc
from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text
from tests.test_apply_best_judgment import _filling, _job_catcher

PAGE = "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123/apply"
INFO = [
    {"q": "First Name", "a": "Sam", "by": "job_catcher"},
    {"q": "Last Name", "a": "Rivera", "by": "job_catcher"},
]
GUESSED = [*INFO, {"q": "Prefix", "a": "Mr.", "claude": True, "guess": True}]
OPEN_LINE = "Open the application"


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


async def _run(maker, run_id) -> ApplyRun:
    async with maker() as db:
        return await db.get(ApplyRun, run_id)


async def _page_mode(engine, monkeypatch):
    out = await _filling(engine, monkeypatch)
    maker, user, run_id = out[0], out[1], out[2]
    async with maker() as db:
        await svc.set_mode(db, user.id, run_id, "page")
        await db.commit()
    return out


async def _live(maker, user, run_id, boxes, step):
    async with maker() as db:
        await svc.save_live(
            db, user.id, run_id, {"url": PAGE, "boxes": boxes, "step": step}
        )
        await db.commit()


async def _paused(engine, monkeypatch):
    """Page by page, the first step done with a guess on it: paused."""
    maker, user, run_id, _job, rid, _saved = await _page_mode(engine, monkeypatch)
    await _live(maker, user, run_id, GUESSED, "My Information")
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": GUESSED})
    out = await mcp_mod.page_done(rid, PAGE, "My Information", GUESSED)
    assert "wait_for_you" in out["next"]
    assert (await _run(maker, run_id)).paused_step == "my information"
    return maker, user, run_id, rid


async def _continue(maker, user, run_id):
    async with maker() as db:
        await svc.continue_step(db, user.id, run_id)
        await db.commit()


async def _fix(maker, user, run_id, q="Prefix", to="Dr.", step="my information"):
    async with maker() as db:
        run = await svc.add_fix(db, user.id, run_id, {"step": step, "q": q, "to": to})
        await db.commit()
        return run.fixes[-1]["id"]


# --------------------------------------------------------------------------- #
# A. Continue always reaches Claude
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_continue_reaches_claude_even_when_the_first_answer_is_lost(
    engine, monkeypatch
):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    await _continue(maker, user, run_id)
    # The owner's go-on is a message too: any tool result carries it.
    run = await _run(maker, run_id)
    (msg,) = [m for m in run.messages if m["by"] == "you"]
    assert "go on" in msg["text"] and "Press Next" in msg["text"]
    assert "My Information" not in msg["text"]  # the page's text stays apart
    # The first answer is lost on the way (a deploy restart cut it): the
    # flag and the message are taken, but Claude never saw them.
    lost = await mcp_mod.wait_for_you(rid)
    assert lost["ready"] is True and lost["go_on"] is True
    assert lost["waiting_on"] is None
    assert lost["from_user"][0]["step_on_page"] == "My Information"
    assert "call wait_for_you again" not in lost["user_message_note"]
    run = await _run(maker, run_id)
    assert run.sheet["check"]["read"] is True and run.sheet["check"]["read_at"]
    # Every later answer still says go on, until Claude moves on.
    again = await mcp_mod.wait_for_you(rid)
    assert again["ready"] is True and again["go_on"] is True
    assert again["waiting_on"] is None
    assert "said go on" in again["next"] and "press Next" in again["next"]
    assert OPEN_LINE not in again["next"]
    brief = await mcp_mod.get_apply_brief(rid)
    assert "said go on" in brief["next"] and "press Next" in brief["next"]
    # fill_page on the next step is moving on: not refused, and after it the
    # go-on is done.
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "filled": [], "need": []})
    filled = await mcp_mod.fill_page(rid, PAGE)
    assert filled.get("ok") is not False
    assert (await _run(maker, run_id)).sheet["check"]["moved_on"] is True
    after = await mcp_mod.wait_for_you(rid)
    assert "said go on" not in after["next"] and "go_on" not in after


@pytest.mark.asyncio
async def test_the_go_on_message_reaches_claude_on_any_tool(engine, monkeypatch):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    await _continue(maker, user, run_id)
    assert (await _run(maker, run_id)).sheet["check"]["read"] is False
    out = await mcp_mod.message_user(rid, "Got it, moving on.")
    (told,) = out["from_user"]
    assert "go on" in told["text"]
    # Handing it over is Claude getting it: the app shows "Claude got it".
    run = await _run(maker, run_id)
    assert run.sheet["check"]["read"] is True
    view = await _view(maker, run_id)
    assert view["sheet"]["check"]["read"] is True


@pytest.mark.asyncio
async def test_continue_with_fixes_is_one_message(engine, monkeypatch):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    await _fix(maker, user, run_id)
    await _continue(maker, user, run_id)
    got = await mcp_mod.wait_for_you(rid)
    (told,) = got["from_user"]
    assert told["fixes"][0]["to"] == "Dr." and "mark_fixes" in told["text"]
    assert got["ready"] is True and got["waiting_on"] is None
    assert "mark_fixes" in got["next"] and "press Next" in got["next"]
    assert "call wait_for_you again" not in got["user_message_note"]


@pytest.mark.asyncio
async def test_a_ready_answer_never_says_step_check(engine, monkeypatch):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    waiting = await mcp_mod.wait_for_you(rid)
    assert waiting["ready"] is False and waiting["waiting_on"] == "step_check"
    # Switching to Keep going while paused: go on, never "step_check".
    async with maker() as db:
        await svc.set_mode(db, user.id, run_id, "keep")
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["ready"] is True and got["waiting_on"] is None
    assert got["go_on"] is True and "Keep going" in got["next"]


async def _view(maker, run_id):
    async with maker() as db:
        return await svc.view(db, await db.get(ApplyRun, run_id))


# --------------------------------------------------------------------------- #
# B. A fix Claude couldn't make never stops the run
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_after_a_gone_fix_wait_for_you_says_carry_on(engine, monkeypatch):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    fix_id = await _fix(maker, user, run_id)
    await _continue(maker, user, run_id)
    await mcp_mod.wait_for_you(rid)
    marked = await mcp_mod.mark_fixes(rid, gone=[fix_id])
    assert marked["marked"] == 1 and "don't call wait_for_you" in marked["next"]
    # Claude moved on to the next step and filled it.
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "filled": [], "need": []})
    await mcp_mod.fill_page(rid, PAGE)
    out = await mcp_mod.wait_for_you(rid)
    assert out["ready"] is True and out["waiting_on"] is None
    assert "Nothing is waiting on the user" in out["next"]
    assert "Carry on from the step you're on" in out["next"]
    assert OPEN_LINE not in out["next"]
    brief = await mcp_mod.get_apply_brief(rid)
    assert OPEN_LINE not in brief["next"]


@pytest.mark.asyncio
async def test_claude_can_decline_a_fix_with_a_reason(engine, monkeypatch):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    fix_id = await _fix(maker, user, run_id)
    await _continue(maker, user, run_id)
    await mcp_mod.wait_for_you(rid)
    out = await mcp_mod.mark_fixes(
        rid, declined=[{"id": fix_id, "why": "The form only offers Mr. or Ms."}]
    )
    assert out["marked"] == 1
    (fix,) = (await _run(maker, run_id)).fixes
    assert fix["status"] == "declined"
    assert fix["why"] == "The form only offers Mr. or Ms."
    # A plain id works too, with no reason.
    fix2 = await _fix(maker, user, run_id, q="First Name", to="Samuel")
    async with maker() as db:
        await svc.send_fixes(db, user.id, run_id)
        await db.commit()
    await mcp_mod.mark_fixes(rid, declined=[fix2])
    assert (await _run(maker, run_id)).fixes[-1]["status"] == "declined"


@pytest.mark.asyncio
async def test_i_did_it_myself_marks_it_done_and_tells_claude(
    engine, monkeypatch, client
):
    maker, user, run_id, rid = await _paused(engine, monkeypatch)
    fix_id = await _fix(maker, user, run_id)
    await _continue(maker, user, run_id)
    await mcp_mod.wait_for_you(rid)
    # Not for a fix Claude still has.
    async with maker() as db:
        with pytest.raises(ValueError, match="couldn't make"):
            await svc.did_it_myself(db, user.id, run_id, fix_id)
    await mcp_mod.mark_fixes(rid, gone=[fix_id])
    async with maker() as db:
        await svc.did_it_myself(db, user.id, run_id, fix_id)
        await db.commit()
    (fix,) = (await _run(maker, run_id)).fixes
    assert fix["status"] == "done" and fix["by_you"] is True
    out = await mcp_mod.wait_for_you(rid)
    (told,) = out["from_user"]
    assert told["text"] == "I did it myself; carry on."
    assert told["fix"]["box_on_page"] == "Prefix"
    async with maker() as db:
        with pytest.raises(LookupError):
            await svc.did_it_myself(db, user.id, run_id, "nope")


@pytest.mark.asyncio
async def test_the_i_did_it_myself_route(client, db_session, test_user):
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/northwind/7",
            "title": "IT Engineer",
            "company": "Northwind Labs",
            "description": "Intune and Okta. " * 50,
        },
    )
    started = await client.post(
        "/v1/apply/runs", json={"saved_job_id": r.json()["id"], "mode": "keep"}
    )
    run_id = started.json()["id"]
    base = f"/v1/apply/runs/{run_id}"
    live = {
        "url": "https://jobs.lever.co/northwind/7/apply",
        "step": "Your details",
        "boxes": [{"q": "Texts about this job", "a": "No"}],
    }
    test_user.review_resumes = False
    from tests.test_mcp_apply import RESUME

    await svc.brief(db_session, test_user, run_id)
    await svc.save_resume(db_session, test_user, run_id, RESUME)
    await db_session.commit()
    assert (await client.post(f"{base}/live", json=live)).status_code == 204
    fix = {"step": "your details", "q": "Texts about this job", "to": "Yes"}
    fix_id = (await client.post(f"{base}/fixes", json=fix)).json()["fixes"][0]["id"]
    # Still waiting: not one Claude couldn't make.
    r = await client.post(f"{base}/fixes/{fix_id}/did-it")
    assert r.status_code == 400
    assert (await client.post(f"{base}/fixes/send")).status_code == 200
    await svc.mark_fixes(
        db_session, test_user, run_id, None, None, [{"id": fix_id, "why": "x"}]
    )
    await db_session.commit()
    r = await client.post(f"{base}/fixes/{fix_id}/did-it")
    assert r.status_code == 200, r.text
    assert r.json()["fixes"][0]["status"] == "done"
    assert (await client.post(f"{base}/fixes/nope/did-it")).status_code == 404


# --------------------------------------------------------------------------- #
# C. Optional consent: only on the owner's own fix
# --------------------------------------------------------------------------- #

NEVER_ON_YOUR_OWN = "Never tick an optional consent (texts, marketing) on your own."
OWNERS_DECISION = (
    "A fix the user sent from the app is their own decision: make it exactly, "
    "including ticking an optional consent."
)


def test_the_consent_rule_lets_the_owner_s_fix_tick_it():
    text = playbook_text()
    assert NEVER_ON_YOUR_OWN in text and OWNERS_DECISION in text
    assert "Never tick optional consent (marketing, texts)." not in text
    from app.services.apply_playbook import RULES

    assert NEVER_ON_YOUR_OWN in RULES and OWNERS_DECISION in RULES
    assert "optional consent" in svc.FIX_NOTE and "own decision" in svc.FIX_NOTE
    assert "costs money" in svc.FIX_NOTE and "password" in svc.FIX_NOTE


@pytest.mark.asyncio
async def test_review_fixes_say_the_owner_s_fix_is_their_decision(engine, monkeypatch):
    maker, user, run_id, _job, rid, _saved = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    rows = [{"q": "Texts about this job", "a": "No"}]
    await _live(maker, user, run_id, rows, "Review")
    await mcp_mod.ready_for_review(rid, PAGE, "Review", rows)
    async with maker() as db:
        await svc.add_fix(
            db,
            user.id,
            run_id,
            {"step": "review", "q": "Texts about this job", "to": "Yes"},
        )
        await svc.send_fixes(db, user.id, run_id)
        await db.commit()
    out = await mcp_mod.wait_for_you(rid)
    assert out["decision"] == "fix" and "optional consent" in out["next"]


# --------------------------------------------------------------------------- #
# D. Page by page: no stop on a step with nothing to look at
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_clean_step_doesn_t_pause(engine, monkeypatch):
    maker, user, run_id, _job, rid, _saved = await _page_mode(engine, monkeypatch)
    rows = [*INFO, {"q": "Middle Name", "a": ""}]  # an optional empty box
    await _live(maker, user, run_id, rows, "My Information")
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": rows})
    out = await mcp_mod.page_done(rid, PAGE, "My Information", rows)
    assert "press Next" in out["next"] and "wait_for_you" not in out["next"]
    run = await _run(maker, run_id)
    assert run.paused_step is None
    assert run.events[-1]["text"] == "My Information looked fine: no stop."


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "row",
    [
        {"q": "Prefix", "a": "Mr.", "guess": True},
        # An answer Claude wrote itself: the main thing the owner looks at.
        {
            "q": "Why do you want to work at Northwind Labs?",
            "a": "I've run Intune for a 400-seat office and want to grow it here.",
            "claude": True,
        },
        {"q": "Years with Intune", "a": "", "only_you": True},
        {"q": "I certify this is true", "a": "Yes", "agreement": True},
        {"q": "Phone Number*", "a": ""},
        {"q": "Phone Number (required)", "a": ""},
    ],
)
async def test_a_step_with_something_to_look_at_still_pauses(engine, monkeypatch, row):
    maker, user, run_id, _job, rid, _saved = await _page_mode(engine, monkeypatch)
    rows = [*INFO, row]
    await _live(maker, user, run_id, INFO, "My Information")
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": rows})
    out = await mcp_mod.page_done(rid, PAGE, "My Information", rows)
    assert "wait_for_you" in out["next"]
    assert (await _run(maker, run_id)).paused_step == "my information"


@pytest.mark.asyncio
async def test_a_step_with_waiting_fixes_still_pauses(engine, monkeypatch):
    maker, user, run_id, _job, rid, _saved = await _page_mode(engine, monkeypatch)
    await _live(maker, user, run_id, INFO, "My Information")
    # The owner fixed a box while Claude was still filling the step.
    await _fix(maker, user, run_id, q="First Name", to="Samuel")
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": INFO})
    out = await mcp_mod.page_done(rid, PAGE, "My Information", INFO)
    assert "wait_for_you" in out["next"]
    assert (await _run(maker, run_id)).paused_step == "my information"


# --------------------------------------------------------------------------- #
# E/F/G. Restarts, Workday sign-outs, Submit
# --------------------------------------------------------------------------- #


def test_the_playbook_on_restarts_sign_outs_and_submit():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION == "2026.12.04"
    # E: a failed call is the server restarting.
    assert "502/503/504" in text and "wait about 30 s" in text
    assert "Never move on or press Submit because a call failed" in text
    # F: Workday signs you out.
    assert "Workday signs you out after a long idle" in text
    assert 'need_help(kind="sign_in")' in text and "attach any files again" in text
    # G: never Submit before the decision; Submit that didn't go through.
    assert "Never press Submit before `ready_for_review` and the user's" in text
    assert "say so in `need_help`" in text
    assert "Read the error on the page, fix it, then press Submit once" in text


@pytest.mark.asyncio
async def test_a_blocked_submit_press_says_what_to_do_next(engine, monkeypatch):
    maker, user, run_id, _job, rid, _saved = await _filling(engine, monkeypatch)
    async with maker() as db:
        await svc.extension_event(
            db,
            user.id,
            run_id,
            "blocked_submit",
            "https://acme.wd1.myworkdayjobs.com/x",
        )
        await db.commit()
    out = await mcp_mod.message_user(rid, "Filling My Information.")
    assert out["submit_blocked"] is True
    assert out["next"].startswith("Job Catcher stopped your Submit press")
    assert "ready_for_review" in out["next"]
    assert "myworkdayjobs" not in out["next"]  # the page's address stays apart
    # Told once.
    again = await mcp_mod.message_user(rid, "Still filling.")
    assert "submit_blocked" not in again
    # At the review it says wait_for_you.
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.ready_for_review(rid, PAGE, "Review", [])
    async with maker() as db:
        await svc.extension_event(db, user.id, run_id, "blocked_submit", PAGE)
        await db.commit()
    waited = await mcp_mod.wait_for_you(rid)
    assert waited["submit_blocked"] is True and "wait_for_you" in waited["next"]
    assert waited["next"].startswith("Job Catcher stopped your Submit press")
