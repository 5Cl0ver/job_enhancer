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
