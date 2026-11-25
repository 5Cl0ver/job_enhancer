"""Apply with Claude: one checklist, edit while it fills, problems report
(spec 030). Claude's questions come as one list with its best guesses; the
user changes a box while Claude fills; Claude notes what went wrong for the
developer."""

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRun, ProfileFact
from app.services import apply_problems as problems_svc
from app.services import apply_runs as svc
from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text
from tests.test_apply_best_judgment import _filling, _job_catcher
from tests.test_mcp_apply import RESUME, _run, _setup
from tests.test_migration_email_sync import _alembic, _ok

PAGE = "https://acme.wd1.myworkdayjobs.com/apply/1"


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


# --------------------------------------------------------------------------- #
# One checklist
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_checklist_with_best_guesses(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    asked = await mcp_mod.ask_questions(
        rid,
        [
            {
                "question": "Have you used Okta?",
                "why": "Okta experience",
                "choices": ["Yes", "No", "A little", "Yes"],
                "only_you": True,
            },
            {
                "question": "How did you hear about us?",
                "guess": "LinkedIn",
                "choices": ["LinkedIn", "Company site"],
            },
            {"question": "Your password?", "guess": "x"},  # never asked
        ],
    )
    assert asked["asked"] == 2
    assert "Looks good, go" in asked["tell_user"]
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        shown = (await svc.view(db, run))["questions"]
    assert [
        (q["question"], q["guess"], q["choices"], q["only_you"]) for q in shown
    ] == [
        ("Have you used Okta?", None, ["Yes", "No", "A little"], True),
        ("How did you hear about us?", "LinkedIn", ["LinkedIn", "Company site"], False),
    ]
    assert {q["batch"] for q in shown} == {1}

    with pytest.raises(ValueError, match="at most 4 quick answers"):
        await mcp_mod.ask_questions(
            rid, [{"question": "Pick one", "choices": ["a", "b", "c", "d", "e"]}]
        )
    with pytest.raises(ValueError, match="No new questions"):
        await mcp_mod.ask_questions(rid, [{"question": "Have you used Okta?"}])

    # The user checks the list and presses Looks good, go.
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        ids = [q["id"] for q in run.questions]
        await svc.record_answers(
            db,
            run,
            [
                {"id": ids[0], "answer": "A little"},
                {"id": ids[1], "answer": "LinkedIn"},
            ],
            done=True,
            source="app",
        )
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["answers"] == [
        {"question": "Have you used Okta?", "answer": "A little"},
        {"question": "How did you hear about us?", "answer": "LinkedIn"},
    ]
    assert "save_resume" in got["next"]
    async with maker() as db:
        facts = (await db.scalars(select(ProfileFact))).all()
        assert {f.answer for f in facts} == {"A little", "LinkedIn"}


@pytest.mark.asyncio
async def test_questions_while_filling_go_back_to_filling(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    assert (await _run(maker, run_id)).status == "filling"
    await mcp_mod.ask_questions(
        rid,
        [
            {
                "question": "Years of Python?",
                "only_you": True,
                "choices": ["1", "2", "3+"],
            },
            {
                "question": "Willing to relocate?",
                "guess": "No",
                "choices": ["Yes", "No"],
            },
        ],
    )
    run = await _run(maker, run_id)
    assert run.status == "questions"
    assert {q["batch"] for q in run.questions} == {1}
    # Its own step stays the application.
    assert svc._next(run).startswith("Call wait_for_you")
    with pytest.raises(ValueError, match="at most 12 questions at once"):
        await mcp_mod.ask_questions(rid, [{"question": f"Q{i}?"} for i in range(13)])

    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.record_answers(
            db,
            run,
            [
                {"id": run.questions[0]["id"], "answer": "3+"},
                {"id": run.questions[1]["id"], "skipped": True},
            ],
            done=True,
            source="app",
        )
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["answers"] == [{"question": "Years of Python?", "answer": "3+"}]
    assert got["skipped"] == ["Willing to relocate?"]
    assert "carry on filling" in got["next"]
    assert (await _run(maker, run_id)).status == "filling"

    # A second checklist is its own batch; the first one's answers stay.
    await mcp_mod.ask_questions(
        rid, [{"question": "Notice period?", "guess": "Two weeks"}]
    )
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        view = await svc.view(db, run)
    assert view["questions_open"] == 1
    assert [q["batch"] for q in view["questions"]] == [1, 1, 2]


@pytest.mark.asyncio
async def test_no_questions_while_waiting_for_the_user(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.ready_for_review(rid, PAGE, "Review", [{"q": "Prefix", "a": "Mr."}])
    with pytest.raises(ValueError, match="waiting for the user"):
        await mcp_mod.ask_questions(rid, [{"question": "Anything else?"}])


@pytest.mark.asyncio
async def test_answers_route_takes_a_whole_checklist(client, db_session, test_user):
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/9",
            "title": "IT Engineer",
            "company": "Northwind Labs",
            "description": "Intune and Okta. " * 50,
        },
    )
    run_id = (
        await client.post("/v1/apply/runs", json={"saved_job_id": r.json()["id"]})
    ).json()["id"]
    await svc.brief(db_session, test_user, run_id)
    await svc.ask_questions(
        db_session,
        test_user,
        run_id,
        [{"question": f"Q{i}?", "guess": "Yes"} for i in range(12)],
    )
    await db_session.commit()
    run = (await client.get(f"/v1/apply/runs/{run_id}")).json()
    assert run["questions"][0]["guess"] == "Yes"
    answers = [{"id": q["id"], "answer": "Yes"} for q in run["questions"]]
    r = await client.post(
        f"/v1/apply/runs/{run_id}/answers", json={"answers": answers, "done": True}
    )
    assert r.status_code == 200, r.text
    assert r.json()["answers_done"] is True


# --------------------------------------------------------------------------- #
# Edit while it fills
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_change_while_filling_reaches_claude(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    async with maker() as db:
        await svc.live_fix(
            db, user.id, run_id, {"q": "Prefix", "a": "Mr.", "to": "None"}
        )
        await svc.live_fix(
            db, user.id, run_id, {"q": "Salary", "a": "$90,000", "ask": "Too low?"}
        )
        with pytest.raises(ValueError, match="Say what to change"):
            await svc.live_fix(db, user.id, run_id, {"q": "Prefix", "a": "Mr."})
        with pytest.raises(ValueError, match="Say what to change"):
            await svc.live_fix(db, user.id, run_id, {"q": "Password", "to": "x"})
        await db.commit()
    run = await _run(maker, run_id)
    assert run.messages[-2]["text"] == "Change “Prefix” (now “Mr.”) to “None”."
    assert run.messages[-1]["fix"] == {"q": "Salary", "a": "$90,000", "ask": "Too low?"}

    # Claude gets them in its next tool result, with what to do.
    out = await mcp_mod.message_user(rid, "Filling page 1.")
    fixes = [m["fix"] for m in out["from_user"]]
    assert fixes == [
        {"q": "Prefix", "a": "Mr.", "to": "None"},
        {"q": "Salary", "a": "$90,000", "ask": "Too low?"},
    ]
    assert "put exactly `to` in that box now" in out["user_message_note"]
    again = await mcp_mod.message_user(rid, "Done.")
    assert "from_user" not in again


@pytest.mark.asyncio
async def test_live_fix_route(client, db_session, test_user):
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/7",
            "title": "IT Engineer",
            "company": "Northwind Labs",
            "description": "Intune and Okta. " * 50,
        },
    )
    run_id = (
        await client.post("/v1/apply/runs", json={"saved_job_id": r.json()["id"]})
    ).json()["id"]
    url = f"/v1/apply/runs/{run_id}/live-fix"
    fix = {"q": "Prefix", "a": "Mr.", "to": "None"}
    assert (await client.post(url, json=fix)).status_code == 400  # not filling

    test_user.review_resumes = False
    await svc.brief(db_session, test_user, run_id)
    await svc.save_resume(db_session, test_user, run_id, RESUME)
    await db_session.commit()
    r = await client.post(url, json=fix)
    assert r.status_code == 200, r.text
    assert r.json()["messages"][-1]["fix"] == fix
    assert (await client.post(url, json={"q": "", "to": "x"})).status_code == 422
    assert (
        await client.post(url, json={"q": "Prefix", "to": "x" * 2001})
    ).status_code == 422


