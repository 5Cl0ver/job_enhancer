"""Migration u9d0e1f2a3b5 (Sites to skip; spec 024).

A SQLite temp file stamped at the previous revision, plus offline Postgres SQL —
never a real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

import pytest

from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "t8c9d0e1f2a4", "u9d0e1f2a3b5"


def test_round_trip(tmp_path):
    db = tmp_path / "skip.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        "INSERT INTO users VALUES ('" + "a" * 32 + "');"
    )
    con.commit()
    con.close()

    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(skipped_sites)")}
    assert cols == {"id", "user_id", "host", "created_at"}
    con.execute(
        "INSERT INTO skipped_sites (id, user_id, host) VALUES (?, ?, ?)",
        ("b" * 32, "a" * 32, "learn4good.com"),
    )
    # One row per user and site.
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(
            "INSERT INTO skipped_sites (id, user_id, host) VALUES (?, ?, ?)",
            ("c" * 32, "a" * 32, "learn4good.com"),
        )
    con.commit()
    con.close()

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert con.execute("SELECT count(*) FROM users").fetchone() == (1,)
    con.close()
    assert "skipped_sites" not in tables


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "CREATE TABLE skipped_sites" in up
    assert "ALTER TABLE skipped_sites ENABLE ROW LEVEL SECURITY" in up
    assert "ON DELETE CASCADE" in up
    assert "uq_skipped_sites_user_host" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE skipped_sites" in down
