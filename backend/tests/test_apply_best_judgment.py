"""Apply with best judgment (spec 026, server side): the run's own résumé for
Job Catcher, what happened to the résumé in plain words, the live view, guess
and agreement marks, plain photo reasons, and fixes from the answer bubbles."""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyRun
from app.models.extension import ExtensionInstall
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.services import apply_runs as svc
from app.services.apply_playbook import playbook_text
from tests.test_mcp_apply import JPEG, RESUME, _run, _setup
from tests.test_migration_email_sync import _alembic, _ok

PAGE = "https://acme.wd1.myworkdayjobs.com/apply/1"
REAL_WAIT = svc.wait_request  # patched again per request below


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


def _job_catcher(monkeypatch, maker, user_id, payload, *, photos=1):
    """Job Catcher answers the next request with ``payload``."""
    real = REAL_WAIT

    async def acting(db, req_id, seconds=None):
        async with maker() as jc:
            req = await svc.claim(jc, user_id, req_id)
            if req.kind == "photo":
                for part in range(photos):
                    await svc.add_photo(jc, user_id, req_id, part, JPEG)
            await svc.finish_request(jc, user_id, req_id, payload)
            await jc.commit()
        return await real(db, req_id, seconds)

    monkeypatch.setattr(svc, "wait_request", acting)


