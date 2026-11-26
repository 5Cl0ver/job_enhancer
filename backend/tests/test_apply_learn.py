"""Learning from Claude's runs (spec 029): what Claude wrote for a box Job
Catcher couldn't fill becomes the user's autofill memory once the user
approves the review, marked "from Claude". Only Claude's facts, never its
guesses; never self-ID, private details, agreements, essays, legal or
eligibility questions, salary or one company's questions, the user's own
details, anything the user changed, or anything the user deleted. Invented
people and companies."""

import uuid

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRun
from app.models.custom_answer import CustomAnswer
from app.models.user import User
from app.services import apply_learn
from app.services import apply_runs as svc
from tests.test_apply_best_judgment import PAGE, _filling, _job_catcher

ROUND_ONE = [
    {"q": "How did you hear about us?", "a": "LinkedIn", "guess": True},
    {"q": "Are you 18 years of age or older?", "a": "Yes", "claude": True},
    {"q": "Years of experience with Intune?", "a": "3", "claude": True},
    {
        "q": "Which scripting tools do you use?",
        "a": ["PowerShell", "Bash"],
        "claude": True,
    },
    {"q": "Are you willing to travel up to 25%?", "a": "Yes", "claude": True},
    {"q": "Can you lift 50 pounds?", "a": "Yes", "claude": True},  # deleted before
    {"q": "Are you able to work weekends?", "a": "Yes", "guess": True},
    {"q": "Do you have a valid driver's license?", "a": "Yes", "claude": True},
    {"q": "Gender", "a": "Decline to answer", "guess": True},
    {"q": "Are you a protected veteran?", "a": "No", "claude": True},
    {"q": "I agree to the terms and conditions", "a": "Checked", "claude": True},
    {"q": "I certify that the information is true", "a": "Yes", "claude": True},
    {"q": "Do you accept the policy?", "a": "Yes", "agreement": True, "claude": True},
    {"q": "What is your desired salary?", "a": "$95,000", "claude": True},
    {"q": "Have you previously worked for us?", "a": "No", "claude": True},
    {"q": "Do you have relatives working here?", "a": "No", "claude": True},
    {"q": "How many Acme products have you used?", "a": "Two", "claude": True},
    {"q": "Have you ever been convicted of a felony?", "a": "No", "claude": True},
    {"q": "Are you legally authorized to work in the US?", "a": "Yes", "claude": True},
    {
        "q": "Will you now or in the future require sponsorship?",
        "a": "No",
        "claude": True,
    },
    {"q": "Do you hold an active security clearance?", "a": "No", "claude": True},
    {"q": "Are you a US citizen?", "a": "Yes", "claude": True},
    {"q": "Why do you want to work here?", "a": "I like it.", "claude": True},
    {"q": "Anything we should know", "a": "x" * 400, "claude": True},
    {"q": "Phone Extension", "a": "12", "claude": True},
    {"q": "Legal first name", "a": "Sam", "claude": True},
    {"q": "Preferred shift", "a": "Days"},  # Job Catcher's or the page's own
    {"q": "Years with Okta", "a": "2", "by": "job_catcher"},
]


async def _decide(maker, user, run_id, decision, fixes=None, note=None):
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, decision, note, by="app", fixes=fixes)
        await db.commit()


async def _memory(maker, user) -> dict[str, CustomAnswer]:
    async with maker() as db:
        rows = await db.scalars(
            select(CustomAnswer).where(CustomAnswer.user_id == user.id)
        )
        return {r.question_key: r for r in rows}


