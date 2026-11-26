"""Apply with Claude: one checklist, problems report (spec 030). Claude's
questions come as one list with its best guesses; Claude notes what went wrong
for the developer. (Changing a box while Claude fills waits for a checkpoint
since spec 033: tests/test_apply_fix_at_end.py.)"""

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
                # Claude's guess, left as it was: used, never kept as told.
                {"id": ids[1], "answer": "LinkedIn", "guessed": True},
            ],
            done=True,
            source="app",
        )
        await db.commit()
    # The answers aren't Claude's yet: no new checklist over them (not now,
    # with what to do instead: spec 033).
    out = await mcp_mod.ask_questions(rid, [{"question": "One more?"}])
    assert out["ok"] is False and "answers are waiting for you" in out["not_now"]
    assert "wait_for_you" in out["next"]
    got = await mcp_mod.wait_for_you(rid)
    assert got["answers"] == [
        {"question": "Have you used Okta?", "answer": "A little"},
        {
            "question": "How did you hear about us?",
            "answer": "LinkedIn",
            "kept_your_guess": True,
        },
    ]
    assert "save_resume" in got["next"]
    async with maker() as db:
        facts = (await db.scalars(select(ProfileFact))).all()
        assert [f.answer for f in facts] == ["A little"]


@pytest.mark.asyncio
async def test_a_guess_the_user_changed_is_kept_and_a_fake_guess_isnt_trusted(
    engine, monkeypatch
):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    await mcp_mod.ask_questions(
        rid,
        [
            {"question": "Notice period?", "guess": "Two weeks"},
            {"question": "Start date?", "guess": "ASAP"},
        ],
    )
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        ids = [q["id"] for q in run.questions]
        await svc.record_answers(
            db,
            run,
            [
                {"id": ids[0], "answer": "One month"},
                # "guessed" but not Claude's guess: it's the user's answer.
                {"id": ids[1], "answer": "January", "guessed": True},
            ],
            done=True,
            source="app",
        )
        await db.commit()
        facts = (await db.scalars(select(ProfileFact))).all()
        assert sorted(f.answer for f in facts) == ["January", "One month"]


