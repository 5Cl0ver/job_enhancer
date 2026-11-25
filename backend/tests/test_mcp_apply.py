"""Apply with Claude, end to end through the connector tools (spec 022).

Job Catcher is played by ``_job_catcher``: it stands in for the tool's wait,
claiming the request and sending photos/results the way the extension does,
then lets the real wait read them.
"""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyPhoto, ApplyRun, ProfileFact
from app.models.pipeline_stage import PipelineStage
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.services import apply_runs as svc
from tests.test_mcp_server import _connected_user

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200

RESUME = """# Sam Rivera
Portland, OR · sam@example.com

## SUMMARY
IT systems engineer who keeps 300 laptops and the network running.

## SKILLS
**Endpoints:** Intune, Windows 11, macOS
**Network:** Meraki, VLANs

## WORK EXPERIENCE
**Logical Position** | *IT Systems Engineer* | Sep 2024 – Present
- Moved 200 laptops to Intune with zero lost data.
- Ran the help desk for 180 people.

## EDUCATION
**Portland Community College** | *AAS, Computer Information Systems* | 2019 – 2021
"""


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


async def _setup(engine, monkeypatch):
    maker = await _connected_user(engine, monkeypatch)
    job = await mcp_mod.save_job(
        title="IT Systems Engineer",
        company="Acme",
        apply_url="https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123/apply",
        description="We need Intune, Okta and Jamf experience. " * 20,
    )
    async with maker() as db:
        user = await db.scalar(select(User).where(User.email == "claude@test.dev"))
        db.add(
            Resume(
                user_id=user.id,
                filename="me.pdf",
                mime_type="application/pdf",
                file_size_bytes=3,
                extracted_text="Sam Rivera. Intune, Windows. Logical Position.",
                is_active=True,
                parsed_history={"work": [{"title": "IT Systems Engineer"}]},
            )
        )
        run = await svc.create_run(db, user, uuid.UUID(job["job_id"]))
        await db.commit()
        return maker, user, run.id, uuid.UUID(job["job_id"])


def _job_catcher(monkeypatch, maker, user_id, *, photos=2, answers=None, ok=True):
    """Job Catcher answers the next request the way the extension does."""
    real = svc.wait_request
    seen = []

    async def acting(db, req_id, seconds=None):
        async with maker() as jc:
            state = await svc.extension_state(jc, user_id)
            assert [r["id"] for r in state["requests"]] == [str(req_id)]
            req = await svc.claim(jc, user_id, req_id)
            seen.append(req.kind)
            if req.kind == "photo":
                for part in range(photos):
                    await svc.add_photo(jc, user_id, req_id, part, JPEG)
            await svc.finish_request(
                jc,
                user_id,
                req_id,
                {
                    "ok": ok,
                    "filled": ["First name", "Email"],
                    "need": ["Why Acme?"],
                    "answers": answers or [{"q": "First name", "a": "Sam"}],
                },
            )
            await jc.commit()
        return await real(db, req_id, seconds)

    monkeypatch.setattr(svc, "wait_request", acting)
    return seen


async def _run(maker, run_id) -> ApplyRun:
    async with maker() as db:
        return await db.get(ApplyRun, run_id)


