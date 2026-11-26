"""Résumés you can see, shape and talk over (spec 025, part B): pick a résumé
before starting, and look Claude's résumé over before it's used."""

import uuid

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services import apply_runs as svc
from app.services.apply_playbook import playbook_text
from app.services.users import create_user
from tests.test_mcp_apply import RESUME, _run, _setup
from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "u9d0e1f2a3b5", "v0e1f2a3b4c6"


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


async def _written(engine, monkeypatch):
    """A run where Claude just saved the job's résumé."""
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    saved = await mcp_mod.save_resume(rid, RESUME)
    return maker, user, run_id, rid, saved


@pytest.mark.asyncio
async def test_claude_waits_for_your_look_at_the_resume(engine, monkeypatch):
    maker, user, run_id, rid, saved = await _written(engine, monkeypatch)
    assert "ready to look over" in saved["tell_user"]
    run = await _run(maker, run_id)
    assert run.status == "resume_review"
    assert run.resume_check["round"] == 1

    # Not on to the application until the user says so.
    out = await mcp_mod.fill_page(rid, "https://acme.example/apply/1")
    assert out["ok"] is False and "looking over the résumé" in out["not_now"]
    assert "wait_for_you" in out["next"]
    assert (await mcp_mod.wait_for_you(rid))["ready"] is False

    # Change something: Claude gets the note and rewrites.
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        with pytest.raises(ValueError, match="what to change"):
            await svc.resume_decide(db, run, "change", " ", by="app")
        await svc.resume_decide(db, run, "change", "Lead with Intune", by="app")
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert (got["decision"], got["note"]) == ("change", "Lead with Intune")
    assert (await _run(maker, run_id)).status == "writing"

    again = await mcp_mod.save_resume(rid, RESUME.replace("IT systems", "Intune"))
    assert again["resume_id"] == saved["resume_id"]  # the same résumé, replaced
    run = await _run(maker, run_id)
    assert (run.status, run.resume_check["round"]) == ("resume_review", 2)
    assert run.resume_check["decision"] is None

    # Told in the chat: the user's own words are needed and kept.
    with pytest.raises(ValueError, match="user_words"):
        await mcp_mod.user_said(rid, decision="use")
    out = await mcp_mod.user_said(rid, decision="use", user_words="looks good, use it")
    assert out["decision"] == "use"
    run = await _run(maker, run_id)
    assert run.status == "filling"
    assert run.resume_check["words"] == "looks good, use it"
    assert "looks good, use it" in run.events[-1]["text"]

    filled = await mcp_mod.fill_page(rid, "https://acme.example/apply/1")
    assert filled["run_id"] == rid


@pytest.mark.asyncio
async def test_a_change_is_looked_at_again_even_after_turning_it_off(
    engine, monkeypatch
):
    maker, user, run_id, rid, saved = await _written(engine, monkeypatch)
    async with maker() as db:
        (await db.get(User, user.id)).review_resumes = False  # "Don't ask me next time"
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.resume_decide(db, run, "change", "Shorter summary", by="app")
        await db.commit()
    await mcp_mod.wait_for_you(rid)
    await mcp_mod.save_resume(rid, RESUME)
    assert (await _run(maker, run_id)).status == "resume_review"


