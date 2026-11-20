"""Migration g5b6c7d8e9f1 (the "Anything I'd be good at" search).

Offline Postgres SQL plus a SQLite round trip from the previous head — never a
real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from tests.test_migration_email_sync import (
    _alembic,
    _ok,
    legacy_db,  # noqa: F401 — fixture
)
from tests.test_migration_scout_review import _at_prev
from tests.test_migration_scout_tracks import scout_db  # noqa: F401 — fixture

PREV, HEAD = "f4a5b6c7d8e0", "g5b6c7d8e9f1"


def _tables(con) -> set[str]:
    return {
        r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def _columns(con, table) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def test_round_trip_keeps_existing_rows(scout_db):  # noqa: F811
    _at_prev(scout_db)
    _ok(_alembic(scout_db, "upgrade", PREV))
    con = sqlite3.connect(scout_db)
    con.execute("INSERT INTO users (id) VALUES ('u1')")
    con.execute(
        "INSERT INTO resume_tracks (id, user_id, name, target_titles, key_skills, "
        "skip_rules) VALUES ('t1', 'u1', 'IT Admin', '[]', '[]', '{}')"
    )
    con.commit()
    con.close()
    _ok(_alembic(scout_db, "upgrade", HEAD))
    con = sqlite3.connect(scout_db)
    assert "scout_titles" in _tables(con)
    assert {"search_title", "closest_track_id"} <= _columns(con, "scout_findings")
    assert "overrides" in _columns(con, "scout_missions")
    # Every existing resume type is a scoped one.
    assert con.execute("SELECT kind FROM resume_tracks").fetchall() == [("scoped",)]
    con.close()
    _ok(_alembic(scout_db, "downgrade", PREV))
    con = sqlite3.connect(scout_db)
    assert "scout_titles" not in _tables(con)
    assert "kind" not in _columns(con, "resume_tracks")
    assert "closest_track_id" not in _columns(con, "scout_findings")
    assert con.execute("SELECT name FROM resume_tracks").fetchall() == [("IT Admin",)]
    con.close()
    _ok(_alembic(scout_db, "upgrade", HEAD))


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "CREATE TABLE scout_titles" in up
    assert "REFERENCES scout_missions (id) ON DELETE CASCADE" in up
    assert "CONSTRAINT uq_scout_title_mission_key UNIQUE (mission_id, title_key)" in up
    assert "ALTER TABLE scout_titles ENABLE ROW LEVEL SECURITY" in up
    assert (
        "ALTER TABLE resume_tracks ADD COLUMN kind VARCHAR(10) DEFAULT 'scoped' NOT NULL"
        in up
    )
    assert "ON DELETE SET NULL" in up  # closest_track_id
    # New columns and a table only: nothing existing is dropped.
    assert "DROP" not in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE scout_titles" in down