# --------------------------------------------------------------------------- #
# Problems Claude ran into
# --------------------------------------------------------------------------- #


def test_scrub_removes_secrets():
    s = problems_svc.scrub
    assert s("Login said password: hunter2 was wrong") == (
        "Login said password: [removed] was wrong"
    )
    assert s("The PIN is 4821") == "The PIN is [removed]"
    assert "4111" not in s("Card 4111 1111 1111 1111 was typed")
    assert "123-45-6789" not in s("SSN 123-45-6789")
    assert "[removed]" in s("token abcDEF1234567890abcdef1234 in the url")
    assert s("Couldn't fill the password box") == "Couldn't fill the password box"
    assert len(s("x" * 900)) == problems_svc.MAX_CHARS
    assert problems_svc.page_of("https://acme.example/apply/2?token=abc#x") == (
        "https://acme.example/apply/2"
    )
    assert problems_svc.page_of("javascript:alert(1)") is None


@pytest.mark.asyncio
async def test_report_problem(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    out = await mcp_mod.report_problem(
        rid,
        "Job Catcher said no résumé box, but there is one",
        page_url=PAGE + "?session=abc",
        kind="job_catcher",
    )
    assert out["noted"] is True and "Carry on" in out["next"]
    await mcp_mod.report_problem(
        rid, "Job Catcher said no résumé box, but there is one", kind="job_catcher"
    )
    await mcp_mod.report_problem(rid, "The tab closed", kind="made-up")
    with pytest.raises(ValueError, match="Say what went wrong"):
        await mcp_mod.report_problem(rid, "   ")
    run = await _run(maker, run_id)
    assert [(p["kind"], p["count"], p["page"]) for p in run.problems] == [
        ("job_catcher", 2, PAGE),
        ("other", 1, None),
    ]
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert len((await svc.view(db, run))["problems"]) == 2

    for i in range(25):
        last = await mcp_mod.report_problem(
            rid, f"Box {i} wouldn't take text", kind="fill"
        )
    assert last["noted"] is False
    assert len((await _run(maker, run_id)).problems) == problems_svc.MAX_PROBLEMS


@pytest.mark.asyncio
async def test_admin_sees_everyones_problems(admin_client, db_session, admin_user):
    r = await admin_client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/5",
            "title": "IT Engineer",
            "company": "Northwind Labs",
            "description": "Intune and Okta. " * 50,
        },
    )
    run_id = (
        await admin_client.post("/v1/apply/runs", json={"saved_job_id": r.json()["id"]})
    ).json()["id"]
    await svc.brief(db_session, admin_user, run_id)
    await svc.report_problem(
        db_session, admin_user, run_id, "Lost the tab", PAGE, "tab"
    )
    await db_session.commit()
    rows = (await admin_client.get("/v1/admin/apply-problems")).json()
    assert len(rows) == 1
    row = rows[0]
    assert (row["what"], row["kind"], row["job"], row["user_email"]) == (
        "Lost the tab",
        "tab",
        "IT Engineer at Northwind Labs",
        "admin@test.dev",
    )
    assert row["run_id"] == run_id
    # The owner sees them on the application page.
    run = (await admin_client.get(f"/v1/apply/runs/{run_id}")).json()
    assert run["problems"][0]["what"] == "Lost the tab"