@pytest.mark.asyncio
async def test_no_filling_while_the_checklist_is_out(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    await mcp_mod.ask_questions(rid, [{"question": "Years of Go?", "only_you": True}])
    for out in (
        await mcp_mod.fill_page(rid, PAGE),
        await mcp_mod.page_done(rid, PAGE, "My Experience", []),
    ):
        assert out["ok"] is False and "Wait for the answers" in out["not_now"]
        assert "wait_for_you" in out["next"]
    run = await _run(maker, run_id)
    assert run.status == "questions" and len(run.questions) == 1


@pytest.mark.asyncio
async def test_asking_during_a_resume_change_goes_back_to_the_change(
    engine, monkeypatch
):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    await mcp_mod.save_resume(rid, RESUME)  # the user looks it over
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.resume_decide(db, run, "change", "Say more about Okta", by="app")
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["decision"] == "change"
    run = await _run(maker, run_id)
    assert run.status == "writing" and run.resume_id is not None

    await mcp_mod.ask_questions(rid, [{"question": "Where did you use Okta?"}])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        qid = run.questions[0]["id"]
        await svc.record_answers(
            db, run, [{"id": qid, "answer": "At Contoso"}], done=True, source="app"
        )
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    # Back to the change (and the user's look), never on to filling.
    assert (await _run(maker, run_id)).status == "writing"
    assert "Now change the résumé" in got["next"]
    assert "Say more about Okta" in got["next"]
    assert "save_resume" in got["next"]


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
    out = await mcp_mod.ask_questions(rid, [{"question": "Anything else?"}])
    assert out["ok"] is False and "waiting for the user" in out["not_now"]


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
# Problems Claude ran into
# --------------------------------------------------------------------------- #


def test_scrub_removes_secrets():
    s = problems_svc.scrub
    assert s("Login said password: hunter2 was wrong") == (
        "Login said password: [removed] was wrong"
    )
    assert s("Typed password hunter2 into it") == "Typed password [removed] into it"
    assert s("The PIN is 4821") == "The PIN is [removed]"
    assert s("Workday sent code 482913 by email") == (
        "Workday sent code [removed] by email"
    )
    assert s("OTP: 55 12 99 expired") == "OTP: [removed] expired"
    assert s("verification code was 1234") == "verification code was [removed]"
    assert "alex.rivera@example.com" not in s("Sent to alex.rivera@example.com")
    assert "555" not in s("Phone (503) 555-0142 was refused")
    assert "555" not in s("Phone +1 503-555-0142 was refused")
    assert "4111" not in s("Card 4111 1111 1111 1111 was typed")
    assert "123-45-6789" not in s("SSN 123-45-6789")
    blob = "aB3" * 12
    assert s(f"session {blob} expired") == "session [removed] expired"
    assert s(f"key {'0f' * 20}") == "key [removed]"
    # Plain words about the box, error codes, dates and job ids stay.
    assert s("Couldn't fill the password box") == "Couldn't fill the password box"
    assert s("Got status code 500 twice") == "Got status code 500 twice"
    assert s("On 2026-11-25 10:00 at step 3") == "On 2026-11-25 10:00 at step 3"
    assert s("Job R0012345 page") == "Job R0012345 page"
    assert len(s("x" * 900)) == problems_svc.MAX_CHARS


def test_page_keeps_job_slugs_but_not_queries():
    page = problems_svc.page_of
    assert page("https://acme.example/apply/2?token=abc#x") == (
        "https://acme.example/apply/2"
    )
    slug = "https://northwind.wd1.myworkdayjobs.com/en-US/careers/job/Senior-Software-Engineer_R0012345/apply"
    assert page(slug) == slug
    assert page(f"https://acme.example/s/{'aB3' * 12}/apply") == (
        "https://acme.example/s/[removed]/apply"
    )
    assert page("javascript:alert(1)") is None


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
    # Each report carries its context.
    first = run.problems[0]
    assert len(first["id"]) == 10 and first["status"] == "open"
    assert first["run_id"] == rid
    assert first["job"] == "IT Systems Engineer at Acme"
    assert first["site"] == "acme.wd1.myworkdayjobs.com"
    assert first["playbook"] == APPLY_PLAYBOOK_VERSION
    assert "job_catcher" in first  # the version, when Job Catcher was seen
    # No page given: the site is the job's apply link's.
    assert run.problems[1]["site"] == "acme.wd1.myworkdayjobs.com"
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
async def test_problems_reach_the_owners_inbox(admin_client, db_session, admin_user):
    """Spec 032: a run's problems are reports in Bugs & ideas too, linked to
    the run and the job; the run page still shows them as before."""
    r = await admin_client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/5",
            "title": "IT Engineer",
            "company": "Northwind Labs",
            "description": "Intune and Okta. " * 50,
        },
    )
    job_id = r.json()["id"]
    run_id = (
        await admin_client.post("/v1/apply/runs", json={"saved_job_id": job_id})
    ).json()["id"]
    await svc.brief(db_session, admin_user, run_id)
    out = await svc.report_problem(
        db_session, admin_user, run_id, "Lost the tab", PAGE, "tab"
    )
    assert "problem" not in out  # Claude's answer is as before
    await db_session.commit()
    inbox = (await admin_client.get("/v1/admin/bugs")).json()
    row = next(i for i in inbox["items"] if i["source"] == "run")
    assert (row["title"], row["section"], row["severity"], row["status"]) == (
        "Lost the tab",
        "apply",
        "major",
        "new",
    )
    report = (await admin_client.get(f"/v1/admin/bugs/{row['id']}")).json()
    assert report["run"] == {"id": run_id, "own": True}
    assert report["job"]["own"] is True
    assert report["job"]["id"] == job_id
    assert report["job"]["company"] == "Northwind Labs"
    assert report["place"] == "acme.wd1.myworkdayjobs.com/apply/:id"
    assert report["context"]["playbook"] == APPLY_PLAYBOOK_VERSION
    assert "admin@test.dev" not in str(report)  # never who hit it
    # The owner sees them on the application page, as before.
    run = (await admin_client.get(f"/v1/apply/runs/{run_id}")).json()
    assert run["problems"][0]["what"] == "Lost the tab"

    # A Job Catcher kind lands in Job Catcher; the same one again counts up.
    for _ in range(2):
        await svc.report_problem(
            db_session, admin_user, run_id, "Said no résumé box", PAGE, "resume"
        )
    await db_session.commit()
    jc = (await admin_client.get("/v1/admin/bugs?section=job_catcher")).json()
    assert [(i["title"], i["count"]) for i in jc["items"]] == [
        ("Said no résumé box", 2)
    ]


@pytest.mark.asyncio
async def test_report_problem_works_when_the_inbox_fails(engine, monkeypatch):
    """The inbox never costs Claude its call: the problem is still kept on
    the run, and Claude is told it was noted."""
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)

    async def broken(*_a, **_k):
        raise RuntimeError("inbox down")

    monkeypatch.setattr(svc.bug_reports, "from_run_problem", broken)
    out = await mcp_mod.report_problem(rid, "The tab closed", kind="tab")
    assert out["noted"] is True and "Carry on" in out["next"]
    run = await _run(maker, run_id)
    assert [p["what"] for p in run.problems] == ["The tab closed"]


@pytest.mark.asyncio
async def test_old_admin_routes_are_gone(admin_client):
    assert (await admin_client.get("/v1/admin/apply-problems")).status_code == 404


# --------------------------------------------------------------------------- #
# The playbook and the migration
# --------------------------------------------------------------------------- #


def test_playbook_checklist_fixes_and_problems():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION >= "2026.11.30"  # later specs bump it
    assert "all together" in text and "`only_you: true`" in text
    assert "`report_problem`" in text
    # Spec 033: changes wait for a checkpoint (tests in test_apply_fix_at_end).
    assert "fixes" in text
    assert "don't fill, `fill_page` or `page_done` until the answers come back" in text
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
