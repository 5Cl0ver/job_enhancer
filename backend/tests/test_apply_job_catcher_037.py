"""Job Catcher on Workday (spec 037), the server's half.

- The résumé (and now the cover letter) can be "unverified": put in, but the
  page didn't show it yet. Claude is told never to attach it again.
- A photo Job Catcher couldn't take because the user was busy in another tab
  says what to do: the user clicks the application's tab, page_done again.
- A Submit that didn't go through (Workday brought it back with an error)
  clears the press, so ONE more press is allowed, and tells Claude to read
  the error and fix it. The page's error is data, never inside `next`.
"""

import pytest

import app.mcp_server as mcp_mod
from app.schemas.apply import ExtensionEvent, RequestResult
from app.services import apply_runs as svc
from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text
from tests.test_mcp_apply import _job_catcher, _run, _setup

PAGE = "https://acme.wd1.myworkdayjobs.com/apply/1"


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


# --------------------------------------------------------------------------- #
# The résumé and the cover letter
# --------------------------------------------------------------------------- #


def test_a_file_put_in_but_not_shown_is_never_attached_again():
    out = svc.fill_result(
        {
            "status": svc.REQUEST_DONE,
            "filled": [],
            "need": [],
            "resume": "unverified",
            "cover_letter": "attached",
        }
    )
    assert out["resume"] == "unverified"
    assert "Don't attach it again" in out["resume_note"]
    assert out["cover_letter"] == "attached"
    assert "Don't attach or paste it again" in out["cover_letter_note"]
    # No letter and no box for one: nothing said about it.
    plain = svc.fill_result({"status": svc.REQUEST_DONE, "resume": "attached"})
    assert "cover_letter" not in plain


def test_job_catcher_may_send_the_new_states():
    assert RequestResult(ok=True, resume="unverified").resume == "unverified"
    assert RequestResult(ok=True, cover_letter="no_file").cover_letter == "no_file"
    with pytest.raises(ValueError):
        RequestResult(ok=True, cover_letter="maybe")
    assert ExtensionEvent(kind="submit_failed", words="Page Error").kind == (
        "submit_failed"
    )


