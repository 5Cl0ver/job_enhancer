"""Long answers in full (spec 039): a Workday answer of 1,500 characters with
line breaks reaches the sheet, the fix and Claude whole, not cut at 300 and
flattened to one line. Invented people and companies throughout."""

import pytest

from app.models.apply import ApplyRun
from app.services import apply_sheet as sheet_svc
from tests.test_apply_best_judgment import _filling
from tests.test_apply_fix_at_end import _live

STEP = "Application Questions"
Q = "Tell us about a project you led"
LONG = (
    "At Northwind Labs I led the move of 40 internal apps to single sign-on.\n\n"
    + " ".join(
        ["We planned it in waves, tested each with its team, and kept a way back."] * 20
    )
    + "\nIt finished a month early."
)


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    from app.services import apply_runs as svc

    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


def test_the_answer_is_long_enough():
    assert 1400 < len(LONG) < 2000 and "\n\n" in LONG


def test_answer_text_keeps_line_breaks_and_folds_spaces():
    raw = "Line one   here \r\n\r\n\r\n\r\n  Line\ttwo\n"
    assert sheet_svc.answer_text(raw) == "Line one here\n\nLine two"
    assert len(sheet_svc.answer_text("x" * 5000)) == sheet_svc.ANSWER_CHARS


@pytest.mark.asyncio
async def test_the_live_view_keeps_a_long_answer_whole(engine, monkeypatch):
    maker, user, run_id, *_ = await _filling(engine, monkeypatch)
    await _live(maker, user, run_id, [{"q": Q, "a": LONG}], STEP)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert run.live["boxes"][0]["a"] == LONG
        (row,) = sheet_svc.step_of(run.sheet, run.sheet["current"])["rows"]
        assert row["a"] == LONG

        # A fix on it keeps the whole text, and so does what Claude gets.
        key = run.sheet["current"]
        fixes, fix = sheet_svc.add_fix(
            run.sheet, [], step=key, q=Q, to="A shorter answer.", now="t"
        )
        assert fix["now"] == LONG
        assert sheet_svc.for_claude(run.sheet, fix)["now_on_page"] == LONG


# --------------------------------------------------------------------------- #
# A change past the first 200 characters is a change (review of 039)
# --------------------------------------------------------------------------- #

NEW_END = LONG.replace("It finished a month early.", "It finished on time.")


def _long_sheet(answer=LONG):
    sheet, key = sheet_svc.merge_live({}, [{"q": Q, "a": answer}], STEP)
    return sheet, key


def test_changing_the_end_of_a_long_answer_waits_for_claude():
    sheet, key = _long_sheet()
    _fixes, fix = sheet_svc.add_fix(sheet, [], step=key, q=Q, to=NEW_END, now="t")
    assert fix["status"] == "waiting" and "already" not in fix
    # The same text again is still "already there".
    _fixes, same = sheet_svc.add_fix(sheet, [], step=key, q=Q, to=LONG, now="t")
    assert same["status"] == "done" and same["already"] is True


def test_a_sent_fix_on_a_long_answer_settles():
    sheet, key = _long_sheet()
    fixes, fix = sheet_svc.add_fix(sheet, [], step=key, q=Q, to=NEW_END, now="t")
    fixes = sheet_svc.send(fixes, {fix["id"]}, "t")
    # Not yet: the box still holds the old answer.
    sheet, fixes = sheet_svc.settle(sheet, fixes, "t2")
    assert fixes[0]["status"] == "sent"
    # Job Catcher reads the box holding the new end.
    sheet, _ = sheet_svc.merge_live(sheet, [{"q": Q, "a": NEW_END}], STEP)
    sheet, fixes = sheet_svc.settle(sheet, fixes, "t3")
    assert fixes[0]["status"] == "done"


# --------------------------------------------------------------------------- #
# The owner's paragraphs reach Claude as paragraphs (review of 039)
# --------------------------------------------------------------------------- #

TYPED = "First paragraph here.  \r\n\r\n\r\n  Second paragraph, with\ta tab.\r\n"
CLEAN = "First paragraph here.\n\nSecond paragraph, with a tab."


@pytest.mark.asyncio
async def test_a_typed_change_keeps_its_paragraphs(engine, monkeypatch):
    from app.services import apply_runs as svc

    maker, user, run_id, *_ = await _filling(engine, monkeypatch)
    await _live(maker, user, run_id, [{"q": Q, "a": LONG}], STEP)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        key = run.sheet["current"]
        run = await svc.add_fix(db, user.id, run_id, {"step": key, "q": Q, "to": TYPED})
        (fix,) = run.fixes
        assert fix["to"] == CLEAN
        edited = TYPED + "Third."
        run = await svc.edit_fix(db, user.id, run_id, fix["id"], {"to": edited})
        assert run.fixes[0]["to"] == CLEAN + "\nThird."
        await svc.send_fixes(db, user.id, run_id)
        await db.commit()
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        (told,) = [m for m in run.messages if m.get("fixes")]
        assert told["fixes"][0]["to"] == CLEAN + "\nThird."