@pytest.mark.asyncio
async def test_the_whole_application(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)

    brief = await mcp_mod.get_apply_brief()
    assert brief["run_id"] == rid
    assert brief["step"] == "reading"
    assert brief["job"]["company"] == "Acme"
    assert "Never press a final Submit" in brief["playbook"]
    assert "okta" in [s.lower() for s in brief["listing_skills_not_shown"]]
    assert "intune" not in [s.lower() for s in brief["listing_skills_not_shown"]]

    asked = await mcp_mod.ask_questions(
        rid, [{"question": "Have you used Okta?", "why": "Okta experience"}]
    )
    assert asked["asked"] == 1
    waiting = await mcp_mod.wait_for_you(rid)
    assert waiting["ready"] is False

    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        qid = run.questions[0]["id"]
        await svc.record_answers(
            db,
            run,
            [{"id": qid, "answer": "Yes, SSO for 40 apps"}],
            done=True,
            source="app",
        )
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["ready"] is True
    assert got["answers"] == [
        {"question": "Have you used Okta?", "answer": "Yes, SSO for 40 apps"}
    ]

    saved = await mcp_mod.save_resume(rid, RESUME)
    async with maker() as db:
        sj = await db.get(SavedJob, job_id)
        resume = await db.get(Resume, uuid.UUID(saved["resume_id"]))
        assert sj.resume_id == resume.id
        assert resume.file_data.startswith(b"%PDF")
        assert resume.document_id is not None and not resume.is_active
        assert resume.parsed_history == {"work": [{"title": "IT Systems Engineer"}]}
        fact = await db.scalar(select(ProfileFact))
        assert (fact.question, fact.answer) == (
            "Have you used Okta?",
            "Yes, SSO for 40 apps",
        )
        # The user looks the résumé over first (spec 025) and says use it.
        run = await svc.get_run(db, user.id, run_id, lock=True)
        assert run.status == "resume_review"
        await svc.resume_decide(db, run, "use", None, by="app")
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert (got["ready"], got["decision"]) == (True, "use")

    seen = _job_catcher(monkeypatch, maker, user.id)
    filled = await mcp_mod.fill_page(rid, "https://acme.wd1.myworkdayjobs.com/apply/1")
    assert filled["filled"] == ["First name", "Email"]
    assert filled["still_needs_an_answer"] == ["Why Acme?"]

    page = await mcp_mod.page_done(
        rid,
        "https://acme.wd1.myworkdayjobs.com/apply/1",
        "My Information",
        [{"q": "First name", "a": "Sam"}, {"q": "Password", "a": "hunter2"}],
    )
    assert page["page"] == 1 and page["photos"] == 2 and page["photo"] == "taken"
    run = await _run(maker, run_id)
    # Never a password; Job Catcher's boxes are marked (spec 026).
    assert run.pages[0]["answers"] == [
        {"q": "First name", "a": "Sam", "by": "job_catcher"}
    ]
    assert len(run.pages[0]["photo_ids"]) == 2

    review = await mcp_mod.ready_for_review(
        rid, "https://acme.wd1.myworkdayjobs.com/apply/2", "Review", []
    )
    assert review["page"] == 2
    assert seen == ["fill", "photo", "photo"]
    run = await _run(maker, run_id)
    assert run.status == "review" and run.review["round"] == 1

    with pytest.raises(ValueError, match="hasn't said submit"):
        await mcp_mod.finish_apply(rid, sent=True)
    async with maker() as db:
        assert (await svc.extension_state(db, user.id))["guard"] is True

    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "submit", None, by="app")
        await db.commit()
        assert (await svc.extension_state(db, user.id))["guard"] is False
    go = await mcp_mod.wait_for_you(rid)
    assert go["decision"] == "submit"

    # The confirmation's photo is taken while the run is still open.
    done = await mcp_mod.finish_apply(
        rid, sent=True, page_url="https://acme.wd1/thanks"
    )
    assert done["status"] == "sent"
    run = await _run(maker, run_id)
    assert run.pages[-1]["title"] == "Confirmation"
    assert run.pages[-1]["photo"] == "taken" and len(run.pages[-1]["photo_ids"]) == 2
    assert seen[-1] == "photo"
    async with maker() as db:
        sj = await db.get(SavedJob, job_id)
        stage = await db.get(PipelineStage, sj.pipeline_stage_id)
        assert stage.name == "Applied" and sj.applied_at is not None


