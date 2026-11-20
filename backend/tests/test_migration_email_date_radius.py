"""Migration b9c0d1e2f3a5 (email date, Scout search radius).

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

PREV, HEAD = "a8b9c0d1e2f4", "b9c0d1e2f3a5"


class TestEmailDateAndRadiusMigration:
    def test_round_trip(self, scout_db):  # noqa: F811
        _ok(_alembic(scout_db, "upgrade", HEAD))
        con = sqlite3.connect(scout_db)
        assert "email_date" in _cols(con, "detected_events")
        assert "radius_miles" in _cols(con, "scout_missions")
        con.close()

        _ok(_alembic(scout_db, "downgrade", PREV))
        con = sqlite3.connect(scout_db)
        assert "email_date" not in _cols(con, "detected_events")
        assert "radius_miles" not in _cols(con, "scout_missions")
        # The tables themselves, and their other columns, stay.
        assert {"subject", "logical_key"} <= _cols(con, "detected_events")
        assert {"location", "remote"} <= _cols(con, "scout_missions")
        con.close()
        _ok(_alembic(scout_db, "upgrade", HEAD))

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert (
            "ALTER TABLE detected_events ADD COLUMN email_date TIMESTAMP WITH TIME ZONE"
            in up
        )
        assert "ALTER TABLE scout_missions ADD COLUMN radius_miles INTEGER" in up
        # Nullable additions only: nothing is rewritten, dropped or backfilled.
        assert "NOT NULL" not in up.split("ADD COLUMN email_date")[1].split(";")[0]
        assert "DROP" not in up and "UPDATE detected_events" not in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert "DROP COLUMN email_date" in down and "DROP COLUMN radius_miles" in down
