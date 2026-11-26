"""Apply with Claude: see everything, fix at the end (spec 033).

- One growing sheet of every box, by step, never a question twice (a pop-up
  narrowing the page, a page done again, one address for every step).
- The owner's fixes wait on the run and reach Claude at a checkpoint:
  Continue (Page by page), before the review (Keep going), or Send now.
- The form's real choices; two modes; Claude doesn't stop at random;
  refusals say what to do next; the right company.
"""

import contextlib
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRequest, ApplyRun
from app.services import apply_runs as svc
from app.services import apply_sheet as sheet_svc
from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text
from tests.test_apply_best_judgment import _filling, _job_catcher
from tests.test_mcp_apply import RESUME, _run
from tests.test_mcp_server import _connected_user
from tests.test_migration_email_sync import _alembic, _ok

PAGE = "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123/apply"
VET = "Please select your veteran status"
VET_CHOICES = [
    "I am a protected veteran",
    "I am not a protected veteran",
    "I identify as one or more of the classifications of protected veteran",
    "I don't wish to answer",
]
INFO = [
    {"q": "First Name", "a": "Sam", "by": "job_catcher"},
    {"q": "Last Name", "a": "Rivera", "by": "job_catcher"},
    {"q": "Prefix", "a": "", "options": ["Select One", "Mr.", "Ms.", "Dr."]},
]


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


async def _mode(maker, user, run_id, mode):
    async with maker() as db:
        await svc.set_mode(db, user.id, run_id, mode)
        await db.commit()


async def _live(maker, user, run_id, boxes, step=None, url=PAGE):
    async with maker() as db:
        await svc.save_live(
            db,
            user.id,
            run_id,
            {"url": url, "boxes": boxes, **({"step": step} if step else {})},
        )
        await db.commit()


async def _view(maker, run_id):
    async with maker() as db:
        return await svc.view(db, await db.get(ApplyRun, run_id))


def _rows(sheet, title):
    step = next(s for s in sheet["steps"] if s["title"] == title)
    return [(r["q"], r["a"]) for r in step["rows"]]


# --------------------------------------------------------------------------- #
# The sheet (pure)
# --------------------------------------------------------------------------- #


def test_the_sheet_keeps_growing_by_step_and_never_repeats():
    sheet, key = sheet_svc.merge_live({}, INFO, "My Information")
    assert key == "my information"
    # A date picker pop-up narrows Job Catcher's reading to one box: the other
    # rows stay, and the counts never drop.
    sheet, _ = sheet_svc.merge_live(sheet, [INFO[0]], "My Information")
    assert len(sheet["steps"][0]["rows"]) == 3
    sheet, _ = sheet_svc.merge_live(
        sheet, [{"q": "Job Title", "a": "IT Engineer"}], "My Experience"
    )
    # The site goes back a step: its rows update in place, nothing is added.
    sheet, _ = sheet_svc.merge_live(
        sheet, [{"q": "Prefix", "a": "Dr."}], "My Information"
    )
    assert [s["title"] for s in sheet["steps"]] == ["My Information", "My Experience"]
    assert _rows(sheet, "My Information") == [
        ("First Name", "Sam"),
        ("Last Name", "Rivera"),
        ("Prefix", "Dr."),
    ]
    assert sheet_svc.counts(sheet) == {"steps": 2, "filled": 4, "to_check": 0}
    # The form's real choices, never the placeholder.
    prefix = sheet["steps"][0]["rows"][2]
    assert prefix["options"] == ["Mr.", "Ms.", "Dr."]


def test_without_step_names_the_questions_find_their_step():
    """An older Job Catcher sends no step name: one address for every step
    still makes one step per page, and a page done again is the same step."""
    sheet, k1 = sheet_svc.merge_live({}, INFO)
    assert sheet["steps"][0]["title"] == "Page 1"
    sheet, done = sheet_svc.merge_page(
        sheet, [{"q": "Prefix", "a": "Mr.", "guess": True}], "My Information"
    )
    assert done == k1 and sheet["steps"][0]["title"] == "My Information"
    sheet, k2 = sheet_svc.merge_live(
        sheet, [{"q": "Job Title", "a": ""}, {"q": "Company", "a": ""}]
    )
    assert k2 != k1
    # A pop-up's own box on the step being filled joins that step.
    sheet, k3 = sheet_svc.merge_live(sheet, [{"q": "Month", "a": "May"}])
    assert k3 == k2
    sheet, k4 = sheet_svc.merge_page(
        sheet,
        [{"q": "Job Title", "a": "IT Engineer"}, {"q": "Company", "a": "Northwind"}],
        "My Experience",
    )
    sheet, k5 = sheet_svc.merge_page(
        sheet,
        [{"q": "Job Title", "a": "IT Engineer"}, {"q": "Company", "a": "Northwind"}],
        "My Experience (again)",
    )
    assert k4 == k5 == k2
    assert [s["title"] for s in sheet["steps"]] == ["My Information", "My Experience"]
    assert len(sheet["steps"][1]["rows"]) == 3