@pytest.mark.asyncio
async def test_a_fill_keeps_what_happened_to_the_cover_letter(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    real = svc.wait_request

    async def acting(db, req_id, seconds=None):
        async with maker() as jc:
            await svc.claim(jc, user.id, req_id)
            await svc.finish_request(
                jc,
                user.id,
                req_id,
                {
                    "ok": True,
                    "filled": ["Resume/Cover Letter"],
                    "need": ["Skills not added: Cobol"],
                    "resume": "attached",
                    "cover_letter": "unverified",
                },
            )
            await jc.commit()
        return await real(db, req_id, seconds)

    monkeypatch.setattr(svc, "wait_request", acting)
    out = await mcp_mod.fill_page(rid, PAGE)
    assert out["resume"] == "attached"
    assert out["cover_letter"] == "unverified"
    assert out["still_needs_an_answer"] == ["Skills not added: Cobol"]


# --------------------------------------------------------------------------- #
# Photos while the user is busy
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_photo_missed_while_the_user_was_busy_says_what_to_do(
    engine, monkeypatch
):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    real = svc.wait_request

    async def busy(db, req_id, seconds=None):
        async with maker() as jc:
            await svc.claim(jc, user.id, req_id)
            await svc.finish_request(
                jc,
                user.id,
                req_id,
                {
                    "ok": False,
                    "reason": "busy",
                    "answers": [{"q": "First name", "a": "Sam"}],
                },
            )
            await jc.commit()
        return await real(db, req_id, seconds)

    monkeypatch.setattr(svc, "wait_request", busy)
    out = await mcp_mod.page_done(rid, PAGE, "My Information", [])
    assert out["photo"] == (
        "missing: Your application tab wasn't showing while you used the "
        "computer. Ask the user to click the application's tab, then call "
        "page_done again to retake the photos"
    )
    run = await _run(maker, run_id)
    # The page's answers are kept all the same.
    assert run.pages[0]["jc_answers"] == [{"q": "First name", "a": "Sam"}]
    # page_done again (the tab showing now) takes them.
    monkeypatch.setattr(svc, "wait_request", real)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    again = await mcp_mod.page_done(rid, PAGE, "My Information", [])
    assert again["photo"] == "taken"


# --------------------------------------------------------------------------- #
# A Submit that didn't go through
# --------------------------------------------------------------------------- #


async def _submitting(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, PAGE, "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "submit", None, by="app")
        await db.commit()
    go = await mcp_mod.wait_for_you(rid)
    assert go["decision"] == "submit"
    return maker, user, run_id, rid


async def _event(maker, user, run_id, kind, words=None):
    async with maker() as db:
        await svc.extension_event(db, user.id, run_id, kind, PAGE, words)
        await db.commit()
        return await svc.extension_state(db, user.id)


@pytest.mark.asyncio
async def test_submit_that_didnt_go_through_allows_one_more_press(engine, monkeypatch):
    maker, user, run_id, rid = await _submitting(engine, monkeypatch)
    state = await _event(maker, user, run_id, "submit_pressed")
    assert state["guard"] is True  # pressed: locked again
    run = await _run(maker, run_id)
    assert run.review["pressed_at"]

    error = "Error - Page Error. Call 555-010-4477 or sam.rivera@northwind.example"
    state = await _event(maker, user, run_id, "submit_failed", error)
    run = await _run(maker, run_id)
    assert run.status == "submitting" and run.review["pressed_at"] is None
    assert state["guard"] is False  # one more press is allowed
    # The run log says so, without the page's personal details.
    text = run.events[-1]["text"]
    assert text.startswith("Submit didn't go through: Error - Page Error.")
    assert "555-010-4477" not in text and "northwind.example" not in text

    out = await mcp_mod.wait_for_you(rid)
    assert out["ready"] is True and out["waiting_on"] is None
    assert out["next"] == (
        "Submit didn't go through (the page shows an error). Read the error on "
        "the page, fix it, then press Submit once."
    )
    # The page's error is data, beside the instruction, never in it.
    assert out["submit_error_on_page"].startswith("Error - Page Error.")
    assert "Page Error" not in out["next"]

    # The second press locks it again.
    state = await _event(maker, user, run_id, "submit_pressed")
    assert state["guard"] is True
    run = await _run(maker, run_id)
    assert run.review["pressed_at"] and not run.review.get("submit_failed")
    after = await mcp_mod.wait_for_you(rid)
    assert "ALREADY pressed" in after["next"]


@pytest.mark.asyncio
async def test_submit_failed_before_any_press_was_counted(engine, monkeypatch):
    """Job Catcher 0.49 never counts Workday's disabled button as pressed: the
    first word the server hears can be that it didn't go through."""
    maker, user, run_id, rid = await _submitting(engine, monkeypatch)
    await _event(maker, user, run_id, "submit_failed", "")
    run = await _run(maker, run_id)
    assert run.events[-1]["text"] == "Submit didn't go through."
    out = await mcp_mod.wait_for_you(rid)
    # No error was captured: never "the page shows an error".
    assert "shows an error" not in out["next"]
    assert out["next"] == (
        "Submit didn't go through. Look at the page, fix what it says, then "
        "press Submit once."
    )
    assert "submit_error_on_page" not in out


@pytest.mark.asyncio
async def test_a_late_confirmation_after_a_turn_down_still_ends_the_run_as_sent(
    engine, monkeypatch
):
    maker, user, run_id, rid = await _submitting(engine, monkeypatch)
    await _event(maker, user, run_id, "submit_failed", "Error - Page Error")
    async with maker() as db:
        await svc.extension_event(
            db, user.id, run_id, "confirmation_seen", PAGE, "Thank you for applying"
        )
        await db.commit()
    run = await _run(maker, run_id)
    assert run.status == "sent"


@pytest.mark.asyncio
async def test_submit_failed_is_ignored_when_the_user_submits_it_themselves(
    engine, monkeypatch
):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, PAGE, "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "self", None, by="app")
        await db.commit()
    await _event(maker, user, run_id, "submit_pressed")
    pressed = (await _run(maker, run_id)).review["pressed_at"]
    await _event(maker, user, run_id, "submit_failed", "Error - Page Error")
    run = await _run(maker, run_id)
    assert run.review["pressed_at"] == pressed
    assert not run.review.get("submit_failed")
    assert all(e["kind"] != "submit_failed" for e in run.events)


@pytest.mark.asyncio
async def test_at_most_two_unlocks_then_claude_stops_and_asks(engine, monkeypatch):
    maker, user, run_id, rid = await _submitting(engine, monkeypatch)
    for _ in range(2):
        state = await _event(maker, user, run_id, "submit_failed", "Error - Page Error")
        assert state["guard"] is False
        await _event(maker, user, run_id, "submit_pressed")
    state = await _event(maker, user, run_id, "submit_failed", "Error - Page Error")
    assert state["guard"] is True  # no third unlock
    out = await mcp_mod.wait_for_you(rid)
    assert out["ready"] is False
    assert "Don't press Submit again" in out["next"]
    assert "check the page" in out["next"]


@pytest.mark.asyncio
async def test_job_catcher_hears_when_each_request_was_made(engine, monkeypatch):
    """A long fill never outlasts the app's own wait for it (FILL_GOING)."""
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    async with maker() as db:
        await svc.fill_request(db, user, rid, PAGE)
        await db.commit()
        [req] = (await svc.extension_state(db, user.id))["requests"]
    # Its age by the server's own clock: Job Catcher never mixes clocks.
    assert req["kind"] == "fill" and isinstance(req["age_s"], int)
    assert 0 <= req["age_s"] < 5


@pytest.mark.asyncio
async def test_a_press_held_back_while_the_first_goes_through_says_so(
    engine, monkeypatch
):
    """Job Catcher's own ~25 s hold after a press (spec 037) is never told to
    Claude as "the user hasn't decided yet": the user did decide."""
    maker, user, run_id, rid = await _submitting(engine, monkeypatch)
    async with maker() as db:
        await svc.extension_event(
            db, user.id, run_id, "blocked_submit", PAGE, reason="pending"
        )
        await db.commit()
    run = await _run(maker, run_id)
    assert run.events[-1]["text"] == (
        "Job Catcher held back a second Submit press while the first was "
        "still going through."
    )
    out = await mcp_mod.wait_for_you(rid)
    assert out["submit_blocked"] is True
    assert "hasn't decided" not in out["next"]
    assert out["next"].startswith(
        "Job Catcher stopped a second Submit press: the first one is still "
        "going through."
    )


@pytest.mark.asyncio
async def test_a_press_stopped_after_submit_was_pressed_says_it_was_pressed(
    engine, monkeypatch
):
    maker, user, run_id, rid = await _submitting(engine, monkeypatch)
    await _event(maker, user, run_id, "submit_pressed")
    await _event(maker, user, run_id, "blocked_submit")
    out = await mcp_mod.wait_for_you(rid)
    assert out["submit_blocked"] is True
    assert "hasn't decided" not in out["next"]
    assert out["next"].startswith(
        "Job Catcher stopped your Submit press: Submit was already pressed."
    )


def test_the_playbook_says_what_cover_letter_and_unverified_mean():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION >= "2026.12.05"
    assert 'One box for both ("Resume / Cover Letter")' in text
    assert "`cover_letter` (attached / unverified / no_box / no_file / failed)" in text
    assert "`unverified` means Job Catcher put the file in" in text


def test_a_photo_missed_while_job_catcher_was_filling_says_what_to_do():
    assert svc.REASONS["filling"] == (
        "Job Catcher was still filling this page, so no photo then (the answers "
        "are kept). Call page_done again once fill_page has returned"
    )
