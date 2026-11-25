"""Apply from the app (spec 023): answer Claude, talk to it, see the screen,
know when it stopped, be sure it was sent, know Job Catcher is ready."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

import app.mcp_server as mcp_mod
from app.models.apply import ApplyPhoto, ApplyRequest, ApplyRun
from app.models.extension import ExtensionInstall
from app.models.job_listing import JobListing, unescape
from app.services import apply_runs as svc
from tests.test_mcp_apply import JPEG, _job_catcher, _run, _setup


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch):
    monkeypatch.setattr(svc, "WAIT_SECONDS", 0.05)
    monkeypatch.setattr(svc, "POLL_SECONDS", 0.01)


async def _filling(engine, monkeypatch):
    maker, user, run_id, job_id = await _setup(engine, monkeypatch)
    rid = str(run_id)
    await mcp_mod.get_apply_brief(rid)
    await mcp_mod.fill_page(rid, "https://acme.example/apply/1")  # → filling
    return maker, user, run_id, rid


@pytest.mark.asyncio
async def test_answer_claude_from_the_app(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    out = await mcp_mod.need_help(
        rid,
        "question",
        "Can CFS reach out by SMS?",
        choices=["Yes", "No", "Yes"],
        page_url="https://acme.example/apply/1",
    )
    assert "answer in the Job Enhancer app" in out["tell_user"]
    run = await _run(maker, run_id)
    assert run.help["choices"] == ["Yes", "No"]
    async with maker() as db:
        peeks = (
            await db.scalars(select(ApplyRequest).where(ApplyRequest.kind == "peek"))
        ).all()
        assert [p.url for p in peeks] == ["https://acme.example/apply/1"]
    assert (await mcp_mod.wait_for_you(rid))["ready"] is False

    async with maker() as db:
        await svc.help_done(db, user.id, run_id, "No")
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["ready"] is True and got["reply"] == "No"
    run = await _run(maker, run_id)
    assert run.status == "filling"
    assert run.events[-1]["text"] == "You answered: No"

    with pytest.raises(ValueError, match="at most 4"):
        await mcp_mod.need_help(rid, "question", "x?", choices=list("abcde"))


@pytest.mark.asyncio
async def test_talk_to_claude_any_time(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    async with maker() as db:
        await svc.post_message(db, user.id, run_id, "Use my Gmail address")
        await db.commit()
    out = await mcp_mod.message_user(rid, "Page 1 of 3 done")
    assert out["from_user"] == [
        {"text": "Use my Gmail address", "at": out["from_user"][0]["at"]}
    ]
    again = await mcp_mod.message_user(rid, "Switched to Gmail")
    assert "from_user" not in again  # delivered once
    run = await _run(maker, run_id)
    assert [(m["by"], m["text"], m["read"]) for m in run.messages] == [
        ("you", "Use my Gmail address", True),
        ("claude", "Page 1 of 3 done", True),
        ("claude", "Switched to Gmail", True),
    ]


@pytest.mark.asyncio
async def test_a_message_wakes_a_waiting_claude(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    monkeypatch.setattr(svc, "WAIT_SECONDS", 5)
    async with maker() as db:
        await svc.post_message(db, user.id, run_id, "Check the start date first")
        await db.commit()
    out = await mcp_mod.wait_for_you(rid)
    assert out["ready"] is False
    assert out["from_user"][0]["text"] == "Check the start date first"


@pytest.mark.asyncio
async def test_see_the_screen_now(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    async with maker() as db:
        # A pending fill is never cancelled by a screen-now photo.
        run = await svc.get_run(db, user.id, run_id, lock=True)
        fill = await svc._request(db, run, "fill", "https://acme.example/apply/2", 2)
        req = await svc.peek(db, user.id, run_id)
        await db.commit()
        with pytest.raises(ValueError, match="already on its way"):
            await svc.peek(db, user.id, run_id)
        assert (await db.get(ApplyRequest, fill.id)).status == "pending"
        assert req.url.startswith("https://acme.example/apply/") and req.page_n == 0
        await svc.claim(db, user.id, req.id)
        with pytest.raises(ValueError, match="one photo"):
            await svc.add_photo(db, user.id, req.id, 1, JPEG)
        await svc.add_photo(db, user.id, req.id, 0, JPEG)
        await svc.finish_request(db, user.id, req.id, {"ok": True})
        await db.commit()
        for _ in range(6):  # only the newest 5 are kept
            r = await svc.peek(db, user.id, run_id)
            await svc.claim(db, user.id, r.id)
            await svc.add_photo(db, user.id, r.id, 0, JPEG)
            await svc.finish_request(db, user.id, r.id, {"ok": True})
            await db.commit()
        run = await svc.get_run(db, user.id, run_id)
        view = await svc.view(db, run)
        assert len(view["peeks"]) == 5
        n = len(
            (await db.scalars(select(ApplyPhoto).where(ApplyPhoto.page_n == 0))).all()
        )
        assert n == 5


@pytest.mark.asyncio
async def test_the_app_knows_when_claude_stopped(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert svc.claude_stopped(run) is False
        old = svc._now() - timedelta(minutes=4)
        run.claude_at, run.last_activity_at = old, old
        assert svc.claude_stopped(run) is True
        # The user's turn (a question open) is never "stopped".
        run.status, run.help = "needs_you", {"what": "x", "done_at": None}
        assert svc.claude_stopped(run) is False
        run.help = {"what": "x", "done_at": "now"}
        assert svc.claude_stopped(run) is True


@pytest.mark.asyncio
async def test_did_it_go_through(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "submit", None, by="app")
        await db.commit()
    await mcp_mod.wait_for_you(rid)  # → submitting
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert svc.ask_if_sent(run) is False
        run.last_activity_at = svc._now() - timedelta(minutes=3)
        assert svc.ask_if_sent(run) is True
        await db.commit()
        # "It wasn't sent" while Claude was pressing it: Claude fixes and
        # presses once more (the user's OK is that answer).
        run = await svc.not_sent(db, user.id, run_id)
        await db.commit()
        assert run.status == "submitting" and run.review["retry"] is True
        # From the review ("I'll submit it myself"), back to the review.
        run.status = "review"
        run.review = {**run.review, "decision": "self"}
        await db.commit()
        run = await svc.not_sent(db, user.id, run_id)
        await db.commit()
        assert run.status == "review" and run.review["decision"] is None
        # A confirmation with no OK from the user never ends the run.
        await svc.extension_event(
            db, user.id, run_id, "confirmation_seen", None, "Thanks"
        )
        await db.commit()
        assert (await db.get(ApplyRun, run_id)).status == "review"


@pytest.mark.asyncio
async def test_job_catcher_readiness(engine, monkeypatch):
    maker, user, run_id, _ = await _setup(engine, monkeypatch)
    async with maker() as db:
        assert (await svc.job_catcher_status(db, user.id))["ready"] is False
        db.add(ExtensionInstall(user_id=user.id, install_id="a", version="0.40.0"))
        await db.commit()
        status = await svc.job_catcher_status(db, user.id)
        assert status["version"] == "0.40.0" and status["ready"] is False
        db.add(
            ExtensionInstall(
                user_id=user.id,
                install_id="b",
                version="0.41.0",
                last_seen_at=svc._now() + timedelta(seconds=1),
            )
        )
        await db.commit()
        assert (await svc.job_catcher_status(db, user.id))["ready"] is True
        run = await svc.get_run(db, user.id, run_id)
        assert (await svc.view(db, run))["job_catcher"]["version"] == "0.41.0"


def test_titles_never_keep_html_entities():
    assert unescape("Microsoft 365 &amp; Copilot Administrator") == (
        "Microsoft 365 & Copilot Administrator"
    )
    assert unescape("Ben &amp;amp; Jerry&#39;s") == "Ben & Jerry's"
    assert unescape("AT&T") == "AT&T"
    listing = JobListing(
        title="AI &amp; Automation", company="H&amp;M", location="A&nbsp;B"
    )
    assert (listing.title, listing.company, listing.location) == (
        "AI & Automation",
        "H&M",
        "A B",
    )


@pytest.mark.asyncio
async def test_routes(client, db_session, test_user):
    from tests.api.test_apply_api import _started

    _, run_id = await _started(client, db_session, test_user)
    r = await client.post(
        f"/v1/apply/runs/{run_id}/messages", json={"text": "Hi Claude"}
    )
    assert r.status_code == 200 and r.json()["messages"][-1]["text"] == "Hi Claude"
    assert (
        await client.post(f"/v1/apply/runs/{run_id}/messages", json={"text": ""})
    ).status_code == 422
    assert (await client.post(f"/v1/apply/runs/{run_id}/peek")).status_code == 202
    assert (await client.post(f"/v1/apply/runs/{run_id}/peek")).status_code == 409
    await svc.need_help(db_session, test_user, run_id, "question", "Pay?", ["$120k"])
    await db_session.commit()
    r = await client.post(f"/v1/apply/runs/{run_id}/help-done", json={"reply": "$120k"})
    assert r.json()["help"]["reply"] == "$120k"
    assert (await client.post(f"/v1/apply/runs/{run_id}/not-sent")).status_code == 400
    other = uuid.uuid4()
    assert (
        await client.post(f"/v1/apply/runs/{other}/messages", json={"text": "x"})
    ).status_code == 404


async def _pressed(engine, monkeypatch):
    """Claude pressed Submit after the user's OK; no confirmation yet."""
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "submit", None, by="app")
        await db.commit()
    await mcp_mod.wait_for_you(rid)  # → submitting
    async with maker() as db:
        await svc.extension_event(
            db, user.id, run_id, "submit_pressed", "https://acme.example/apply/9"
        )
        await db.commit()
    return maker, user, run_id, rid