@pytest.mark.asyncio
async def test_a_fix_goes_round_again(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    with pytest.raises(ValueError, match="user_words"):
        await mcp_mod.user_said(rid, decision="fix", note="Start date is January")
    said = await mcp_mod.user_said(
        rid,
        decision="fix",
        note="Start date is January",
        user_words="fix the start date, it is January",
    )
    assert said["decision"] == "fix" and said["note"] == "Start date is January"
    run = await _run(maker, run_id)
    assert run.status == "filling"
    assert run.events[-1]["text"] == (
        "You told Claude in the chat: “fix the start date, it is January”. "
        "You asked for a fix: Start date is January"
    )
    await mcp_mod.page_done(rid, "https://acme.example/apply/3", "Fixed page", [])
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    run = await _run(maker, run_id)
    assert run.review["round"] == 2 and run.review["decision"] is None
    assert [(p["title"], p["round"]) for p in run.pages] == [
        ("Review", 1),
        ("Fixed page", 2),
        ("Review", 2),
    ]


@pytest.mark.asyncio
async def test_submit_myself_ends_when_job_catcher_sees_it(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.extension_event(
            db, user.id, run_id, "blocked_submit", "https://acme.example/x"
        )
        await svc.decide(db, run, "self", None, by="app")
        await db.commit()
    out = await mcp_mod.wait_for_you(rid)
    assert out["decision"] == "self"
    async with maker() as db:
        await svc.extension_event(
            db, user.id, run_id, "submit_pressed", "https://acme.example/x"
        )
        await db.commit()
    # Pressed is not yet sent: Job Catcher looks for the confirmation.
    run = await _run(maker, run_id)
    assert run.status == "review" and run.review["pressed_at"]
    async with maker() as db:
        await svc.extension_event(
            db,
            user.id,
            run_id,
            "confirmation_seen",
            "https://acme.example/thanks",
            "Thank you for applying!",
        )
        await db.commit()
    run = await _run(maker, run_id)
    assert run.status == "sent"
    assert run.review["confirmed"]["words"] == "Thank you for applying!"
    assert run.events[-1]["text"] == (
        "Sent, confirmed. Job Catcher saw: “Thank you for applying!”."
    )
    assert any(e["kind"] == "blocked_submit" for e in run.events)


@pytest.mark.asyncio
async def test_no_job_catcher_never_blocks_the_run(engine, monkeypatch):
    maker, _, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    filled = await mcp_mod.fill_page(rid, "https://acme.example/apply/1")
    assert (
        filled["filled"] is None
        and "Job Catcher didn't answer" in filled["job_catcher"]
    )
    page = await mcp_mod.page_done(rid, "https://acme.example/apply/1", "One", [])
    assert page["photo"].startswith("missing")
    run = await _run(maker, run_id)
    assert run.pages[0]["photo"] == "missing"


@pytest.mark.asyncio
async def test_help_and_keep_going(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    await mcp_mod.fill_page(rid, "https://acme.example/apply/1")  # now filling
    out = await mcp_mod.need_help(rid, "sign_in", "Sign in to Workday.")
    assert "Sign in to Workday." in out["tell_user"]
    assert (await mcp_mod.wait_for_you(rid))["ready"] is False
    async with maker() as db:
        await svc.help_done(db, user.id, run_id)
        await db.commit()
    assert (await mcp_mod.wait_for_you(rid))["ready"] is True
    assert (await _run(maker, run_id)).status == "filling"


@pytest.mark.asyncio
async def test_rules_the_connector_enforces(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    with pytest.raises(ValueError, match="hasn't started|isn't"):
        await mcp_mod.ask_questions(rid, [])
    await mcp_mod.get_apply_brief(rid)
    with pytest.raises(ValueError, match="at most 12"):
        await mcp_mod.ask_questions(rid, [{"question": f"Q{i}?"} for i in range(13)])
    with pytest.raises(ValueError, match="# Full Name"):
        await mcp_mod.save_resume(rid, "## SUMMARY\n" + "x " * 300 + "\n## SKILLS\nx")
    with pytest.raises(ValueError, match="too short"):
        await mcp_mod.save_resume(rid, "# Sam\n## A\n## B")
    with pytest.raises(ValueError, match="full address"):
        await mcp_mod.page_done(rid, "acme/apply", "x", [])
    async with maker() as db:
        with pytest.raises(svc.RunBusy):
            await svc.create_run(db, user, job_id)


@pytest.mark.asyncio
async def test_a_run_left_alone_for_3_hours_stops(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        run.last_activity_at = svc._now() - timedelta(hours=4)
        await db.commit()
        assert await svc.open_run(db, user.id) is None
        await db.commit()
        assert (await db.get(ApplyRun, run_id)).status == "stopped"
        assert (await svc.create_run(db, user, job_id)).id != run_id


@pytest.mark.asyncio
async def test_photos_are_checked(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    async with maker() as db:
        run, page, req = await svc.page_done(
            db, user, rid, "https://acme.example/a", "A", []
        )
        await db.commit()
        with pytest.raises(ValueError, match="isn't taking photos"):
            await svc.add_photo(db, user.id, req.id, 0, JPEG)  # not claimed yet
        await svc.claim(db, user.id, req.id)
        with pytest.raises(ValueError, match="Already taken"):
            await svc.claim(db, user.id, req.id)
        with pytest.raises(ValueError, match="JPEG"):
            await svc.add_photo(db, user.id, req.id, 0, b"\x89PNG....")
        with pytest.raises(ValueError, match="400 KB"):
            await svc.add_photo(db, user.id, req.id, 0, JPEG + b"\x00" * 400_000)
        with pytest.raises(ValueError, match="At most 8"):
            await svc.add_photo(db, user.id, req.id, 8, JPEG)
        await svc.add_photo(db, user.id, req.id, 0, JPEG)
        await svc.add_photo(db, user.id, req.id, 0, JPEG)  # a retake replaces it
        await db.commit()
        assert len((await db.scalars(select(ApplyPhoto))).all()) == 1
        with pytest.raises(LookupError):
            await svc.claim(db, uuid.uuid4(), req.id)  # someone else's


@pytest.mark.asyncio
async def test_old_photos_are_deleted(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        db.add(
            ApplyPhoto(
                run_id=run_id, user_id=user.id, page_n=1, part=0, data=JPEG, size=4
            )
        )
        run.status, run.finished_at = "sent", svc._now() - timedelta(days=31)
        await db.commit()
        await svc.create_run(db, user, job_id)
        await db.commit()
        assert (await db.scalars(select(ApplyPhoto))).all() == []
