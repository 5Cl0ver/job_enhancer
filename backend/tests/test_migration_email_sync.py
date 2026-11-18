"""Migration b3c4d5e6f7a8 (email sync folders): upgrade, downgrade, legacy rows.

Alembic runs in a subprocess against a temporary SQLite file — never a real
database. The older migration chain uses Postgres-only DDL, so the test builds
the tables as they stood at the previous head, stamps that revision, and runs
only this migration. The Postgres SQL is checked offline (``--sql``), which
renders statements without connecting to anything.
"""

import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PREV, HEAD = "f2a3b4c5d6e7", "b3c4d5e6f7a8"

_OLD_SCHEMA = """
CREATE TABLE users (id CHAR(32) PRIMARY KEY);
CREATE TABLE saved_jobs (id CHAR(32) PRIMARY KEY);
CREATE TABLE pipeline_stages (id CHAR(32) PRIMARY KEY);
CREATE TABLE email_accounts (
    id CHAR(32) PRIMARY KEY,
    user_id CHAR(32) NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    email_address VARCHAR(255) NOT NULL,
    provider VARCHAR(40) NOT NULL,
    auth_type VARCHAR(20) NOT NULL,
    imap_host VARCHAR(255) NOT NULL,
    imap_port INTEGER NOT NULL,
    secret_encrypted TEXT NOT NULL,
    status VARCHAR(20) NOT NULL,
    last_error TEXT,
    last_scan_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE detected_events (
    id CHAR(32) NOT NULL PRIMARY KEY,
    user_id CHAR(32) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    email_account_id CHAR(32) NOT NULL REFERENCES email_accounts (id) ON DELETE CASCADE,
    saved_job_id CHAR(32) NOT NULL REFERENCES saved_jobs (id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    target_stage VARCHAR(50),
    from_addr VARCHAR(255) DEFAULT '' NOT NULL,
    subject VARCHAR(500) DEFAULT '' NOT NULL,
    message_uid VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' NOT NULL,
    previous_stage_id CHAR(32) REFERENCES pipeline_stages (id) ON DELETE SET NULL,
    applied_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_detected_event_uid UNIQUE (email_account_id, message_uid)
);
CREATE INDEX ix_detected_events_user_status ON detected_events (user_id, status);
"""

USER, ACCT, JOB = (uuid.uuid4().hex for _ in range(3))


def _alembic(db: Path | None, *args: str, url: str | None = None):
    url = url or f"sqlite+aiosqlite:///{db.as_posix()}"
    if not (url.startswith("sqlite") or "offline.invalid" in url):
        raise AssertionError(f"refusing to run migrations against {url}")
    env = {
        **os.environ,
        "DATABASE_URL": url,
        "SUPABASE_URL": "https://example.supabase.co",
        "NVIDIA_API_KEY": "test",
        "ADZUNA_APP_ID": "test",
        "ADZUNA_APP_KEY": "test",
        "JSEARCH_API_KEY": "test",
    }
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _ok(proc):
    assert proc.returncode == 0, proc.stderr[-2000:]
    return proc


def _event(con, uid, **cols):
    row = {
        "id": uuid.uuid4().hex,
        "user_id": USER,
        "email_account_id": ACCT,
        "saved_job_id": JOB,
        "event_type": "interview",
        "target_stage": "Interview",
        "from_addr": "talent@globex.example",
        "subject": "Interview with Globex",
        "message_uid": uid,
        "status": "pending",
        **cols,
    }
    names = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    con.execute(
        f"INSERT INTO detected_events ({names}) VALUES ({marks})", list(row.values())
    )
    con.commit()


@pytest.fixture
def legacy_db(tmp_path):
    db = tmp_path / "migration.db"
    con = sqlite3.connect(db)
    con.executescript(_OLD_SCHEMA)
    con.execute("INSERT INTO users VALUES (?)", [USER])
    con.execute("INSERT INTO saved_jobs VALUES (?)", [JOB])
    con.execute(
        "INSERT INTO email_accounts (id, user_id, email_address, provider, auth_type,"
        " imap_host, imap_port, secret_encrypted, status) VALUES"
        " (?, ?, 'me@mail.example', 'yahoo', 'app_password', 'imap.example', 993,"
        " 'x', 'connected')",
        [ACCT, USER],
    )
    con.commit()
    _event(con, "10")
    _event(con, "11", status="applied")
    con.close()
    _ok(_alembic(db, "stamp", PREV))
    return db


def _cols(con, table):
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


class TestUpgrade:
    def test_existing_rows_survive_as_inbox_legacy_rows(self, legacy_db):
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        con = sqlite3.connect(legacy_db)
        rows = con.execute(
            "SELECT message_uid, status, folder, uidvalidity, logical_key"
            " FROM detected_events ORDER BY message_uid"
        ).fetchall()
        assert rows == [
            ("10", "pending", "INBOX", None, None),
            ("11", "applied", "INBOX", None, None),
        ]
        assert con.execute(
            "SELECT sync_backoff_level, sync_backoff_until FROM email_accounts"
        ).fetchall() == [(0, None)]
        assert "last_uid" in _cols(con, "email_folder_states")
        assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (
            HEAD,
        )

    def test_new_keys_are_enforced(self, legacy_db):
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        con = sqlite3.connect(legacy_db)
        _event(con, "20", folder="INBOX", uidvalidity=5)
        _event(con, "20", folder="Bulk", uidvalidity=9)  # same UID, other folder: ok
        with pytest.raises(sqlite3.IntegrityError):
            _event(con, "20", folder="INBOX", uidvalidity=5)
        _event(con, "21", uidvalidity=5, logical_key="emailid:E1")
        with pytest.raises(sqlite3.IntegrityError):
            _event(con, "22", uidvalidity=5, logical_key="emailid:E1")
        # The old (account, uid) key is gone.
        _event(con, "10", uidvalidity=5)


class TestDowngrade:
    def test_round_trip_restores_old_schema(self, legacy_db):
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        _ok(_alembic(legacy_db, "downgrade", PREV))
        con = sqlite3.connect(legacy_db)
        assert {"folder", "uidvalidity", "logical_key"}.isdisjoint(
            _cols(con, "detected_events")
        )
        assert "sync_backoff_level" not in _cols(con, "email_accounts")
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
        assert "email_folder_states" not in tables
        assert con.execute("SELECT count(*) FROM detected_events").fetchone() == (2,)
        with pytest.raises(sqlite3.IntegrityError):
            _event(con, "10")  # old unique key is back
        con.rollback()
        con.close()
        _ok(_alembic(legacy_db, "upgrade", HEAD))  # and it upgrades again

    def test_refuses_when_rows_would_collide(self, legacy_db):
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        con = sqlite3.connect(legacy_db)
        _event(con, "30", folder="INBOX", uidvalidity=5)
        _event(con, "30", folder="Bulk", uidvalidity=9)
        con.close()
        proc = _alembic(legacy_db, "downgrade", PREV)
        assert proc.returncode != 0 and "cannot downgrade" in proc.stderr
        con = sqlite3.connect(legacy_db)
        assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (
            HEAD,
        )


class TestPostgresOffline:
    def test_offline_sql_renders_without_a_database(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert "ALTER TABLE detected_events ADD COLUMN folder" in up
        assert "DROP CONSTRAINT uq_detected_event_uid" in up
        assert "CREATE TABLE email_folder_states" in up
        assert "ENABLE ROW LEVEL SECURITY" in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert "RAISE EXCEPTION" in down and "uq_detected_event_uid" in down
