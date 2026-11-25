"""Migration t8c9d0e1f2a4 (Apply from the app; spec 023).

A SQLite temp file stamped at the previous revision, plus offline Postgres SQL —
never a real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "s7b8c9d0e1f3", "t8c9d0e1f2a4"


def test_round_trip_and_plain_titles(tmp_path):
    db = tmp_path / "apply2.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE apply_runs (id CHAR(32) PRIMARY KEY, status VARCHAR(20));"
        "CREATE TABLE job_listings (id CHAR(32) PRIMARY KEY, title VARCHAR(500),"
        " company VARCHAR(255), location VARCHAR(255));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        "INSERT INTO apply_runs VALUES ('" + "a" * 32 + "', 'filling');"
        "INSERT INTO job_listings VALUES ('" + "b" * 32 + "',"
        " 'Microsoft 365 &amp; Copilot Administrator', 'Ben &amp; Jerry&#39;s',"
        " 'Austin, TX');"
        "INSERT INTO job_listings VALUES ('" + "c" * 32 + "',"
        " 'AT&T Field Tech', 'AT&T', 'Dallas');"
    )
    con.commit()
    con.close()

    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    rows = dict(
        (r[0], r[1:])
        for r in con.execute("SELECT id, title, company FROM job_listings")
    )
    assert rows["b" * 32] == ("Microsoft 365 & Copilot Administrator", "Ben & Jerry's")
    assert rows["c" * 32] == ("AT&T Field Tech", "AT&T")
    assert con.execute("SELECT messages, claude_at FROM apply_runs").fetchone() == (
        "[]",
        None,
    )
    con.close()

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(apply_runs)")}
    con.close()
    assert not {"messages", "claude_at"} & cols


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "ADD COLUMN messages JSON DEFAULT '[]' NOT NULL" in up
    assert "ADD COLUMN claude_at TIMESTAMP WITH TIME ZONE" in up
    assert "UPDATE job_listings SET title = REPLACE(" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP COLUMN messages" in down
