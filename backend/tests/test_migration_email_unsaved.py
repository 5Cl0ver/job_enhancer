"""Migration d5e6f7a8b9c0 (names for unsaved jobs): upgrade, downgrade.

SQLite temp file built at the older schema, plus offline Postgres SQL — never a
real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from tests.test_migration_email_sync import (
    _alembic,
    _cols,
    _event,
    _ok,
    legacy_db,  # noqa: F401 — fixture
)

PREV, HEAD = "c4d5e6f7a8b9", "d5e6f7a8b9c0"
NEW_COLS = {"job_company", "job_title"}


class TestUnsavedNamesMigration:
    def test_upgrade_adds_columns_and_keeps_rows(self, legacy_db):  # noqa: F811
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        con = sqlite3.connect(legacy_db)
        assert _cols(con, "detected_events") >= NEW_COLS
        assert con.execute(
            "SELECT count(*), count(job_company) FROM detected_events"
        ).fetchone() == (2, 0)
        _event(
            con,
            "50",
            saved_job_id=None,
            status="unsaved",
            job_company="Vellacor",
            job_title="Data Engineer",
            uidvalidity=5,
        )
        con.close()

    def test_round_trip(self, legacy_db):  # noqa: F811
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        _ok(_alembic(legacy_db, "downgrade", PREV))
        con = sqlite3.connect(legacy_db)
        assert NEW_COLS.isdisjoint(_cols(con, "detected_events"))
        assert con.execute("SELECT count(*) FROM detected_events").fetchone() == (2,)
        con.close()
        _ok(_alembic(legacy_db, "upgrade", HEAD))

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert "ADD COLUMN job_company VARCHAR(255)" in up
        assert "ADD COLUMN job_title VARCHAR(255)" in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert "DROP COLUMN job_company" in down
