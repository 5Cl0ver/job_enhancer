"""Learning from Claude's runs (spec 029): what Claude filled that Job Catcher
couldn't becomes the user's autofill memory once the user approves the review,
marked "from Claude". Never self-ID, private details, agreements, essays,
salary or one company's questions, the user's own details, or anything the
user changed. Invented people and companies."""

import uuid

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRun
from app.models.custom_answer import CustomAnswer
from app.services import apply_learn
from app.services import apply_runs as svc
from tests.test_apply_best_judgment import PAGE, _filling, _job_catcher

ROUND_ONE = [
    {"q": "How did you hear about us?", "a": "LinkedIn", "guess": True},
    {"q": "Are you 18 years of age or older?", "a": "Yes", "claude": True},
    {"q": "Years of experience with Intune?", "a": "3", "claude": True},
    {"q": "Are you willing to travel up to 25%?", "a": "Yes", "guess": True},
    {"q": "Do you have a valid driver's license?", "a": "Yes", "claude": True},
    {"q": "Gender", "a": "Decline to answer", "guess": True},
    {"q": "Are you a protected veteran?", "a": "No", "guess": True},
    {"q": "I agree to the terms and conditions", "a": "Checked", "claude": True},
    {"q": "Do you accept the policy?", "a": "Yes", "agreement": True, "claude": True},
    {"q": "What is your desired salary?", "a": "$95,000", "claude": True},
    {"q": "Have you previously worked for Acme?", "a": "No", "guess": True},
    {"q": "Why do you want to work here?", "a": "I like it.", "claude": True},
    {"q": "Anything we should know", "a": "x" * 400, "claude": True},
    {"q": "Phone Extension", "a": "12", "claude": True},
    {"q": "Legal first name", "a": "Sam", "claude": True},
    {"q": "Preferred shift", "a": "Days"},  # Job Catcher's or the page's own
    {"q": "Security clearance level", "a": "None", "by": "job_catcher"},
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
        # The user's own answer is never replaced.
        db.add(
            CustomAnswer(
                user_id=user.id,
                question_key="are you 18 years of age or older",
                question_text="Are you 18 or older?",
                answer="Yes, I am",
            )
        )
        await db.commit()
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.page_done(rid, PAGE, "My Information", ROUND_ONE)
    await mcp_mod.ready_for_review(rid, PAGE + "/review", "Review", [])

    # The user changes a guess at the review: nothing is learned yet.
    fixes = [{"q": "Are you willing to travel up to 25%?", "a": "Yes", "to": "No"}]
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
        "how did you hear about us": ("LinkedIn", "claude"),
        "years of experience with intune": ("3", "claude"),
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


@pytest.mark.asyncio
async def test_nothing_is_learned_when_the_user_stops_or_asks_for_fixes(
    engine, monkeypatch
):
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
        [{"q": "Are you able to lift 25 lbs?", "a": "Yes", "guess": True}],
    )
    await _decide(maker, user, run_id, "self")
    memory = await _memory(maker, user)
    assert memory["are you able to lift 25 lbs"].source == "claude"


def test_an_answer_that_changed_between_rounds_is_never_learned():
    run = ApplyRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        review={"changed": []},
        pages=[
            {
                "answers": [
                    {"q": "Preferred work setting", "a": "Remote", "guess": True}
                ]
            },
            {
                "answers": [
                    {"q": "Preferred work setting", "a": "Hybrid", "guess": True}
                ]
            },
            {"answers": [{"q": "Can you work weekends?", "a": "Yes", "claude": True}]},
        ],
    )
    assert apply_learn.candidates(run) == [("Can you work weekends?", "Yes")]


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


def test_migration_round_trip_and_postgres_sql(tmp_path):
    import sqlite3

    from tests.test_migration_email_sync import _alembic, _ok

    prev, head = "x2a3b4c5d6e8", "y3c5e7a9b1d2"
    db = tmp_path / "live.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE custom_answers (user_id CHAR(32), question_key VARCHAR(255),"
        " question_text VARCHAR(500), answer TEXT);"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{prev}');"
    )
    con.commit()
    con.close()
    _ok(_alembic(db, "upgrade", head))
    con = sqlite3.connect(db)
    assert "source" in [r[1] for r in con.execute("PRAGMA table_info(custom_answers)")]
    con.close()
    _ok(_alembic(db, "downgrade", prev))

    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{prev}:{head}", "--sql", url=url)).stdout
    assert "ADD COLUMN source VARCHAR(20)" in up


def test_playbook_keeps_claude_in_one_tab():
    from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text

    text = playbook_text()
    assert "Stay in ONE tab" in text
    assert 'target="_blank"' in text and "`href`" in text
    assert "Job Catcher learns your everyday answers" in text
    assert APPLY_PLAYBOOK_VERSION >= "2026.11.29"