@pytest.mark.asyncio
async def test_never_press_submit_twice(engine, monkeypatch):
    maker, user, run_id, rid = await _pressed(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        run.claude_at = svc._now() - timedelta(minutes=10)
        await db.commit()
        assert svc.claude_stopped(run) is False  # the user is asked instead
        assert (await svc.extension_state(db, user.id))["guard"] is True
    brief = await mcp_mod.get_apply_brief(rid)  # a new chat
    assert "ALREADY pressed" in brief["next"]
    assert "ALREADY pressed" in (await mcp_mod.wait_for_you(rid))["next"]


@pytest.mark.asyncio
async def test_a_stuck_screen_photo_never_blocks_the_next(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    async with maker() as db:
        stuck = await svc.peek(db, user.id, run_id)
        await db.commit()
        stuck.created_at = svc._now() - timedelta(minutes=1)
        await db.commit()
        fresh = await svc.peek(db, user.id, run_id)
        await db.commit()
        assert (await db.get(ApplyRequest, stuck.id)).status == "failed"
    # need_help asks for this page's screen, replacing an older one waiting.
    await mcp_mod.need_help(
        rid, "question", "Pay?", page_url="https://acme.example/apply/2"
    )
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        assert run.help["peek_request"] != str(fresh.id)
        assert (await db.get(ApplyRequest, fresh.id)).status == "failed"
        newest = await db.get(ApplyRequest, uuid.UUID(run.help["peek_request"]))
        assert newest.url == "https://acme.example/apply/2"


@pytest.mark.asyncio
async def test_fills_and_page_photos_still_replace_each_other(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        fill = await svc._request(db, run, "fill", "https://acme.example/apply/2", 2)
        await svc._request(db, run, "photo", "https://acme.example/apply/2", 2)
        await db.commit()
        assert (await db.get(ApplyRequest, fill.id)).status == "failed"


@pytest.mark.asyncio
async def test_messages_dont_hide_that_claude_stopped(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        run.claude_at = svc._now() - timedelta(minutes=5)
        run.events = []
        await db.commit()
        await svc.post_message(db, user.id, run_id, "are you there?")
        await db.commit()
        assert svc.claude_stopped(await db.get(ApplyRun, run_id)) is True


@pytest.mark.asyncio
async def test_the_reply_reaches_claude_once(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    await mcp_mod.need_help(rid, "question", "SMS?", choices=["Yes", "No"])
    async with maker() as db:
        await svc.help_done(db, user.id, run_id, "No")
        await db.commit()
    got = await mcp_mod.wait_for_you(rid)
    assert got["reply"] == "No" and "from_user" not in got


@pytest.mark.asyncio
async def test_confirmations_count_only_on_the_run_s_sites(engine, monkeypatch):
    maker, user, run_id, rid = await _pressed(engine, monkeypatch)
    async with maker() as db:
        await svc.extension_event(
            db,
            user.id,
            run_id,
            "confirmation_seen",
            "https://news.example/",
            "Thanks for applying",
        )
        await db.commit()
        assert (await db.get(ApplyRun, run_id)).status == "submitting"
    # A CAPTCHA right after Submit, then the thank-you page: still confirmed.
    await mcp_mod.need_help(rid, "captcha", "Solve the robot check.")
    async with maker() as db:
        await svc.extension_event(
            db,
            user.id,
            run_id,
            "confirmation_seen",
            "https://acme.example/thanks",
            "Thanks for applying",
        )
        await db.commit()
        assert (await db.get(ApplyRun, run_id)).status == "sent"


@pytest.mark.asyncio
async def test_a_pressed_run_waits_a_day_for_the_user(engine, monkeypatch):
    maker, user, run_id, rid = await _pressed(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        run.last_activity_at = svc._now() - timedelta(hours=5)
        await db.commit()
        assert await svc.open_run(db, user.id) is not None
        run = await db.get(ApplyRun, run_id)
        run.last_activity_at = svc._now() - timedelta(hours=25)
        await db.commit()
        assert await svc.open_run(db, user.id) is None
        await db.commit()
        run = await db.get(ApplyRun, run_id)
        assert run.status == "stopped" and "never confirmed" in run.note


@pytest.mark.asyncio
async def test_an_odd_job_catcher_version_is_never_ready(engine, monkeypatch):
    maker, user, _, _ = await _setup(engine, monkeypatch)
    async with maker() as db:
        db.add(ExtensionInstall(user_id=user.id, install_id="x", version="dev"))
        await db.commit()
        assert (await svc.job_catcher_status(db, user.id))["ready"] is False


@pytest.mark.asyncio
async def test_a_site_error_after_submit_is_fixed_with_the_users_ok(
    engine, monkeypatch
):
    maker, user, run_id, rid = await _pressed(engine, monkeypatch)
    # Claude waits for the user's answer, never presses again on its own.
    out = await mcp_mod.wait_for_you(rid)
    assert out["ready"] is False and "ALREADY pressed" in out["next"]
    async with maker() as db:
        await svc.not_sent(db, user.id, run_id)
        await db.commit()
        assert (await svc.extension_state(db, user.id))["guard"] is False
    out = await mcp_mod.wait_for_you(rid)
    assert out["ready"] is True and "press the final Submit once more" in out["next"]
    run = await _run(maker, run_id)
    assert svc._claudes_turn(run) is True


@pytest.mark.asyncio
async def test_no_confirmation_counts_before_a_press(engine, monkeypatch):
    maker, user, run_id, rid = await _filling(engine, monkeypatch)
    _job_catcher(monkeypatch, maker, user.id, photos=1)
    await mcp_mod.ready_for_review(rid, "https://acme.example/apply/9", "Review", [])
    async with maker() as db:
        run = await svc.get_run(db, user.id, run_id, lock=True)
        await svc.decide(db, run, "submit", None, by="app")
        await db.commit()
    await mcp_mod.wait_for_you(rid)  # → submitting, nothing pressed yet
    async with maker() as db:
        # "Once your application has been submitted…" on the review page
        await svc.extension_event(
            db,
            user.id,
            run_id,
            "confirmation_seen",
            "https://acme.example/apply/9",
            "application has been submitted",
        )
        await db.commit()
        run = await db.get(ApplyRun, run_id)
        assert run.status == "submitting"
        assert (await svc.extension_state(db, user.id))["watch"] is False
        await svc.extension_event(
            db, user.id, run_id, "submit_pressed", "https://acme.example/apply/9"
        )
        await db.commit()
        assert (await svc.extension_state(db, user.id))["watch"] is True


@pytest.mark.asyncio
async def test_the_banner_knows_to_ask_and_stopped_stays_quiet(engine, monkeypatch):
    maker, user, run_id, rid = await _pressed(engine, monkeypatch)
    async with maker() as db:
        run = await db.get(ApplyRun, run_id)
        run.review = {
            **run.review,
            "pressed_at": svc._iso(svc._now() - timedelta(minutes=1)),
        }
        run.claude_at = svc._now() - timedelta(minutes=10)
        await db.commit()
        short = await svc.view(db, run, full=False)
        assert short["ask_if_sent"] is True and short["claude_stopped"] is False