async def _filling(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        db_user = await db.get(type(user), user.id)
        db_user.review_resumes = False
        await db.commit()
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    saved = await mcp_mod.save_resume(rid, RESUME)
    return maker, user, run_id, job_id, rid, saved


@pytest.mark.asyncio
async def test_job_catcher_gets_the_runs_own_resume(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        state = await svc.extension_state(db, user.id)
        assert state["resume_id"] is None and state["live"] is False
        # The job's résumé while the run has none of its own…
        mine = await db.scalar(select(Resume).where(Resume.user_id == user.id))
        (await db.get(SavedJob, job_id)).resume_id = mine.id
        await db.commit()
        assert (await svc.extension_state(db, user.id))["resume_id"] == str(mine.id)
    # …and the one Claude made, once it's saved.
    async with maker() as db:
        (await db.get(type(user), user.id)).review_resumes = False
        await db.commit()
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    saved = await mcp_mod.save_resume(rid, RESUME)
    async with maker() as db:
        state = await svc.extension_state(db, user.id)
        assert state["resume_id"] == saved["resume_id"]
        assert state["live"] is True


@pytest.mark.asyncio
async def test_what_happened_to_the_resume_in_plain_words(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(
        monkeypatch,
        maker,
        user.id,
        {
            "ok": True,
            "filled": ["Resume", "First name"],
            "need": [],
            "resume": "failed",
        },
    )
    filled = await mcp_mod.fill_page(rid, PAGE)
    assert filled["resume"] == "failed"
    assert "need_help(kind='file'" in filled["resume_note"]

    _job_catcher(
        monkeypatch,
        maker,
        user.id,
        {"ok": True, "filled": ["Resume"], "need": [], "resume": "attached"},
    )
    filled = await mcp_mod.fill_page(rid, PAGE)
    assert filled["resume"] == "attached"
    assert "Don't attach it again" in filled["resume_note"]

    # The page remembers it, and Job Catcher's boxes are marked.
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.page_done(
        rid,
        PAGE,
        "My Experience",
        [
            {"q": "Resume", "a": "Sam_Acme.pdf"},
            {"q": "How did you hear about us?", "a": "LinkedIn", "guess": True},
            {"q": "I certify this is true", "a": "Yes", "agreement": True},
            {"q": "Why Acme?", "a": "…", "claude": True, "guess": "yes"},
            {"q": "Card number", "a": "4111"},
        ],
    )
    run = await _run(maker, run_id)
    page = run.pages[0]
    assert page["resume"] == "attached"
    assert page["answers"] == [
        {"q": "Resume", "a": "Sam_Acme.pdf", "by": "job_catcher"},
        {"q": "How did you hear about us?", "a": "LinkedIn", "guess": True},
        {"q": "I certify this is true", "a": "Yes", "agreement": True},
        {"q": "Why Acme?", "a": "…", "claude": True},
    ]

    # A file Claude couldn't get attached: the app offers the résumé to download.
    await mcp_mod.need_help(rid, "file", "Attach your résumé on the My Experience page")
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert run.help["kind"] == "file"
        view = await svc.view(db, run)
        assert view["resume_file"] == {
            "id": saved["resume_id"],
            "filename": saved["file_name"],
        }


@pytest.mark.asyncio
async def test_photo_reasons_in_plain_words(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(
        monkeypatch, maker, user.id, {"ok": False, "reason": "locked"}, photos=0
    )
    out = await mcp_mod.page_done(rid, PAGE, "Page", [{"q": "A", "a": "b"}])
    assert (
        out["photo"]
        == "missing: The computer was locked, so no photo (the answers are kept)"
    )
    run = await _run(maker, run_id)
    assert run.pages[0]["reason"].startswith("The computer was locked")


@pytest.mark.asyncio
async def test_the_live_view(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    boxes = [
        {"q": "First name", "a": "Sam", "by": "job_catcher"},
        {"q": "Password", "a": "hunter2"},
        {"q": "CVV", "a": "123"},
        {"q": "Why Acme?", "a": "x" * 500, "by": "someone"},
        "junk",
    ] + [{"q": f"Box {i}", "a": ""} for i in range(200)]
    async with maker() as db:
        with pytest.raises(ValueError, match="isn't part of this application"):
            await svc.save_live(db, user.id, run_id, {"url": "https://evil.example/x"})
        await svc.save_live(
            db,
            user.id,
            run_id,
            {
                "url": "https://www.acme.wd1.myworkdayjobs.com/apply/2",
                "title": "Info",
                "boxes": boxes,
            },
        )
        await db.commit()
        run = await db.get(ApplyRun, run_id)
        live = (await svc.view(db, run))["live"]
    assert live["title"] == "Info"
    assert live["boxes"][0] == {"q": "First name", "a": "Sam", "by": "job_catcher"}
    assert live["boxes"][1] == {"q": "Why Acme?", "a": "x" * 300}
    assert all(b["q"] not in ("Password", "CVV") for b in live["boxes"])
    assert len(live["boxes"]) <= svc.MAX_LIVE_BOXES

    # Ready for review: the live view is gone, and Job Catcher is told so.
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.ready_for_review(rid, PAGE, "Review", [{"q": "A", "a": "b"}])
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert run.live is None
        with pytest.raises(svc.NotFilling):
            await svc.save_live(db, user.id, run_id, {"url": PAGE})


@pytest.mark.asyncio
async def test_fixes_from_the_bubbles(engine, monkeypatch):
    maker, user, run_id, job_id, rid, saved = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, {"ok": True, "answers": []})
    await mcp_mod.ready_for_review(rid, PAGE, "Review", [{"q": "Prefix", "a": "Mr."}])
    fixes = [
        {"page": 1, "q": "Prefix", "a": "Mr.", "to": "None"},
        {"page": 1, "q": "Salary", "a": "$90,000", "ask": "Is that too low?"},
        {"q": "Nothing to do", "a": "x"},
        {"q": "Password", "a": "x", "to": "y"},
    ]
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "fix", None, by="app", fixes=fixes)
        await db.commit()
        assert run.review["note"] == (
            "Change page 1, “Prefix” to “None”. About page 1, “Salary”: Is that too low?"
        )
    got = await mcp_mod.wait_for_you(rid)
    assert got["decision"] == "fix"
    assert got["fixes"] == [
        {"q": "Prefix", "a": "Mr.", "page": 1, "to": "None"},
        {"q": "Salary", "a": "$90,000", "page": 1, "ask": "Is that too low?"},
    ]
    assert "`ask` is the user's question" in got["next"]


@pytest.mark.asyncio
async def test_routes(client, db_session, test_user):
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
    live = f"/v1/apply/runs/{run_id}/live"
    page = {"url": "https://jobs.lever.co/acme/123/apply", "boxes": []}
    assert (await client.post(live, json=page)).status_code == 409  # not filling

    test_user.review_resumes = False
    await svc.brief(db_session, test_user, run_id)
    await svc.save_resume(db_session, test_user, run_id, RESUME)
    await db_session.commit()
    assert (await client.post(live, json=page)).status_code == 204
    bad = {**page, "url": "https://other.example/apply"}
    assert (await client.post(live, json=bad)).status_code == 400
    assert (await client.get(f"/v1/apply/runs/{run_id}")).json()["live"]["url"] == page[
        "url"
    ]

    await svc.page_done(
        db_session, test_user, run_id, page["url"], "Last", [], last=True
    )
    await db_session.commit()
    decide = f"/v1/apply/runs/{run_id}/decision"
    many = [{"q": f"Q{i}", "to": "x"} for i in range(31)]
    assert (
        await client.post(decide, json={"decision": "fix", "fixes": many})
    ).status_code == 422
    r = await client.post(
        decide,
        json={"decision": "fix", "fixes": [{"page": 1, "q": "Prefix", "to": "None"}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["review"]["fixes"] == [
        {"q": "Prefix", "a": "", "page": 1, "to": "None"}
    ]


@pytest.mark.asyncio
async def test_job_catcher_new_enough_for_the_live_view(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        install = ExtensionInstall(
            user_id=user.id,
            install_id=uuid.uuid4().hex,
            version="0.41.0",
            last_seen_at=datetime.now(tz=UTC),
        )
        db.add(install)
        await db.commit()
        status = await svc.job_catcher_status(db, user.id)
        assert status["ready"] is True and status["live"] is False
        install.version = "0.42.0"
        await db.commit()
        assert (await svc.job_catcher_status(db, user.id))["live"] is True


def test_playbook_best_judgment():
    text = playbook_text()
    assert "Never guess experience" in text
    assert "`guess: true`" in text and "`agreement: true`" in text
    assert "only stop for what you truly can't do or know" in text
    assert "Never guess facts about the user" in text
    # The old "ask about anything you can't fill" rule is gone.
    assert "If a page asks for something you can't truthfully fill" not in text


def test_migration_round_trip_and_postgres_sql(tmp_path):
    import sqlite3

    prev, head = "v0e1f2a3b4c6", "w1f2a3b4c5d7"
    db = tmp_path / "live.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE apply_runs (id CHAR(32) PRIMARY KEY, status VARCHAR(20));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{prev}');"
    )
    con.commit()
    con.close()
    _ok(_alembic(db, "upgrade", head))
    con = sqlite3.connect(db)
    cols = [r[1] for r in con.execute("PRAGMA table_info(apply_runs)")]
    assert "live" in cols
    con.close()
    _ok(_alembic(db, "downgrade", prev))

    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{prev}:{head}", "--sql", url=url)).stdout
    assert "ADD COLUMN live JSON" in up
