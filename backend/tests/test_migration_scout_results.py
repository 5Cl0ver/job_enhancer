"""Migration j8e9f0a1b2c4 (Scout results and levels).

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

PREV, HEAD = "i7d8e9f0a1b3", "j8e9f0a1b2c4"


def _cols(con, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def test_round_trip(scout_db):  # noqa: F811
    _at_prev(scout_db)
    _ok(_alembic(scout_db, "upgrade", HEAD))
    con = sqlite3.connect(scout_db)
    assert {"levels", "years"} <= _cols(con, "resume_tracks")
    assert {"location", "level", "in_area", "claude_fit", "facts_from"} <= _cols(
        con, "scout_findings"
    )
    assert "last_openings" in _cols(con, "scout_companies")
    con.close()
    _ok(_alembic(scout_db, "downgrade", PREV))
    con = sqlite3.connect(scout_db)
    assert "levels" not in _cols(con, "resume_tracks")
    assert "passed_at" not in _cols(con, "scout_findings")
    con.close()
    _ok(_alembic(scout_db, "upgrade", HEAD))


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "ALTER TABLE resume_tracks ADD COLUMN levels JSON" in up
    assert "ALTER TABLE scout_findings ADD COLUMN facts_from" in up
    assert "ALTER TABLE scout_companies ADD COLUMN last_openings JSON" in up
    # Additive only.
    assert "DROP" not in up and "CREATE TABLE" not in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP COLUMN levels" in down