@pytest.mark.asyncio
async def test_only_the_admin_sees_the_list(client):
    assert (await client.get("/v1/admin/apply-problems")).status_code == 403


# --------------------------------------------------------------------------- #
# The playbook and the migration
# --------------------------------------------------------------------------- #


def test_playbook_checklist_fixes_and_problems():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION == "2026.11.30"
    assert "all together" in text and "`only_you: true`" in text
    assert "`report_problem`" in text
    assert "The user can change a box while you fill" in text
    assert "Never guess experience" in text
    # Blocking things stay single help items.
    assert "A CAPTCHA" in text and "need_help" in text


def test_migration_round_trip_and_postgres_sql(tmp_path):
    import sqlite3

    prev, head = "y3c5e7a9b1d2", "y3b4c5d6e7f9"
    db = tmp_path / "problems.db"
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
    assert con.execute("SELECT problems FROM apply_runs").fetchone() == ("[]",)
    con.close()
    _ok(_alembic(db, "downgrade", prev))
    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(apply_runs)")}
    con.close()
    assert "problems" not in cols

    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{prev}:{head}", "--sql", url=url)).stdout
    assert "ADD COLUMN problems JSON DEFAULT '[]' NOT NULL" in up
    down = _ok(_alembic(None, "downgrade", f"{head}:{prev}", "--sql", url=url)).stdout
    assert "DROP COLUMN problems" in down