@pytest.mark.asyncio
async def test_approved_answers_are_learned_from_claude(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    async with maker() as db:
        # The user's own answer is never replaced…
        db.add(
            CustomAnswer(
                user_id=user.id,
                question_key="are you 18 years of age or older",
                question_text="Are you 18 or older?",
                answer="Yes, I am",
            )
        )
        # …and one they deleted is never learned again.
        (await db.get(User, user.id)).forgotten_answers = ["can you lift 50 pounds"]
        await db.commit()
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.page_done(rid, PAGE, "My Information", ROUND_ONE)
    await mcp_mod.ready_for_review(rid, PAGE + "/review", "Review", [])

    # The user changes an answer at the review: nothing is learned yet.
    fixes = [
        {"page": 1, "q": "Are you willing to travel up to 25%?", "a": "Yes", "to": "No"}
    ]
    await _decide(maker, user, run_id, "fix", fixes=fixes)
    assert set(await _memory(maker, user)) == {"are you 18 years of age or older"}

    # Claude fixes it and hands it back; the user says submit.
    await mcp_mod.wait_for_you(rid)
    await mcp_mod.ready_for_review(
        rid,
        PAGE + "/review",
        "Review",
        [{"q": "Are you willing to travel up to 25%?", "a": "No", "claude": True}],
    )
    await _decide(maker, user, run_id, "submit")

    memory = await _memory(maker, user)
    learned = {k: (r.answer, r.source) for k, r in memory.items()}
    assert learned == {
        "years of experience with intune": ("3", "claude"),
        # A list of choices, as the box shows it.
        "which scripting tools do you use": ("PowerShell, Bash", "claude"),
        # Already the user's: untouched.
        "are you 18 years of age or older": ("Yes, I am", None),
    }
    assert memory["years of experience with intune"].question_text == (
        "Years of experience with Intune?"
    )
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        [note] = [e for e in run.events if e["kind"] == "learned"]
        assert "learned 2 answers" in note["text"]
        assert "From Claude" in note["text"]
        # The page keeps the list as words too.
        [tools] = [
            a for a in run.pages[0]["answers"] if a["q"].startswith("Which scripting")
        ]
        assert tools["a"] == "PowerShell, Bash"


@pytest.mark.asyncio
async def test_nothing_is_learned_when_the_user_asks_for_fixes(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.ready_for_review(rid, PAGE, "Review", ROUND_ONE)
    await _decide(maker, user, run_id, "fix", note="Change the travel answer")
    assert await _memory(maker, user) == {}


@pytest.mark.asyncio
async def test_pressing_submit_yourself_counts_as_approval(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.ready_for_review(
        rid,
        PAGE,
        "Review",
        [
            {"q": "Are you able to lift 25 lbs?", "a": "Yes", "claude": True},
            {"q": "Can you work nights?", "a": "Yes", "guess": True},
            {"q": "Can you work holidays?", "a": "Yes", "claude": True, "guess": True},
        ],
    )
    await _decide(maker, user, run_id, "self")
    memory = await _memory(maker, user)
    assert set(memory) == {"are you able to lift 25 lbs"}  # never a guess
    assert memory["are you able to lift 25 lbs"].source == "claude"


def test_answers_changed_or_questioned_are_never_learned():
    """Spec 030's fix shape: the question is `box_on_page`. Changed (`to`) or
    questioned (`ask`) at the review, or while Claude filled: never learned."""
    fixes = [
        {
            "page": 1,
            "box_on_page": "Willing to travel?",
            "now_on_page": "Yes",
            "to": "No",
        },
        {
            "page": 1,
            "box_on_page": "Years with Jamf?",
            "now_on_page": "3",
            "ask": "Sure?",
        },
    ]
    changed = apply_learn.note_changes({"changed": ["older one"]}, fixes)
    assert changed == ["older one", "willing to travel", "years with jamf"]
    run = ApplyRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        review={"changed": changed, "fixes": fixes},
        messages=[
            {
                "by": "you",
                "text": "Change it to “Days”.",
                "fix": {"box_on_page": "Preferred shift times", "to": "Days"},
            },
            {"by": "you", "text": "Hello"},
        ],
        pages=[
            {
                "answers": [
                    {"q": "Willing to travel?", "a": "No", "claude": True},
                    {"q": "Years with Jamf?", "a": "3", "claude": True},
                    {"q": "Preferred shift times", "a": "Days", "claude": True},
                    {"q": "Can you work weekends?", "a": "Yes", "claude": True},
                ]
            }
        ],
    )
    assert apply_learn.candidates(run) == [("Can you work weekends?", "Yes")]
    # Fixes from before spec 030 (`q`) still count.
    assert apply_learn.changed_questions({"fixes": [{"q": "Old box?", "to": "x"}]}) == {
        "old box"
    }


def test_an_answer_that_changed_between_rounds_is_never_learned():
    run = ApplyRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        review={"changed": []},
        pages=[
            {
                "answers": [
                    {"q": "Preferred work setting", "a": "Remote", "claude": True}
                ]
            },
            {
                "answers": [
                    {"q": "Preferred work setting", "a": "Hybrid", "claude": True}
                ]
            },
            {"answers": [{"q": "Can you work weekends?", "a": "Yes", "claude": True}]},
        ],
    )
    assert apply_learn.candidates(run) == [("Can you work weekends?", "Yes")]


def test_questions_naming_the_company_are_never_learned():
    run = ApplyRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        review={},
        pages=[
            {
                "answers": [
                    {
                        "q": "Do you use Kelso Labs products?",
                        "a": "Yes",
                        "claude": True,
                    },
                    {"q": "Do you use Jira daily?", "a": "Yes", "claude": True},
                ]
            }
        ],
    )
    assert apply_learn.candidates(run, "Kelso Labs") == [
        ("Do you use Jira daily?", "Yes")
    ]