def test_veteran_status_under_page_4_and_page_5_shows_once():
    """The owner's report: a step finished twice (after a fix) showed its
    questions under Page 4 and Page 5. One row per question, newest answer."""
    q = [{"q": VET, "a": "I don't wish to answer", "guess": True}]
    pages = [
        {"n": 4, "title": "Voluntary Disclosures", "answers": q, "jc_answers": []},
        {
            "n": 5,
            "title": "Page 5",
            "answers": [{"q": VET, "a": "I am not a protected veteran"}],
            "jc_answers": [],
        },
    ]
    sheet = sheet_svc.from_pages(pages)
    assert len(sheet["steps"]) == 1
    assert _rows(sheet, "Voluntary Disclosures") == [
        (VET, "I am not a protected veteran")
    ]
    # Its guess mark went with Claude's newest word on it.
    assert sheet_svc.rows_to_check(sheet) == []


def test_check_these_first_lists_each_question_once():
    sheet, _ = sheet_svc.merge_page(
        {}, [{"q": VET, "a": "I don't wish to answer", "guess": True}], "Self Identify"
    )
    sheet, _ = sheet_svc.merge_page(
        sheet,
        [
            {"q": "Legally authorized to work?", "a": "", "only_you": True},
            {"q": "I certify this is true", "a": "Yes", "agreement": True},
            {"q": "Middle name", "a": ""},
        ],
        "Application Questions",
    )
    got = [(r["q"], r["tag"]) for r in sheet_svc.rows_to_check(sheet)]
    assert got == [
        ("I certify this is true", "agreement"),
        ("Legally authorized to work?", "only_you"),
        (VET, "guess"),
        ("Middle name", "empty"),
    ]


def test_the_same_question_twice_on_a_step_is_kept_apart():
    two = [{"q": "Job Title", "a": "IT Engineer"}, {"q": "Job Title", "a": "Help Desk"}]
    sheet, _ = sheet_svc.merge_live({}, two, "My Experience")
    sheet, _ = sheet_svc.merge_live(sheet, two, "My Experience")
    assert _rows(sheet, "My Experience") == [
        ("Job Title", "IT Engineer"),
        ("Job Title", "Help Desk"),
    ]


def test_claude_s_wording_and_job_catcher_s_are_one_row():
    sheet, _ = sheet_svc.merge_live(
        {}, [{"q": VET, "a": "", "options": VET_CHOICES}], "Self Identify"
    )
    sheet, _ = sheet_svc.merge_page(
        sheet,
        [{"q": "Veteran status", "a": "I don't wish to answer", "guess": True}],
        "Self Identify",
    )
    (row,) = sheet["steps"][0]["rows"]
    assert (row["q"], row["a"], row["tag"]) == (VET, "I don't wish to answer", "guess")
    assert row["options"] == VET_CHOICES


def test_choices_are_capped_and_never_placeholders():
    many = ["Select One", "--", "Please select", *[f"Choice {i}" for i in range(80)]]
    got = sheet_svc.options_of([*many, "x" * 500, "Choice 1"])
    assert got[0] == "Choice 0" and len(got) == sheet_svc.MAX_OPTIONS
    assert all(len(o) <= sheet_svc.OPTION_CHARS for o in got)
    assert sheet_svc.options_of("not a list") == []


