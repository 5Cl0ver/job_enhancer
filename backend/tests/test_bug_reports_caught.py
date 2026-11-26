"""Bugs & ideas, part B (spec 032): screenshots, repeat suggestions, and the
errors the app catches itself (server errors, the app and Job Catcher, email
checks, Scout refusals, services going down), plus the versions. Invented
people and companies throughout."""

import logging
import struct
import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1 import bugs as bugs_api
from app.models.bug_report import BugReport, BugReportEvent
from app.services import admin_service
from app.services import bug_reports as svc
from app.services.admin_service import ServiceStatus

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
WEBP = b"RIFF" + struct.pack("<I", 200) + b"WEBP" + b"\x00" * 200


async def _post(admin_client, **body):
    r = await admin_client.post(
        "/v1/admin/bugs", json={"title": "A bug", "section": "app", **body}
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _caught(db) -> list[BugReport]:
    return list(
        (
            await db.scalars(
                select(BugReport)
                .where(BugReport.source == "caught")
                .order_by(BugReport.first_seen)
            )
        ).all()
    )


# --------------------------------------------------------------------------- #
# Screenshots
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_screenshots_jpeg_png_webp_up_to_three(admin_client):
    report = (await _post(admin_client))["report"]
    ids = []
    for data, mime in ((JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp")):
        r = await admin_client.post(
            f"/v1/admin/bugs/{report['id']}/shots",
            content=data,
            headers={"Content-Type": mime},
        )
        assert r.status_code == 201, r.text
        assert r.json()["size"] == len(data)
        ids.append(r.json()["id"])
    fourth = await admin_client.post(
        f"/v1/admin/bugs/{report['id']}/shots",
        content=JPEG,
        headers={"Content-Type": "image/jpeg"},
    )
    assert fourth.status_code == 409

    detail = (await admin_client.get(f"/v1/admin/bugs/{report['id']}")).json()
    assert [s["id"] for s in detail["shots"]] == ids
    listed = (await admin_client.get("/v1/admin/bugs")).json()["items"]
    assert listed[0]["has_shot"] is True

    got = await admin_client.get(f"/v1/admin/bugs/shots/{ids[1]}")
    assert got.status_code == 200
    assert got.content == PNG
    assert got.headers["content-type"] == "image/png"
    assert got.headers["cache-control"] == "private, no-store"

    gone = await admin_client.delete(f"/v1/admin/bugs/shots/{ids[0]}")
    assert gone.status_code == 204
    assert (await admin_client.get(f"/v1/admin/bugs/shots/{ids[0]}")).status_code == 404
    again = await admin_client.post(
        f"/v1/admin/bugs/{report['id']}/shots",
        content=JPEG,
        headers={"Content-Type": "image/jpeg"},
    )
    assert again.status_code == 201


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("data", "mime", "code"),
    [
        (b"GIF89a" + b"\x00" * 50, "image/gif", 415),  # not a type we take
        (b"<svg onload=alert(1)>", "image/png", 415),  # says PNG, isn't
        (PNG, "image/jpeg", 415),  # a real PNG sent as a JPEG
        (b"", "image/jpeg", 415),  # nothing at all
        (b"\xff\xd8\xff" + b"\x00" * 1_000_000, "image/jpeg", 413),  # over 1 MB
    ],
    ids=["gif", "svg-as-png", "png-as-jpeg", "empty", "too-big"],
)
async def test_screenshots_are_checked_by_their_bytes(admin_client, data, mime, code):
    report = (await _post(admin_client))["report"]
    r = await admin_client.post(
        f"/v1/admin/bugs/{report['id']}/shots",
        content=data,
        headers={"Content-Type": mime},
    )
    assert r.status_code == code, r.text
    detail = (await admin_client.get(f"/v1/admin/bugs/{report['id']}")).json()
    assert detail["shots"] == []


@pytest.mark.asyncio
async def test_a_screenshot_on_a_missing_report_is_404(admin_client):
    r = await admin_client.post(
        f"/v1/admin/bugs/{uuid.uuid4()}/shots",
        content=JPEG,
        headers={"Content-Type": "image/jpeg"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_screenshots_are_the_owners_only(client, db_session):
    report = await svc.create(db_session, {"title": "A bug", "section": "app"})
    shot = await svc.add_shot(db_session, report.id, "image/jpeg", JPEG)
    await db_session.commit()
    assert (await client.get(f"/v1/admin/bugs/shots/{shot.id}")).status_code == 403
    assert (await client.delete(f"/v1/admin/bugs/shots/{shot.id}")).status_code == 403
    r = await client.post(
        f"/v1/admin/bugs/{report.id}/shots",
        content=JPEG,
        headers={"Content-Type": "image/jpeg"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_signed_out_cant_see_a_screenshot(anon_client, db_session):
    report = await svc.create(db_session, {"title": "A bug", "section": "app"})
    shot = await svc.add_shot(db_session, report.id, "image/jpeg", JPEG)
    await db_session.commit()
    assert (await anon_client.get(f"/v1/admin/bugs/shots/{shot.id}")).status_code == 401


@pytest.mark.asyncio
async def test_a_merged_reports_screenshot_shows_on_the_one_it_went_into(
    admin_client,
):
    a = (await _post(admin_client, title="Save does nothing"))["report"]
    b = (await _post(admin_client, title="Save button dead"))["report"]
    shot = await admin_client.post(
        f"/v1/admin/bugs/{b['id']}/shots",
        content=JPEG,
        headers={"Content-Type": "image/jpeg"},
    )
    await admin_client.post(
        f"/v1/admin/bugs/{b['id']}/merge", json={"into_id": a["id"]}
    )
    detail = (await admin_client.get(f"/v1/admin/bugs/{a['id']}")).json()
    assert [s["id"] for s in detail["shots"]] == [shot.json()["id"]]
    listed = (await admin_client.get("/v1/admin/bugs")).json()["items"]
    assert [r["has_shot"] for r in listed] == [True]


# --------------------------------------------------------------------------- #
# Repeat suggestions
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_new_report_gets_close_open_reports_as_suggestions(admin_client):
    first = (
        await _post(admin_client, title="Phone put in Phone Extension", section="apply")
    )["report"]
    await _post(admin_client, title="Résumé didn't attach on Workday", section="apply")
    await _post(admin_client, title="Phone put in Phone Extension box", section="email")
    done = (
        await _post(admin_client, title="Phone in the phone extension", section="apply")
    )["report"]
    await admin_client.patch(f"/v1/admin/bugs/{done['id']}", json={"status": "fixed"})

    out = await _post(admin_client, title="Phone in extension box", section="apply")
    similar = out["similar"]
    # Same section, open, close title; not the other section, not a fixed one.
    assert [s["id"] for s in similar] == [first["id"]]
    assert similar[0]["title"] == "Phone put in Phone Extension"
    assert similar[0]["score"] >= 80 and similar[0]["status"] == "new"

    # One tap: the new one goes into it, and its count goes up.
    merged = await admin_client.post(
        f"/v1/admin/bugs/{out['report']['id']}/merge", json={"into_id": first["id"]}
    )
    assert merged.status_code == 200 and merged.json()["count"] == 2


@pytest.mark.asyncio
async def test_suggestions_are_at_most_three_and_ideas_match_ideas(admin_client):
    for n in range(5):
        await _post(admin_client, title=f"Scout stops early on page {n}")
    await _post(admin_client, type="idea", title="Scout stops early on page 9")
    out = await _post(admin_client, title="Scout stops early on page")
    assert len(out["similar"]) == 3
    idea = await _post(admin_client, type="idea", title="Scout stops early on pages")
    assert len(idea["similar"]) == 1
    nothing = await _post(admin_client, title="Dark mode colors are off")
    assert nothing["similar"] == []


# --------------------------------------------------------------------------- #
# Caught: the shared rules
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_same_caught_error_is_one_report_that_counts(db_session):
    for _ in range(40):
        assert await svc.catch(
            db_session,
            section="app",
            kind="crash",
            place="/jobs/3f2b8c1e-1111-4222-8333-944455556666?tab=notes",
            message="TypeError: x is undefined, sent to alex.rivera@example.com",
            key="typeerror: x is undefined",
        )
    await db_session.commit()
    [report] = await _caught(db_session)
    assert report.count == 40
    assert report.place == "/jobs/:id"
    assert report.severity == "major" and report.status == "new"
    assert "[removed]" in report.actual and "alex.rivera" not in report.actual
    assert report.context["api_version"] == "dev"
    seen = await db_session.scalar(
        select(func.count()).where(
            BugReportEvent.report_id == report.id, BugReportEvent.kind == "seen"
        )
    )
    assert seen == 20  # the newest 20 kept; the count keeps the rest


@pytest.mark.asyncio
async def test_a_fixed_caught_error_comes_back(db_session):
    kw = {"section": "app", "kind": "crash", "place": "/jobs", "message": "Boom"}
    await svc.catch(db_session, **kw)
    [report] = await _caught(db_session)
    await svc.update_report(
        db_session, report.id, {"status": "fixed", "fixed_in": "PR #70"}
    )
    await svc.catch(db_session, **kw)
    await db_session.refresh(report)
    assert report.status == "new" and report.came_back_at is not None
    assert report.count == 2


@pytest.mark.asyncio
async def test_thirty_new_an_hour_then_one_report_counts_the_rest(db_session):
    for n in range(svc.CAUGHT_PER_HOUR):
        assert await svc.catch(
            db_session, section="app", kind="crash", place=f"/page{chr(97 + n % 26)}{n}"
        )
    # Past the cap: not kept, counted.
    assert not await svc.catch(db_session, section="app", kind="crash", place="/x1")
    assert not await svc.catch(db_session, section="app", kind="crash", place="/x2")
    # A repeat of one already kept always counts.
    assert await svc.catch(db_session, section="app", kind="crash", place="/pagea0")
    await db_session.commit()
    reports = await _caught(db_session)
    assert len(reports) == svc.CAUGHT_PER_HOUR + 1
    flood = next(r for r in reports if r.kind == svc.FLOOD_KIND)
    assert flood.count == 2 and flood.title == "Too many errors, 2 more not kept"
    first = next(r for r in reports if r.place == "/pagea0")
    assert first.count == 2


# --------------------------------------------------------------------------- #
# Server errors
# --------------------------------------------------------------------------- #


def _boom_app() -> FastAPI:
    from app.main import unhandled_exception_handler

    boom = FastAPI()
    boom.add_exception_handler(Exception, unhandled_exception_handler)

    @boom.post("/v1/apply/runs/{run_id}/boom")
    async def apply_boom(run_id: str):
        raise RuntimeError(
            "dup key for alex.rivera@example.com\n[SQL: INSERT secret job text]"
        )

    @boom.get("/v1/jobs/{job_id}")
    async def jobs_boom(job_id: str):
        raise KeyError("missing")

    return boom


def _boom_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
    )


@pytest.mark.asyncio
async def test_a_server_error_is_kept_with_its_route_and_no_user(engine, monkeypatch):
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(svc, "_sessions", lambda: maker)
    async with _boom_client(_boom_app()) as c:
        for run in ("3f2b8c1e-1111-4222-8333-944455556666", "12345"):
            r = await c.post(
                f"/v1/apply/runs/{run}/boom",
                headers={"Authorization": "Bearer someone"},
            )
            assert r.status_code == 500
            assert r.json() == {"detail": "Internal server error"}
        assert (await c.get("/v1/jobs/77")).status_code == 500

    async with maker() as db:
        reports = {r.section: r for r in await _caught(db)}
    apply = reports["apply"]
    assert apply.count == 2  # the same route twice, whatever the ids
    assert apply.kind == "server_error"
    assert apply.place == "POST /v1/apply/runs/{run_id}/boom"
    assert apply.title == "Server error on POST /v1/apply/runs/{run_id}/boom"
    assert apply.actual == "RuntimeError: dup key for [removed]"
    assert "SQL" not in apply.actual and "secret" not in apply.actual
    assert reports["app"].place == "GET /v1/jobs/{job_id}"
    assert reports["app"].actual == "KeyError: 'missing'"


@pytest.mark.asyncio
async def test_a_server_error_when_the_database_is_down_is_only_logged(
    monkeypatch, caplog
):
    # A database with no tables: keeping the error fails.
    empty = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    monkeypatch.setattr(
        svc, "_sessions", lambda: async_sessionmaker(bind=empty, expire_on_commit=False)
    )
    calls = []
    real = svc.catch_server_error

    async def counted(request, exc):
        calls.append(type(exc).__name__)
        await real(request, exc)

    monkeypatch.setattr(svc, "catch_server_error", counted)
    with caplog.at_level(logging.WARNING):
        async with _boom_client(_boom_app()) as c:
            r = await c.get("/v1/jobs/1")
    assert r.status_code == 500
    assert calls == ["KeyError"]  # once: the failure isn't reported again
    assert "Couldn't keep a server error" in caplog.text
    await empty.dispose()


def test_server_errors_go_to_the_section_of_their_route():
    assert svc.section_for_route("/v1/apply/runs/{run_id}") == "apply"
    assert svc.section_for_route("/v1/email/scan") == "email"
    assert svc.section_for_route("/v1/scout/runs") == "scout"
    assert svc.section_for_route("/v1/extension/hello") == "job_catcher"
    assert svc.section_for_route("/v1/applyx") == "app"
    assert svc.section_for_route("/v1/saved-jobs/") == "app"


# --------------------------------------------------------------------------- #
# The app and Job Catcher: POST /v1/bugs/caught
# --------------------------------------------------------------------------- #


@pytest.fixture(autouse=True)
def _reset_limiter():
    bugs_api._limiter.reset()
    yield
    bugs_api._limiter.reset()


def _crash(**more):
    return {
        "section": "app",
        "kind": "crash",
        "place": "/jobs/3f2b8c1e-1111-4222-8333-944455556666?x=1",
        "message": "TypeError: Cannot read properties of undefined (reading 'id')",
        "context": {
            "device": "phone",
            "browser": "Safari 18",
            "app_version": "a1b2c3d",
        },
        **more,
    }


@pytest.mark.asyncio
async def test_a_signed_in_user_can_send_a_crash(client, db_session, test_user):
    r = await client.post("/v1/bugs/caught", json=_crash())
    assert r.status_code == 202 and r.json() == {"kept": True}
    again = await client.post("/v1/bugs/caught", json=_crash(place="/jobs/42"))
    assert again.json() == {"kept": True}
    [report] = await _caught(db_session)
    assert report.count == 2 and report.place == "/jobs/:id"
    assert report.title.startswith("The app crashed on /jobs/:id: TypeError")
    assert report.context == {
        "device": "phone",
        "browser": "Safari 18",
        "app_version": "a1b2c3d",
        "api_version": "dev",
    }
    # No one: nothing of the user anywhere in it.
    flat = str([report.title, report.actual, report.place, report.context])
    assert test_user.email not in flat and str(test_user.id) not in flat


@pytest.mark.asyncio
async def test_two_different_errors_on_one_page_are_two_reports(client, db_session):
    await client.post("/v1/bugs/caught", json=_crash(message="TypeError: a"))
    await client.post("/v1/bugs/caught", json=_crash(message="RangeError: b"))
    assert len(await _caught(db_session)) == 2


@pytest.mark.asyncio
async def test_caught_text_is_scrubbed(client, db_session):
    await client.post(
        "/v1/bugs/caught",
        json=_crash(message="Failed for alex.rivera@example.com, code 482913"),
    )
    [report] = await _caught(db_session)
    assert "alex.rivera" not in report.actual and "482913" not in report.actual
    assert "alex.rivera" not in report.title


@pytest.mark.asyncio
async def test_job_catcher_failures_keep_the_site_without_its_query(client, db_session):
    r = await client.post(
        "/v1/bugs/caught",
        json={
            "section": "job_catcher",
            "kind": "save_failed",
            "place": "https://www.acme.example/careers/job/R0012345?token=abc",
            "message": "Save failed: 500",
            "context": {"job_catcher": "0.44.0"},
        },
    )
    assert r.json() == {"kept": True}
    [report] = await _caught(db_session)
    assert report.section == "job_catcher"
    assert report.place == "acme.example/careers/job/R0012345"
    assert report.title.startswith("Job Catcher couldn't save on acme.example")


@pytest.mark.asyncio
async def test_caught_refuses_unknown_sections_and_kinds(client):
    assert (
        await client.post("/v1/bugs/caught", json=_crash(section="email"))
    ).status_code == 422
    assert (
        await client.post("/v1/bugs/caught", json=_crash(kind="server_error"))
    ).status_code == 422
    assert (
        await client.post("/v1/bugs/caught", json=_crash(message="x" * 301))
    ).status_code == 422


@pytest.mark.asyncio
async def test_caught_needs_a_sign_in(anon_client):
    assert (await anon_client.post("/v1/bugs/caught", json=_crash())).status_code == 401


@pytest.mark.asyncio
async def test_caught_takes_a_job_catcher_pass(anon_client, db_session, test_user):
    from tests.api.test_pass_routes import _a_pass

    token = await _a_pass(db_session, test_user)
    r = await anon_client.post(
        "/v1/bugs/caught",
        json=_crash(section="job_catcher", kind="resume_failed", place="acme.example"),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 202 and r.json() == {"kept": True}


@pytest.mark.asyncio
async def test_caught_allows_twenty_a_minute(client):
    for _ in range(20):
        assert (await client.post("/v1/bugs/caught", json=_crash())).status_code == 202
    assert (await client.post("/v1/bugs/caught", json=_crash())).status_code == 429


@pytest.mark.asyncio
async def test_caught_past_the_hourly_cap_says_not_kept(client, db_session):
    for n in range(svc.CAUGHT_PER_HOUR):
        await svc.catch(db_session, section="app", kind="crash", place=f"/p{n}x")
    await db_session.commit()
    r = await client.post("/v1/bugs/caught", json=_crash())
    assert r.status_code == 202 and r.json() == {"kept": False}
    flood = await db_session.scalar(
        select(BugReport).where(BugReport.kind == svc.FLOOD_KIND)
    )
    assert flood.title == "Too many errors, 1 more not kept"


# --------------------------------------------------------------------------- #
# Email checks and Scout refusals
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_failed_email_check_is_kept_without_the_address(
    client, db_session, monkeypatch
):
    from cryptography.fernet import Fernet

    from app.config import settings
    from app.services import email_imap, email_sync

    monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())
    r = await client.post(
        "/v1/email/connect",
        json={"email_address": "jordan.vale@yahoo.com", "app_password": "pw"},
    )
    assert r.status_code == 201

    async def bad_login(*args, **kwargs):
        raise email_imap.ImapAuthError("LOGIN failed for jordan.vale@yahoo.com")

    monkeypatch.setattr(email_sync, "sync_mailbox", bad_login)
    assert (await client.post("/v1/email/scan")).status_code == 400
    assert (await client.post("/v1/email/scan")).status_code == 400

    async def unreachable(*args, **kwargs):
        raise email_sync.SyncInterrupted(email_sync.CONNECTION_LOST, "connect")

    monkeypatch.setattr(email_sync, "sync_mailbox", unreachable)
    assert (await client.post("/v1/email/scan")).status_code == 502

    reports = {r.place: r for r in await _caught(db_session)}
    assert set(reports) == {"yahoo login_failed", "yahoo connection_lost"}
    login = reports["yahoo login_failed"]
    assert login.section == "email" and login.kind == "email_check"
    assert login.count == 2
    assert login.title == "Email check failed: yahoo login_failed"
    flat = str([(r.title, r.actual, r.context) for r in reports.values()])
    assert "jordan" not in flat and "@" not in flat


@pytest.mark.asyncio
async def test_a_scout_refusal_is_kept_by_tool_and_kind(engine, monkeypatch):
    import app.mcp_server as mcp_mod
    from tests.test_mcp_scout import _setup
    from tests.test_mcp_server import _connected_user

    maker = await _connected_user(engine, monkeypatch, email="riley@test.dev")
    _, _, run_id = await _setup(maker, "riley@test.dev")
    await mcp_mod.get_scout_brief()
    for n in (31, 40):
        with pytest.raises(ValueError, match="at most 30"):
            await mcp_mod.check_jobs(
                str(run_id), [{"company": "Vellacor", "title": "T"}] * n
            )
    async with maker() as db:
        [report] = await _caught(db)
    assert report.section == "scout" and report.kind == "scout_refused"
    assert report.place == "check_jobs"
    assert report.count == 2  # the same refusal, whatever the numbers
    assert report.title.startswith(
        "Scout turned down a check_jobs call: Send at most N"
    )
    assert "riley" not in str([report.title, report.actual, report.context])


def test_refusal_category_drops_numbers_and_quoted_text():
    from app.services.scout_log import refusal_category

    assert refusal_category(
        'Job "Senior Dev at Vellacor" was reported 3 times. Try another.'
    ) == ("Job … was reported N times.")


# --------------------------------------------------------------------------- #
# Services going down
# --------------------------------------------------------------------------- #


@pytest.fixture
def health(monkeypatch):
    """The health checks as the test says; the watch's memory starts empty."""
    state = {"Adzuna": "healthy"}

    async def fake(db):
        return [
            ServiceStatus(name=name, status=status, detail="ConnectError")
            for name, status in state.items()
        ]

    monkeypatch.setattr(admin_service, "check_service_health", fake)
    monkeypatch.setattr(admin_service, "_health_last", {})
    return state


@pytest.mark.asyncio
async def test_a_service_down_is_one_report_per_outage(engine, health, monkeypatch):
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    await admin_service.health_watch(maker)  # healthy: nothing
    async with maker() as db:
        assert await _caught(db) == []

    health["Adzuna"] = "down"
    for _ in range(3):
        await admin_service.health_watch(maker)
    # After a restart the memory is gone; the report says it's still down.
    monkeypatch.setattr(admin_service, "_health_last", {})
    await admin_service.health_watch(maker)
    async with maker() as db:
        [report] = await _caught(db)
        assert report.count == 1 and report.kind == "service_down"
        assert report.title == "Adzuna is down"
        assert report.actual == "Adzuna is down: ConnectError"

    health["Adzuna"] = "healthy"
    await admin_service.health_watch(maker)
    await admin_service.health_watch(maker)
    async with maker() as db:
        detail = await svc.detail(db, report.id)
    back = [e for e in detail["events"] if e["data"].get("field") == "recovered"]
    assert len(back) == 1 and back[0]["by"] == "app"

    # A second outage counts the same report up, once.
    health["Adzuna"] = "down"
    await admin_service.health_watch(maker)
    await admin_service.health_watch(maker)
    async with maker() as db:
        [report] = await _caught(db)
        assert report.count == 2


@pytest.mark.asyncio
async def test_degraded_isnt_down(engine, health):
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    health["JSearch"] = "degraded"
    await admin_service.health_watch(maker)
    async with maker() as db:
        assert await _caught(db) == []


@pytest.mark.asyncio
async def test_the_health_watch_never_raises(health):
    class Broken:
        def __call__(self):
            raise RuntimeError("no database")

    await admin_service.health_watch(Broken())  # only logged


# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_health_says_the_version(anon_client, monkeypatch):
    body = (await anon_client.get("/health")).json()
    assert body == {"status": "ok", "version": "dev"}
    monkeypatch.setenv("RENDER_GIT_COMMIT", "4dd424e0123456789abcdef")
    assert (await anon_client.get("/health")).json()["version"] == "4dd424e"


@pytest.mark.asyncio
async def test_caught_reports_carry_the_api_version(db_session, monkeypatch):
    monkeypatch.setenv("RENDER_GIT_COMMIT", "abcdef0123456")
    await svc.catch(db_session, section="app", kind="crash", place="/jobs")
    [report] = await _caught(db_session)
    assert report.context["api_version"] == "abcdef0"
