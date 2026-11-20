"""Migration h6c7d8e9f0a2 (the Instructions page and the run log).

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

PREV, HEAD = "g5b6c7d8e9f1", "h6c7d8e9f0a2"
NEW = {"scout_instruction_versions", "scout_run_events"}


def _tables(con) -> set[str]:
    return {
        r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def test_round_trip(scout_db):  # noqa: F811
    _at_prev(scout_db)
    _ok(_alembic(scout_db, "upgrade", HEAD))
    con = sqlite3.connect(scout_db)
    assert _tables(con) >= NEW
    con.close()
    _ok(_alembic(scout_db, "downgrade", PREV))
    con = sqlite3.connect(scout_db)
    assert not NEW & _tables(con)
    assert "scout_titles" in _tables(con)
    con.close()
    _ok(_alembic(scout_db, "upgrade", HEAD))


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    for table in NEW:
        assert f"CREATE TABLE {table}" in up
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in up
    assert "REFERENCES scout_runs (id) ON DELETE CASCADE" in up
    assert "DROP" not in up and "ALTER TABLE scout_runs" not in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE scout_run_events" in down
    assert "DROP TABLE scout_instruction_versions" in down
