"""Migration f4a5b6c7d8e0 (the rows Claude passed over by title).

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

PREV, HEAD = "f3a4b5c6d7e9", "f4a5b6c7d8e0"


def _tables(con) -> set[str]:
    return {
        r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def test_round_trip(scout_db):  # noqa: F811
    _at_prev(scout_db)
    _ok(_alembic(scout_db, "upgrade", HEAD))
    con = sqlite3.connect(scout_db)
    assert "scout_passes" in _tables(con)
    con.close()
    _ok(_alembic(scout_db, "downgrade", PREV))
    con = sqlite3.connect(scout_db)
    assert "scout_passes" not in _tables(con)
    assert "scout_companies" in _tables(con)
    con.close()
    _ok(_alembic(scout_db, "upgrade", HEAD))


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "CREATE TABLE scout_passes" in up
    assert "REFERENCES users (id) ON DELETE CASCADE" in up
    assert "REFERENCES resume_tracks (id) ON DELETE CASCADE" in up
    assert "CREATE INDEX ix_scout_passes_track_title" in up
    assert "ALTER TABLE scout_passes ENABLE ROW LEVEL SECURITY" in up
    # A new table only: nothing existing is changed.
    assert "ALTER TABLE scout_" not in up.replace("ALTER TABLE scout_passes ENABLE", "")
    assert "DROP" not in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE scout_passes" in down
