"""Migration a8b9c0d1e2f4 (scout searches, runs, findings, captures).

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
from tests.test_migration_scout_tracks import scout_db  # noqa: F401 — fixture

PREV, HEAD = "f7a8b9c0d1e3", "a8b9c0d1e2f4"
TABLES = ("scout_missions", "scout_runs", "scout_captures", "scout_findings")


class TestScoutRunsMigration:
    def test_round_trip(self, scout_db):  # noqa: F811
        _ok(_alembic(scout_db, "upgrade", HEAD))
        con = sqlite3.connect(scout_db)
        assert {"criteria", "status", "playbook_version"} <= _cols(con, "scout_runs")
        assert {"description", "url_key"} <= _cols(con, "scout_captures")
        assert {"company_key", "title_key", "url_key", "outcome"} <= _cols(
            con, "scout_findings"
        )
        con.close()

        _ok(_alembic(scout_db, "downgrade", PREV))
        con = sqlite3.connect(scout_db)
        assert not any(_cols(con, t) for t in TABLES)
        assert "track_id" in _cols(con, "saved_jobs")  # the earlier step stays
        con.close()
        _ok(_alembic(scout_db, "upgrade", HEAD))

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        for table in TABLES:
            assert f"CREATE TABLE {table}" in up
            assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert all(f"DROP TABLE {t}" in down for t in TABLES)
