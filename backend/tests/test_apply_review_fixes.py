"""Apply with Claude: the cases the PR #46 review found (spec 022)."""

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

import app.mcp_server as mcp_mod
from app.models.apply import ApplyPhoto, ApplyRun, ProfileFact
from app.services import apply_runs as svc
from app.services import master_profile
from tests.test_mcp_apply import JPEG, _job_catcher, _run, _setup


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


async def _at_review(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    return maker, user, run_id, rid


async def _decide(maker, user, run_id, decision):
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, decision, None, by="app")
        await db.commit()


@pytest.mark.asyncio
async def test_claude_never_finishes_a_submit_myself_run(engine, monkeypatch):
    maker, user, run_id, rid = await _at_review(engine, monkeypatch)
    await _decide(maker, user, run_id, "self")
    assert (await mcp_mod.wait_for_you(rid))["decision"] == "self"
    with pytest.raises(ValueError, match="hasn't said submit"):
        await mcp_mod.finish_apply(rid, sent=True)


@pytest.mark.asyncio
async def test_the_users_own_press_after_submit_ends_it(engine, monkeypatch):
    maker, user, run_id, rid = await _at_review(engine, monkeypatch)
    await _decide(maker, user, run_id, "submit")
    async with maker() as db:
        await svc.extension_event(
            db, user.id, run_id, "submit_pressed", "https://acme.example/9"
        )
        await svc.extension_event(
            db, user.id, run_id, "confirmation_seen", "https://acme.example/9", "Done"
        )
        await db.commit()
    assert (await _run(maker, run_id)).status == "sent"
    with pytest.raises(ValueError, match="has ended"):
        await mcp_mod.wait_for_you(rid)


@pytest.mark.asyncio
async def test_a_chat_decision_keeps_the_users_words(engine, monkeypatch):
    maker, _, run_id, rid = await _at_review(engine, monkeypatch)
    await mcp_mod.user_said(rid, decision="submit", user_words="looks good, submit")
    run = await _run(maker, run_id)
    assert run.review["words"] == "looks good, submit" and run.review["by"] == "chat"


@pytest.mark.asyncio
async def test_a_taken_back_answer_is_forgotten(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    await mcp_mod.ask_questions(rid, [{"question": "Used Okta?"}])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        qid = run.questions[0]["id"]
        await svc.record_answers(
            db, run, [{"id": qid, "answer": "Yes"}], done=False, source="app"
        )
        await db.commit()
        assert len((await db.scalars(select(ProfileFact))).all()) == 1
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.record_answers(
            db, run, [{"id": qid, "skipped": True}], done=False, source="app"
        )
        await db.commit()
        assert (await db.scalars(select(ProfileFact))).all() == []


@pytest.mark.asyncio
async def test_help_twice_goes_back_to_the_review(engine, monkeypatch):
    maker, user, run_id, rid = await _at_review(engine, monkeypatch)
    await mcp_mod.need_help(rid, "site", "The page logged you out.")
    await mcp_mod.need_help(rid, "sign_in", "Sign in again.")
    async with maker() as db:
        await svc.help_done(db, user.id, run_id)
        await db.commit()
    await mcp_mod.wait_for_you(rid)
    assert (await _run(maker, run_id)).status == "review"


@pytest.mark.asyncio
async def test_no_resume_save_while_waiting_for_the_user(engine, monkeypatch):
    _, _, _, rid = await _at_review(engine, monkeypatch)
    # Not now, and what to do instead: never an error that ends Claude's
    # turn (spec 033).
    out = await mcp_mod.save_resume(rid, "# x")
    assert out["ok"] is False and "waiting for the user" in out["not_now"]
    assert "wait_for_you" in out["next"]


@pytest.mark.asyncio
async def test_the_newest_facts_reach_claude(engine, monkeypatch):
    maker, user, _, _ = await _setup(engine, monkeypatch)
    async with maker() as db:
        for i in range(3):
            db.add(
                ProfileFact(
                    user_id=user.id,
                    question=f"Q{i}",
                    answer="A",
                    created_at=svc._now() + timedelta(seconds=i),
                )
            )
        await db.commit()
        got = await master_profile.facts(db, user.id, limit=2)
        assert [f.question for f in got] == ["Q1", "Q2"]
        assert len(await master_profile.facts(db, user.id, limit=None)) == 3


@pytest.mark.asyncio
async def test_the_sweep_stops_idle_runs_and_deletes_old_photos(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    async with maker() as db:
        db.add(
            ApplyPhoto(
                run_id=run_id, user_id=user.id, page_n=1, part=0, data=JPEG, size=4
            )
        )
        run = await db.get(ApplyRun, run_id)
        run.last_activity_at = svc._now() - timedelta(hours=4)
        await db.commit()
    await svc.sweep_job(maker)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert run.status == "stopped" and run.finished_at is not None
        assert len((await db.scalars(select(ApplyPhoto))).all()) == 1  # not yet
        run.finished_at = svc._now() - timedelta(days=31)
        await db.commit()
    await svc.sweep_job(maker)
    async with maker() as db:
        assert (await db.scalars(select(ApplyPhoto))).all() == []


@pytest.mark.asyncio
async def test_the_database_holds_one_open_run(engine, monkeypatch):
    maker, user, _, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        db.add(
            ApplyRun(
                user_id=user.id,
                saved_job_id=job_id,
                status="filling",
                questions=[],
                pages=[],
                events=[],
                apply_hosts=[],
                playbook_version="x",
            )
        )
        with pytest.raises(IntegrityError):
            await db.flush()


@pytest.mark.asyncio
async def test_a_reanswer_after_deleting_the_fact_keeps_it_again(engine, monkeypatch):
    from sqlalchemy import delete

    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    await mcp_mod.ask_questions(rid, [{"question": "Used Okta?"}])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        qid = run.questions[0]["id"]
        await svc.record_answers(
            db, run, [{"id": qid, "answer": "Yes"}], done=False, source="app"
        )
        await db.commit()
        await db.execute(delete(ProfileFact))  # deleted in Settings
        await db.commit()
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.record_answers(
            db, run, [{"id": qid, "answer": "Yes, SSO"}], done=False, source="app"
        )
        await db.commit()
        facts = (await db.scalars(select(ProfileFact))).all()
        assert [f.answer for f in facts] == ["Yes, SSO"]
