"""Re-check the last weeks with today's rules, and the looked-at cleanup
(spec 027)."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.detected_event import DetectedEvent
from app.models.email_account import EmailAccount
from app.models.pipeline_stage import PipelineStage
from app.services import email_recheck, email_review, email_sync
from app.services.email_scan import EmailMessage
from tests.api.test_email import _as_sync, _create_saved_job
from tests.test_migration_email_sync import _alembic, _ok


@pytest.fixture
def enc_key(monkeypatch):
    """A real encryption key, so /connect works in tests."""
    from cryptography.fernet import Fernet

    from app.config import settings

    monkeypatch.setattr(settings, "mail_enc_key", Fernet.generate_key().decode())


async def _connect(client):
    r = await client.post(
        "/v1/email/connect",
        json={"email_address": "me@yahoo.com", "app_password": "pw"},
    )
    assert r.status_code == 201


def _old_mail():
    return [
        EmailMessage(
            uid="501",
            from_addr="Brightwave Relays <careers@brightwaverelays.example>",
            subject="Thank you for applying to Brightwave Relays",
            body="Thank you for applying for the IT Systems Engineer role at "
            "Brightwave Relays. We have received your application.",
        ),
        EmailMessage(
            uid="502",
            from_addr="Brightwave Relays <careers@brightwaverelays.example>",
            subject="Interview: IT Systems Engineer at Brightwave Relays",
            body="We'd like to invite you to interview for the IT Systems "
            "Engineer role. Please pick a time.",
        ),
    ]


@pytest.mark.asyncio
async def test_recheck_finds_the_missed_and_moves_nothing(
    client,
    db_session,
    test_user,
    engine,
    enc_key,
    monkeypatch,
):
    await _connect(client)
    applied = await db_session.scalar(
        select(PipelineStage.id).where(
            PipelineStage.user_id == test_user.id, PipelineStage.name == "Applied"
        )
    )
    job = await _create_saved_job(
        db_session, test_user, "Brightwave Relays", "IT Systems Engineer"
    )
    job.pipeline_stage_id = applied
    await db_session.commit()

    calls = []

    async def fake_fetch():
        return _old_mail()

    fake = _as_sync(fake_fetch)

    async def recording(*args, **kwargs):
        calls.append(args)
        return await fake(*args, **kwargs)

    monkeypatch.setattr(email_sync, "sync_mailbox", recording)
    account = await db_session.scalar(select(EmailAccount))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    await email_recheck._run(maker, account.id, 30, asyncio.Lock())

    state = email_recheck.status(account.id)
    assert state["state"] == "done"
    assert (state["found"], state["noted"], state["waiting"]) == (2, 1, 1)
    cursors, opts = calls[0][4], calls[0][5]
    assert cursors == {}  # the whole window; saved cursors left alone
    assert (opts.backfill_days, opts.time_budget_s, opts.body_cap) == (30, None, None)

    rows = {
        r.event_type: r.status for r in await db_session.scalars(select(DetectedEvent))
    }
    # The confirmation is kept on the job; the interview waits for the user.
    assert rows == {"applied": "noted", "interview": "pending"}
    await db_session.refresh(job)
    assert job.pipeline_stage_id == applied  # nothing moved

    # A second re-check adds nothing.
    await email_recheck._run(maker, account.id, 30, asyncio.Lock())
    assert email_recheck.status(account.id)["found"] == 0


@pytest.mark.asyncio
async def test_recheck_routes(client, db_session, test_user, enc_key, monkeypatch):
    assert (
        await client.post("/v1/email/recheck", json={"days": 30})
    ).status_code == 404
    assert (await client.get("/v1/email/recheck")).json()["state"] == "idle"
    await _connect(client)
    assert (
        await client.post("/v1/email/recheck", json={"days": 99})
    ).status_code == 422

    started = []

    def fake_start(maker, account_id, days, lock):
        started.append(days)
        return {"state": "running", "days": days}

    monkeypatch.setattr(email_recheck, "start", fake_start)
    r = await client.post("/v1/email/recheck", json={"days": 30})
    assert r.status_code == 202 and r.json()["state"] == "running"
    assert started == [30]

    # Not while a scan holds the lock.
    from app.api.v1 import email as email_api

    account = await db_session.scalar(select(EmailAccount))
    lock = email_api._SCAN_LOCKS.setdefault(account.id, asyncio.Lock())
    async with lock:
        busy = await client.post("/v1/email/recheck", json={"days": 30})
    assert busy.status_code == 409


@pytest.mark.asyncio
async def test_scan_reports_noted_and_looked_at(
    client,
    db_session,
    test_user,
    enc_key,
    monkeypatch,
):
    await _connect(client)
    applied = await db_session.scalar(
        select(PipelineStage.id).where(
            PipelineStage.user_id == test_user.id, PipelineStage.name == "Applied"
        )
    )
    job = await _create_saved_job(
        db_session, test_user, "Brightwave Relays", "IT Systems Engineer"
    )
    job.pipeline_stage_id = applied
    await db_session.commit()

    async def fake_fetch():
        return _old_mail()[:1]

    monkeypatch.setattr(email_sync, "sync_mailbox", _as_sync(fake_fetch))
    body = (await client.post("/v1/email/scan")).json()
    assert (body["detected"], body["noted"]) == (0, 1)
    # Noted emails are on the job's own list, never on the pending list.
    assert (await client.get("/v1/email/events")).json() == []
    on_job = (
        await client.get(
            "/v1/email/job-emails", params={"job_listing_id": str(job.job_listing_id)}
        )
    ).json()
    assert [e["status"] for e in on_job] == ["noted"]


@pytest.mark.asyncio
async def test_looked_at_keeps_30_days_and_500(db_session, test_user):
    from tests.services.test_email_scan import _make_account

    acct = await _make_account(db_session, test_user)
    now = datetime.now(tz=UTC)

    def row(i, age_days):
        return DetectedEvent(
            id=uuid.uuid4(),
            user_id=test_user.id,
            email_account_id=acct.id,
            from_addr="alerts@board.example",
            subject=f"Alert {i}",
            folder="INBOX",
            uidvalidity=1,
            message_uid=str(i),
            event_type="unknown",
            status="skipped",
            skip_reason="job_alert",
            created_at=now - timedelta(days=age_days, minutes=i),
        )

    db_session.add_all([row(i, 1) for i in range(503)] + [row(1000, 31)])
    # A kept email is never touched.
    db_session.add(
        DetectedEvent(
            id=uuid.uuid4(),
            user_id=test_user.id,
            email_account_id=acct.id,
            subject="Interview",
            folder="INBOX",
            uidvalidity=1,
            message_uid="9999",
            event_type="interview",
            status="noted",
            created_at=now - timedelta(days=60),
        )
    )
    await db_session.flush()
    gone = await email_review.purge_looked_at(db_session)
    assert gone == 4
    left = await db_session.scalar(
        select(func.count()).where(DetectedEvent.status == "skipped")
    )
    assert left == 500
    newest = await db_session.scalar(
        select(DetectedEvent.subject).where(DetectedEvent.subject == "Alert 0")
    )
    assert newest == "Alert 0"
    assert await db_session.scalar(
        select(func.count()).where(DetectedEvent.status == "noted")
    )


def test_migration_round_trip_and_postgres_sql(tmp_path):
    import sqlite3

    prev, head = "w1f2a3b4c5d7", "x2a3b4c5d6e8"
    db = tmp_path / "noted.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE detected_events (id CHAR(32) PRIMARY KEY, status VARCHAR(20));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{prev}');"
    )
    con.commit()
    con.close()
    _ok(_alembic(db, "upgrade", head))
    con = sqlite3.connect(db)
    cols = [r[1] for r in con.execute("PRAGMA table_info(detected_events)")]
    assert {"seen_at", "skip_reason"} <= set(cols)
    con.execute("INSERT INTO detected_events (id, status) VALUES ('a', 'noted')")
    con.execute("INSERT INTO detected_events (id, status) VALUES ('b', 'skipped')")
    con.commit()
    con.close()
    _ok(_alembic(db, "downgrade", prev))
    con = sqlite3.connect(db)
    assert con.execute("SELECT id, status FROM detected_events").fetchall() == [
        ("a", "hidden")
    ]
    con.close()

    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{prev}:{head}", "--sql", url=url)).stdout
    assert "ADD COLUMN seen_at TIMESTAMP WITH TIME ZONE" in up