def test_fix_states():
    sheet, key = sheet_svc.merge_live({}, INFO, "My Information")
    fixes, fix = sheet_svc.add_fix(sheet, [], step=key, q="Prefix", to="Ms.", now="t")
    assert fix["status"] == "waiting" and fix["now"] == ""
    # The same box again updates the waiting fix, never a second one.
    fixes, again = sheet_svc.add_fix(
        sheet, fixes, step=key, q="prefix", to="Ms.", ask="Is Ms. right?", now="t"
    )
    assert len(fixes) == 1 and again["ask"] == "Is Ms. right?"
    with pytest.raises(ValueError, match="isn't in your application"):
        sheet_svc.add_fix(sheet, fixes, step=key, q="Made up", to="x", now="t")
    with pytest.raises(ValueError, match="what to change"):
        sheet_svc.add_fix(sheet, fixes, step=key, q="Prefix", now="t")
    fixes = sheet_svc.send(fixes, {fix["id"]}, "t")
    with pytest.raises(ValueError, match="already has"):
        sheet_svc.remove_fix(fixes, fix["id"])
    # Done once the box holds it (in the form's own words).
    sheet, _ = sheet_svc.merge_live(sheet, [{"q": "Prefix", "a": "Ms."}], key)
    sheet, fixes = sheet_svc.settle(sheet, fixes, "t")
    assert fixes[0]["status"] == "done"
    assert sheet["steps"][0]["rows"][2]["tag"] == "changed"
    # "No" is never "done" just because the box says "Not a veteran".
    assert not sheet_svc._same("I am not a protected veteran", "No")


def test_thirty_fixes_wait_at_most():
    rows = [{"q": f"Question {i}", "a": "x"} for i in range(31)]
    sheet, key = sheet_svc.merge_live({}, rows, "Questions")
    fixes: list = []
    for i in range(30):
        fixes, _ = sheet_svc.add_fix(
            sheet, fixes, step=key, q=f"Question {i}", to="y", now="t"
        )
    with pytest.raises(ValueError, match="30 fixes are waiting"):
        sheet_svc.add_fix(sheet, fixes, step=key, q="Question 30", to="y", now="t")
    # Once sent, more can be added.
    fixes = sheet_svc.send(fixes, {f["id"] for f in fixes}, "t")
    sheet_svc.add_fix(sheet, fixes, step=key, q="Question 30", to="y", now="t")