@pytest.mark.asyncio
async def test_review_turned_off_goes_straight_on(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        (await db.get(User, user.id)).review_resumes = False
        await db.commit()
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    saved = await mcp_mod.save_resume(rid, RESUME)
    assert "saved on the job" in saved["tell_user"]
    assert (await _run(maker, run_id)).status == "filling"


@pytest.mark.asyncio
async def test_a_picked_resume_skips_questions_writing_and_the_look(
    engine, monkeypatch
):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.stop_run(db, user.id, run_id)
        mine = await db.scalar(select(Resume).where(Resume.user_id == user.id))
        run = await svc.create_run(db, user, job_id, mine.id)
        await db.commit()
        picked_id, rid = mine.id, str(run.id)
        assert run.resume_picked and run.resume_id == picked_id
        assert run.events[-1]["text"] == "You picked your résumé (me.pdf)."
        sj = await db.get(SavedJob, job_id)
        assert (sj.resume_id, sj.resume_usual) == (picked_id, False)

    brief = await mcp_mod.get_apply_brief(rid)
    assert brief["resume_picked"] is True
    assert "picked their résumé" in brief["next"]
    filled = await mcp_mod.fill_page(rid, "https://acme.example/apply/1")
    assert filled["run_id"] == rid
    # A résumé saved anyway (the user asked in the chat) isn't held for a look,
    # and never writes over the résumé the user picked.
    async with maker() as db:
        before = await db.get(Resume, picked_id)
        kept = (before.file_data, before.extracted_text, before.document_id)
    saved = await mcp_mod.save_resume(rid, RESUME)
    assert saved["resume_id"] != str(picked_id)
    async with maker() as db:
        run = await svc.get_run(db, user.id, uuid.UUID(rid))
        assert run.status == "filling"
        assert str(run.resume_id) == saved["resume_id"] and not run.resume_picked
        mine = await db.get(Resume, picked_id)
        assert (mine.file_data, mine.extracted_text, mine.document_id) == kept
        assert str((await db.get(SavedJob, job_id)).resume_id) == saved["resume_id"]


@pytest.mark.asyncio
async def test_someone_elses_resume_cant_be_picked(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        other = await create_user(db, email="other@test.dev", name="Other")
        theirs = Resume(
            user_id=other.id,
            filename="theirs.pdf",
            mime_type="application/pdf",
            file_size_bytes=3,
        )
        db.add(theirs)
        await svc.stop_run(db, user.id, run_id)
        await db.flush()
        with pytest.raises(LookupError):
            await svc.create_run(db, user, job_id, theirs.id)


@pytest.mark.asyncio
async def test_routes_pick_and_decide(client, db_session, test_user):
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/123",
            "title": "IT Engineer",
            "company": "Acme",
            "description": "Intune and Okta. " * 50,
        },
    )
    job_id = r.json()["id"]
    mine = Resume(
        user_id=test_user.id,
        filename="mine.pdf",
        mime_type="application/pdf",
        file_size_bytes=3,
    )
    db_session.add(mine)
    await db_session.commit()

    missing = await client.post(
        "/v1/apply/runs", json={"saved_job_id": job_id, "resume_id": str(uuid.uuid4())}
    )
    assert missing.status_code == 404
    r = await client.post(
        "/v1/apply/runs", json={"saved_job_id": job_id, "resume_id": str(mine.id)}
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["resume_picked"] is True and body["resume_id"] == str(mine.id)
    # Nothing to decide on a picked résumé.
    bad = await client.post(
        f"/v1/apply/runs/{body['id']}/resume-decision", json={"decision": "use"}
    )
    assert bad.status_code == 400

    # The setting, from the app.
    r = await client.patch("/v1/users/me", json={"review_resumes": False})
    assert r.status_code == 200 and r.json()["review_resumes"] is False


@pytest.mark.asyncio
async def test_resume_decision_route(client, db_session, test_user):
    r = await client.post(
        "/v1/saved-jobs/manual",
        json={
            "url": "https://jobs.lever.co/acme/123",
            "title": "IT Engineer",
            "company": "Acme",
            "description": "Intune and Okta. " * 50,
        },
    )
    run_id = (
        await client.post("/v1/apply/runs", json={"saved_job_id": r.json()["id"]})
    ).json()["id"]
    await svc.brief(db_session, test_user, run_id)
    await svc.save_resume(db_session, test_user, run_id, RESUME)
    await db_session.commit()

    url = f"/v1/apply/runs/{run_id}/resume-decision"
    assert (await client.post(url, json={"decision": "change"})).status_code == 400
    assert (await client.post(url, json={"decision": "submit"})).status_code == 422
    r = await client.post(url, json={"decision": "change", "note": "Shorter summary"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "resume_review"
    assert body["resume_check"]["decision"] == "change"
    assert body["resume_check"]["note"] == "Shorter summary"


def test_playbook_resume_rules():
    text = playbook_text()
    assert "2 pages at most" in text
    assert "resume_picked: true" in text
    assert "Never drop an employer" in text
    assert "> Job-aimed title line" in text
    assert 'No "Core areas" boxes' in text


def test_migration_round_trip(tmp_path):
    import sqlite3

    db = tmp_path / "resume_review.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY, email VARCHAR(255));"
        "CREATE TABLE apply_runs (id CHAR(32) PRIMARY KEY, user_id CHAR(32),"
        " status VARCHAR(20));"
        "CREATE UNIQUE INDEX uq_apply_runs_one_open ON apply_runs (user_id)"
        " WHERE status IN ('waiting', 'reading', 'questions', 'writing',"
        " 'filling', 'needs_you', 'review', 'submitting');"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        "INSERT INTO users VALUES ('" + "a" * 32 + "', 'a@test.dev');"
        "INSERT INTO apply_runs VALUES ('" + "b" * 32 + "', '" + "a" * 32 + "',"
        " 'resume_review');"
    )
    con.commit()
    con.close()
    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    assert con.execute("SELECT review_resumes FROM users").fetchone() == (1,)
    assert con.execute("SELECT resume_picked FROM apply_runs").fetchone() == (0,)
    # A second open run (in the new status) is refused.
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(
            "INSERT INTO apply_runs (id, user_id, status, resume_picked) VALUES"
            " ('" + "c" * 32 + "', '" + "a" * 32 + "', 'filling', 0)"
        )
    con.close()
    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    assert con.execute("SELECT status FROM apply_runs").fetchone() == ("stopped",)
    con.close()


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "review_resumes BOOLEAN DEFAULT true NOT NULL" in up
    assert "'resume_review'" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP COLUMN review_resumes" in down
