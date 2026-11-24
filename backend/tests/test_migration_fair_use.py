"""Migration r6a7b8c9d0e2 (fair use, last active; spec 019 part C).

A SQLite temp file stamped at the previous revision, plus offline Postgres SQL —
never a real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "q5f6a7b8c9d1", "r6a7b8c9d0e2"


def test_round_trip_and_last_active_backfill(tmp_path):
    db = tmp_path / "fair.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY, updated_at DATETIME);"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        "INSERT INTO users VALUES ('" + "a" * 32 + "', '2026-11-01 10:00:00');"
    )
    con.commit()
    con.close()

    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    assert (
        con.execute("SELECT last_active_at FROM users")
        .fetchone()[0]
        .startswith("2026-11-01")
    )
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert {"usage_counters", "app_settings"} <= tables
    con.close()

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    con.close()
    assert not {"usage_counters", "app_settings"} & tables
    assert "last_active_at" not in cols


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "CREATE TABLE usage_counters" in up
    assert "NULLS NOT DISTINCT" in up  # one shared JSearch row
    assert "ON DELETE CASCADE" in up
    for table in ("usage_counters", "app_settings"):
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in up
    assert "ADD COLUMN last_active_at" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE usage_counters" in down