def test_answers_read_as_the_box_shows_them():
    assert apply_learn.answer_text(["A", "B"]) == "A, B"
    assert apply_learn.answer_text("['Python', 'SQL']") == "Python, SQL"
    assert apply_learn.answer_text("[not a list") == "[not a list"
    assert apply_learn.answer_text("Yes") == "Yes"


def test_the_key_is_job_catchers_own():
    # extension/src/autofill/classify/answers.js normalizeQuestion
    assert apply_learn.normalize("Are you 18+ (Required)?*") == "are you 18"
    assert apply_learn.normalize("  Years of   React? ") == "years of react"


@pytest.mark.asyncio
async def test_the_app_shows_where_an_answer_came_from(client, db_session, test_user):
    db_session.add(
        CustomAnswer(
            user_id=test_user.id,
            question_key="can you work weekends",
            question_text="Can you work weekends?",
            answer="Yes",
            source="claude",
        )
    )
    await db_session.commit()
    got = (await client.get("/v1/users/me/custom-answers")).json()
    assert got[0]["source"] == "claude"
    # An edit makes it the user's own.
    edited = {**got[0], "answer": "Yes, Saturdays"}
    out = (
        await client.put("/v1/users/me/custom-answers", json={"answers": [edited]})
    ).json()
    assert out[0]["source"] is None and out[0]["answer"] == "Yes, Saturdays"


@pytest.mark.asyncio
async def test_a_deleted_answer_is_remembered_as_forgotten(
    client, db_session, test_user
):
    key = "can you work weekends"
    body = {
        "answers": [
            {"question_key": key, "question_text": "Weekends?", "answer": "Yes"}
        ]
    }
    await client.put("/v1/users/me/custom-answers", json=body)
    await client.delete(f"/v1/users/me/custom-answers/{key}")
    await db_session.refresh(test_user)
    assert test_user.forgotten_answers == [key]
    # Saving it again yourself makes it yours again.
    await client.put("/v1/users/me/custom-answers", json=body)
    await db_session.refresh(test_user)
    assert test_user.forgotten_answers == []


def test_migration_round_trip_and_postgres_sql(tmp_path):
    import sqlite3

    from tests.test_migration_email_sync import _alembic, _ok

    prev, head = "x2a3b4c5d6e8", "y3c5e7a9b1d2"
    db = tmp_path / "live.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE custom_answers (user_id CHAR(32), question_key VARCHAR(255),"
        " question_text VARCHAR(500), answer TEXT);"
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY, email VARCHAR(255));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{prev}');"
    )
    con.commit()
    con.close()
    _ok(_alembic(db, "upgrade", head))
    con = sqlite3.connect(db)
    assert "source" in [r[1] for r in con.execute("PRAGMA table_info(custom_answers)")]
    assert "forgotten_answers" in [
        r[1] for r in con.execute("PRAGMA table_info(users)")
    ]
    con.close()
    _ok(_alembic(db, "downgrade", prev))

    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{prev}:{head}", "--sql", url=url)).stdout
    assert "ADD COLUMN source VARCHAR(20)" in up
    assert "ADD COLUMN forgotten_answers JSON" in up


def test_playbook_keeps_claude_in_one_tab():
    from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text

    text = playbook_text()
    assert "Stay in ONE tab" in text
    assert 'target="_blank"' in text and "`href`" in text
    assert "Job Catcher learns" in text
    assert APPLY_PLAYBOOK_VERSION >= "2026.11.29"


def test_a_fill_with_no_fresh_report_is_said_plainly():
    """Spec 029 review: Job Catcher never hands back an earlier step's boxes;
    without a fresh reading it says so, and Claude is told what to do."""
    out = svc.fill_result({"status": "failed", "reason": "no_report"})
    assert out["filled"] is None
    assert "no fresh reading" in out["job_catcher"]
