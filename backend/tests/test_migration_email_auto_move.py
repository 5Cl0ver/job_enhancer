"""Migration e6f7a8b9c0d1 (auto-move switch): upgrade, downgrade.

SQLite temp file built at the older schema, plus offline Postgres SQL — never a
real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from tests.test_migration_email_sync import (
    _alembic,
    _cols,
    _ok,
    legacy_db,  # noqa: F401 — fixture
)

PREV, HEAD = "d5e6f7a8b9c0", "e6f7a8b9c0d1"


class TestAutoMoveMigration:
    def test_upgrade_adds_switch_on(self, legacy_db):  # noqa: F811
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        con = sqlite3.connect(legacy_db)
        assert "auto_move" in _cols(con, "email_accounts")
        con.close()

    def test_round_trip(self, legacy_db):  # noqa: F811
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        _ok(_alembic(legacy_db, "downgrade", PREV))
        con = sqlite3.connect(legacy_db)
        assert "auto_move" not in _cols(con, "email_accounts")
        con.close()
        _ok(_alembic(legacy_db, "upgrade", HEAD))

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert "ADD COLUMN auto_move BOOLEAN DEFAULT true NOT NULL" in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert "DROP COLUMN auto_move" in down