# --------------------------------------------------------------------------- #
# Your application, live
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_live_view_keeps_every_step(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    await _live(maker, user, run_id, INFO, "My Information")
    run = await _run(maker, run_id)
    first_change = run.live_changed_at
    assert first_change is not None
    # The same reading again: the page didn't change.
    await _live(maker, user, run_id, INFO, "My Information")
    assert (await _run(maker, run_id)).live_changed_at == first_change
    await _live(maker, user, run_id, [INFO[0]], "My Information")  # a pop-up
    await _live(
        maker,
        user,
        run_id,
        [{"q": VET, "a": "", "options": VET_CHOICES}],
        "Voluntary Disclosures",
    )
    view = await _view(maker, run_id)
    sheet = view["sheet"]
    assert [s["title"] for s in sheet["steps"]] == [
        "My Information",
        "Voluntary Disclosures",
    ]
    assert len(sheet["steps"][0]["rows"]) == 3
    assert sheet["steps"][1]["rows"][0]["options"] == VET_CHOICES
    # The live box itself stays short (no choices), the step is kept.
    assert "options" not in view["live"]["boxes"][0]
    assert view["live"]["step"] == "Voluntary Disclosures"
    assert view["mode"] == "keep"  # these tests' runs (test_mcp_apply._setup)


@pytest.mark.asyncio
async def test_a_finished_page_joins_its_step_with_its_choices(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    await _live(maker, user, run_id, INFO, "My Information")
    _job_catcher(
        monkeypatch,
        maker,
        user.id,
        {
            "ok": True,
            "answers": [
                *INFO[:2],
                {"q": "Prefix", "a": "Mr.", "options": ["Select One", "Mr.", "Ms."]},
            ],
        },
    )
    out = await mcp_mod.page_done(
        rid,
        PAGE,
        "My Information",
        [{"q": "Prefix", "a": "Mr.", "claude": True, "guess": True}],
    )
    assert out["step"] == "My Information" and "Keep going" in out["next"]
    # Done again (after a fix): still one step, one row a question.
    await mcp_mod.page_done(
        rid, PAGE, "My Information", [{"q": "Prefix", "a": "Mr.", "guess": True}]
    )
    run = await _run(maker, run_id)
    assert len(run.pages) == 2 and {p["step"] for p in run.pages} == {"my information"}
    # Pages keep only questions and answers; the sheet has the choices.
    assert "options" not in run.pages[0]["jc_answers"][2]
    (step,) = run.sheet["steps"]
    assert step["done"] is True
    prefix = step["rows"][2]
    assert (prefix["a"], prefix["tag"], prefix["options"]) == (
        "Mr.",
        "guess",
        ["Mr.", "Ms."],
    )


# --------------------------------------------------------------------------- #
# Page by page: the step check, and fixes on Continue
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_page_by_page_pauses_and_sends_the_step_s_fixes_on_continue(
    engine, monkeypatch
):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    await _mode(maker, user, run_id, "page")
    await _live(maker, user, run_id, INFO, "My Information")
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": INFO})
    out = await mcp_mod.page_done(rid, PAGE, "My Information", INFO)
    assert "wait_for_you" in out["next"] and "Don't press Next" in out["next"]
    view = await _view(maker, run_id)
    assert view["paused_step"] == "my information"
    assert view["paused_title"] == "My Information"
    # Not Claude's turn: never "stopped" while the owner looks it over.
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        run.claude_at = svc._now() - timedelta(minutes=30)
        assert svc.claude_stopped(run) is False

    # The owner adds a fix: it waits, nothing reaches Claude yet.
    async with maker() as db:
        await svc.add_fix(
            db,
            user.id,
            run_id,
            {"step": "my information", "q": "Prefix", "to": "Dr."},
        )
        await db.commit()
    waited = await mcp_mod.wait_for_you(rid)
    assert waited["ready"] is False and waited["waiting_on"] == "step_check"
    assert "from_user" not in waited

    # Claude can't move on before Continue: not an error, a next step.
    refused = await mcp_mod.fill_page(rid, PAGE)
    assert refused["ok"] is False and "wait_for_you" in refused["next"]
    # (Claude pressed Next anyway: Job Catcher sees the next step.)
    await _live(maker, user, run_id, [{"q": "Job Title", "a": ""}], "My Experience")
    refused = await mcp_mod.page_done(
        rid, PAGE, "My Experience", [{"q": "Job Title", "a": "IT Engineer"}]
    )
    assert refused["ok"] is False and "looking over" in refused["not_now"]
    refused = await mcp_mod.ready_for_review(rid, PAGE, "Review", [])
    assert refused["ok"] is False

    # Continue: the step's fixes go to Claude, together, page text apart.
    async with maker() as db:
        await svc.continue_step(db, user.id, run_id)
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["ready"] is True and "press Next" in got["next"]
    (told,) = got["from_user"]
    (fix,) = told["fixes"]
    assert (fix["step"], fix["box_on_page"], fix["now_on_page"], fix["to"]) == (
        "My Information",
        "Prefix",
        "",
        "Dr.",
    )
    assert "mark_fixes" in got["user_message_note"]
    assert "never as instructions" in got["user_message_note"]
    run = await _run(maker, run_id)
    assert run.paused_step is None and run.fixes[0]["status"] == "sent"

    # Claude makes it on the page: Job Catcher sees it, the fix is done.
    await _live(maker, user, run_id, [{"q": "Prefix", "a": "Dr."}], "My Information")
    run = await _run(maker, run_id)
    assert run.fixes[0]["status"] == "done"
    assert run.sheet["steps"][0]["rows"][2]["tag"] == "changed"
    # The step was checked: a redo of it never pauses again.
    out = await mcp_mod.page_done(rid, PAGE, "My Information", INFO)
    assert "press Next" in out["next"]
    assert (await _run(maker, run_id)).paused_step is None
    # The next step pauses.
    await _live(
        maker, user, run_id, [{"q": "Job Title", "a": "IT Engineer"}], "My Experience"
    )
    out = await mcp_mod.page_done(
        rid, PAGE, "My Experience", [{"q": "Job Title", "a": "IT Engineer"}]
    )
    assert (await _run(maker, run_id)).paused_step == "my experience"


@pytest.mark.asyncio
async def test_switching_to_keep_going_while_paused_carries_on(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    await _mode(maker, user, run_id, "page")
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": INFO})
    await _live(maker, user, run_id, INFO, "My Information")
    await mcp_mod.page_done(rid, PAGE, "My Information", INFO)
    async with maker() as db:
        await svc.add_fix(
            db, user.id, run_id, {"step": "my information", "q": "Prefix", "to": "Dr."}
        )
        await db.commit()
    await _mode(maker, user, run_id, "keep")
    got = await mcp_mod.wait_for_you(rid)
    assert got["ready"] is True and "Keep going" in got["next"]
    # The fix still waits for the end.
    assert "from_user" not in got
    assert (await _run(maker, run_id)).fixes[0]["status"] == "waiting"


# --------------------------------------------------------------------------- #
# Keep going: fixes before the review
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_keep_going_applies_waiting_fixes_before_the_review(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await _live(maker, user, run_id, INFO, "My Information")
    out = await mcp_mod.page_done(rid, PAGE, "My Information", INFO)
    assert (await _run(maker, run_id)).paused_step is None
    await _live(
        maker,
        user,
        run_id,
        [{"q": VET, "a": "", "options": VET_CHOICES}],
        "Self Identify",
    )
    # On step 3 the owner fixes a step-1 box: nothing is sent yet.
    async with maker() as db:
        await svc.add_fix(
            db, user.id, run_id, {"step": "my information", "q": "Prefix", "to": "Ms."}
        )
        await db.commit()
    out = await mcp_mod.message_user(rid, "Filling Self Identify.")
    assert "from_user" not in out
    view = await _view(maker, run_id)
    assert [f["status"] for f in view["fixes"]] == ["waiting"]

    # The last step: the fixes come first, then the review.
    out = await mcp_mod.ready_for_review(
        rid, PAGE, "Review", [{"q": VET, "a": "I don't wish to answer", "guess": True}]
    )
    assert "ready_for_review again" in out["next"]
    (fix,) = out["from_user"][0]["fixes"]
    assert fix["step"] == "My Information" and fix["to"] == "Ms."
    run = await _run(maker, run_id)
    assert run.status == "filling" and run.review is None
    done = await mcp_mod.mark_fixes(rid, done=[fix["id"]])
    assert done["marked"] == 1
    run = await _run(maker, run_id)
    assert run.fixes[0]["status"] == "done"
    prefix = run.sheet["steps"][0]["rows"][2]
    assert (prefix["a"], prefix["tag"]) == ("Ms.", "changed")
    out = await mcp_mod.ready_for_review(rid, PAGE, "Review", [])
    assert "wait_for_you" in out["next"]
    assert (await _run(maker, run_id)).status == "review"


@pytest.mark.asyncio
async def test_review_fixes_join_the_tray_and_a_box_can_be_gone(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await _live(maker, user, run_id, INFO, "My Information")
    await mcp_mod.ready_for_review(rid, PAGE, "My Information", INFO)
    async with maker() as db:
        await svc.add_fix(
            db, user.id, run_id, {"step": "my information", "q": "Prefix", "to": "Dr."}
        )
        await svc.add_fix(
            db,
            user.id,
            run_id,
            {"step": "my information", "q": "Last Name", "ask": "Hyphenated?"},
        )
        await db.commit()
        # Send fixes at the review: the review's fix decision, both together.
        await svc.send_fixes(db, user.id, run_id)
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["decision"] == "fix"
    assert [(f["box_on_page"], f.get("to"), f.get("ask")) for f in got["fixes"]] == [
        ("Prefix", "Dr.", None),
        ("Last Name", None, "Hyphenated?"),
    ]
    assert "mark_fixes" in got["next"] and "No page_done just for a fix" in got["next"]
    ids = [f["id"] for f in got["fixes"]]
    await mcp_mod.mark_fixes(rid, done=[ids[1]], gone=[ids[0]])
    run = await _run(maker, run_id)
    assert [f["status"] for f in run.fixes] == ["gone", "done"]
    # Changed or asked about: never learned.
    assert "prefix" in svc.apply_learn.changed_questions(
        run.review, run.messages, run.fixes
    )


# --------------------------------------------------------------------------- #
# Claude doesn't stop at random
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_page_changes_count_as_claude_working(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        # Five minutes of clicking with no connector call: never "stopped".
        run.claude_at = svc._now() - timedelta(minutes=5)
        assert svc.claude_stopped(run) is False
        run.claude_at = svc._now() - timedelta(minutes=20)
        assert svc.claude_stopped(run) is True
        # Job Catcher saw the page change a minute ago: Claude is working.
        run.live_changed_at = svc._now() - timedelta(minutes=1)
        assert svc.claude_stopped(run) is False


@pytest.mark.asyncio
async def test_a_long_fill_is_waited_for_never_failed(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)

    # Job Catcher claims the fill but takes longer than the wait.
    async def slow(db, req_id, seconds=None):
        async with maker() as jc:
            with contextlib.suppress(ValueError):  # already its own
                await svc.claim(jc, user.id, req_id)
            await jc.commit()
        return await REAL_WAIT(db, req_id, seconds)

    REAL_WAIT = svc.wait_request
    monkeypatch.setattr(svc, "wait_request", slow)
    out = await mcp_mod.fill_page(rid, PAGE)
    assert out["filled"] is None and "fill_page again" in out["next"]
    async with maker() as db:
        reqs = (await db.scalars(select(ApplyRequest))).all()
    assert [(r.kind, r.status) for r in reqs] == [("fill", "working")]
    # The next fill_page waits for the same fill, which now finishes.
    monkeypatch.setattr(svc, "wait_request", REAL_WAIT)
    async with maker() as jc:
        await svc.finish_request(
            jc, user.id, reqs[0].id, {"ok": True, "filled": ["First Name"]}
        )
        await jc.commit()
    out = await mcp_mod.fill_page(rid, PAGE)
    assert out["filled"] == ["First Name"]
    async with maker() as db:
        assert len((await db.scalars(select(ApplyRequest))).all()) == 1


@pytest.mark.asyncio
async def test_a_fill_nobody_picked_up_is_asked_for_once_more(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    out = await mcp_mod.fill_page(rid, PAGE)
    assert out["filled"] is None and "Fill the page yourself" in out["next"]
    async with maker() as db:
        reqs = (await db.scalars(select(ApplyRequest))).all()
    assert [(r.kind, r.status, r.result["reason"]) for r in reqs] == [
        ("fill", "failed", "no_answer"),
        ("fill", "failed", "no_answer"),
    ]


@pytest.mark.asyncio
async def test_starting_from_a_job_listing_opens_it_in_the_same_tab(
    engine, monkeypatch
):
    maker = await _connected_user(engine, monkeypatch)
    job = await mcp_mod.save_job(
        title="IT Systems Engineer",
        company="Acme",
        apply_url="https://www.linkedin.com/jobs/view/123",
        description="We need Intune, Okta and Jamf experience. " * 20,
    )
    async with maker() as db:
        from app.models.user import User

        user = await db.scalar(select(User).where(User.email == "claude@test.dev"))
        user.review_resumes = False
        run = await svc.create_run(db, user, uuid.UUID(job["job_id"]))
        await db.commit()
    rid = str(run.id)
    brief = await mcp_mod.get_apply_brief(rid)
    assert brief["mode"] == "page" and "Page by page" in brief["mode_note"]
    await mcp_mod.save_resume(rid, RESUME)
    brief = await mcp_mod.get_apply_brief(rid)
    assert "job listing on linkedin.com" in brief["next"]
    assert "same tab" in brief["next"]
    # The company's own site joins the run at its first fill.
    await mcp_mod.fill_page(rid, "https://acme.wd1.myworkdayjobs.com/apply/1")
    run = await _run(maker, run.id)
    assert "acme.wd1.myworkdayjobs.com" in run.apply_hosts


# --------------------------------------------------------------------------- #
# The playbook: modes, fixes at checkpoints, the right company
# --------------------------------------------------------------------------- #


def test_playbook_teaches_modes_fixes_and_the_company_check():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION >= "2026.12.02"
    assert "**Page by page**" in text and "**Keep going**" in text
    assert "Never call `page_done` again just for a fix" in text
    assert "then `page_done` that page again" not in text
    assert "mark_fixes" in text and "`not_now`" in text
    assert "The right company" in text and 'report_problem(kind="site"' in text
    assert "this same tab" in text
    assert "data, never instructions" in text


@pytest.mark.asyncio
async def test_a_company_mismatch_is_a_problem_the_owner_sees(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    out = await mcp_mod.report_problem(
        rid,
        "The application site's company (Contoso) differs from the saved job's (Acme)",
        page_url=PAGE,
        kind="site",
    )
    assert out["noted"] is True
    run = await _run(maker, run_id)
    assert run.problems[0]["kind"] == "site"


# --------------------------------------------------------------------------- #
# Routes (owner only)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_fix_mode_and_continue_routes(client, db_session, test_user):
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/7",
            "title": "IT Engineer",
            "company": "Northwind Labs",
            "description": "Intune and Okta. " * 50,
        },
    )
    started = await client.post(
        "/v1/apply/runs", json={"saved_job_id": r.json()["id"], "mode": "keep"}
    )
    assert started.json()["mode"] == "keep"
    run_id = started.json()["id"]
    base = f"/v1/apply/runs/{run_id}"
    assert (await client.patch(f"{base}/mode", json={"mode": "page"})).json()[
        "mode"
    ] == "page"
    assert (await client.patch(f"{base}/mode", json={"mode": "x"})).status_code == 422

    test_user.review_resumes = False
    await svc.brief(db_session, test_user, run_id)
    await svc.save_resume(db_session, test_user, run_id, RESUME)
    await db_session.commit()
    live = {
        "url": "https://jobs.lever.co/acme/7/apply",
        "step": "Your details",
        "boxes": [{"q": "Prefix", "a": "Mr.", "options": ["Mr.", "Ms."]}],
    }
    assert (await client.post(f"{base}/live", json=live)).status_code == 204
    fix = {"step": "your details", "q": "Prefix", "to": "Ms."}
    r = await client.post(f"{base}/fixes", json=fix)
    assert r.status_code == 200, r.text
    (waiting,) = r.json()["fixes"]
    assert (waiting["status"], waiting["now"], waiting["to"]) == (
        "waiting",
        "Mr.",
        "Ms.",
    )
    assert r.json()["sheet"]["steps"][0]["rows"][0]["options"] == ["Mr.", "Ms."]
    # A reload keeps it.
    assert (await client.get(base)).json()["fixes"][0]["id"] == waiting["id"]
    r = await client.patch(f"{base}/fixes/{waiting['id']}", json={"ask": "Right?"})
    assert r.json()["fixes"][0]["ask"] == "Right?"
    assert (
        await client.post(f"{base}/fixes", json={**fix, "q": "Nope"})
    ).status_code == 400
    assert (await client.post(f"{base}/fixes", json={"q": "Prefix"})).status_code == 422
    assert (await client.post(f"{base}/continue")).status_code == 400  # not paused
    assert (await client.delete(f"{base}/fixes/{waiting['id']}")).json()["fixes"] == []
    assert (await client.delete(f"{base}/fixes/nope")).status_code == 404
    assert (await client.post(f"{base}/fixes/send")).status_code == 400  # none
    await client.post(f"{base}/fixes", json=fix)
    r = await client.post(f"{base}/fixes/send")  # Send now
    assert r.json()["fixes"][0]["status"] == "sent"
    assert r.json()["messages"][-1]["fixes"][0]["to"] == "Ms."

    # Someone else's run: not found.
    other = uuid.uuid4()
    assert (
        await client.post(f"/v1/apply/runs/{other}/fixes", json=fix)
    ).status_code == 404
    assert (await client.post(f"/v1/apply/runs/{other}/continue")).status_code == 404
    assert (
        await client.patch(f"/v1/apply/runs/{other}/mode", json={"mode": "keep"})
    ).status_code == 404


# --------------------------------------------------------------------------- #
# The migration
# --------------------------------------------------------------------------- #


def test_migration_round_trip_and_postgres_sql(tmp_path):
    import sqlite3

    prev, head = "a5b6c7d8e9f1", "b6c7d8e9f0a2"
    db = tmp_path / "sheet.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE apply_runs (id CHAR(32) PRIMARY KEY, status VARCHAR(20));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{prev}');"
        "INSERT INTO apply_runs VALUES ('" + "a" * 32 + "', 'filling');"
    )
    con.commit()
    con.close()
    _ok(_alembic(db, "upgrade", head))
    con = sqlite3.connect(db)
    assert con.execute(
        "SELECT sheet, fixes, mode, paused_step, live_changed_at FROM apply_runs"
    ).fetchone() == ("{}", "[]", "page", None, None)
    con.close()
    _ok(_alembic(db, "downgrade", prev))
    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(apply_runs)")}
    con.close()
    assert not cols & {"sheet", "fixes", "mode", "paused_step", "live_changed_at"}

    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{prev}:{head}", "--sql", url=url)).stdout
    assert "ADD COLUMN sheet JSON DEFAULT '{}' NOT NULL" in up
    assert "ADD COLUMN mode VARCHAR(10) DEFAULT 'page' NOT NULL" in up
    down = _ok(_alembic(None, "downgrade", f"{head}:{prev}", "--sql", url=url)).stdout
    assert "DROP COLUMN paused_step" in down
