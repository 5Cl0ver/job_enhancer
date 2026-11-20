"""Migration f3a4b5c6d7e9 (the local companies a Scout search checked).

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

PREV, HEAD = "e2f3a4b5c6d8", "f3a4b5c6d7e9"


def _tables(con) -> set[str]:
    return {
        r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def test_round_trip(scout_db):  # noqa: F811
    _at_prev(scout_db)
    _ok(_alembic(scout_db, "upgrade", HEAD))
    con = sqlite3.connect(scout_db)
    assert "scout_companies" in _tables(con)
    con.close()
    _ok(_alembic(scout_db, "downgrade", PREV))
    con = sqlite3.connect(scout_db)
    assert "scout_companies" not in _tables(con)
    assert "scout_missions" in _tables(con)
    con.close()
    _ok(_alembic(scout_db, "upgrade", HEAD))


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "CREATE TABLE scout_companies" in up
    assert "REFERENCES users (id) ON DELETE CASCADE" in up
    assert "CONSTRAINT uq_scout_company_user_key UNIQUE (user_id, key)" in up
    assert "ALTER TABLE scout_companies ENABLE ROW LEVEL SECURITY" in up
    # A new table only: nothing existing is changed.
    assert "ALTER TABLE scout_missions" not in up and "DROP" not in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE scout_companies" in down
