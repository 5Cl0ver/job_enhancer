"""Migration d1e2f3a4b5c7 (Scout asks before saving; a search's collection).

SQLite temp file built at the older schema, plus offline Postgres SQL — never a
real database (see tests/test_migration_email_sync.py).
"""

import sqlite3
import uuid

from tests.test_migration_email_sync import (
    _alembic,
    _cols,
    _ok,
    legacy_db,  # noqa: F401 — fixture
)
from tests.test_migration_scout_tracks import scout_db  # noqa: F401 — fixture

PREV, HEAD = "c0d1e2f3a4b6", "d1e2f3a4b5c7"


def _at_prev(db):
    """The previous revision, with the tables this one points at."""
    _ok(_alembic(db, "upgrade", "b9c0d1e2f3a5"))
    con = sqlite3.connect(db)
    # The legacy test schema's saved_jobs/job_listings are bare; the previous
    # migration's backfill reads these.
    con.execute("ALTER TABLE saved_jobs ADD COLUMN job_listing_id CHAR(32)")
    con.execute(
        "CREATE TABLE job_listings "
        "(id CHAR(32) PRIMARY KEY, source VARCHAR(20), apply_url VARCHAR(2000))"
    )
    con.execute("CREATE TABLE collections (id CHAR(32) PRIMARY KEY)")
    con.commit()
    con.close()
    _ok(_alembic(db, "upgrade", PREV))


class TestScoutReviewMigration:
    def test_round_trip_keeps_existing_searches(self, scout_db):  # noqa: F811
        _at_prev(scout_db)
        con = sqlite3.connect(scout_db)
        user, track, mission = (uuid.uuid4().hex for _ in range(3))
        con.execute("INSERT INTO users (id) VALUES (?)", (user,))
        con.execute(
            "INSERT INTO resume_tracks (id, user_id, name, target_titles, key_skills, "
            "skip_rules) VALUES (?, ?, 'IT Admin', '[]', '[]', '{}')",
            (track, user),
        )
        con.execute(
            "INSERT INTO scout_missions (id, user_id, name, source, track_id, "
            "job_count, posted_within_days, remote, min_fit) "
            "VALUES (?, ?, 'LinkedIn', 'linkedin', ?, 5, 7, 'any', 6)",
            (mission, user, track),
        )
        con.commit()
        con.close()

        _ok(_alembic(scout_db, "upgrade", HEAD))
        con = sqlite3.connect(scout_db)
        assert {"collection_id", "auto_save"} <= _cols(con, "scout_missions")
        assert "stats" in _cols(con, "scout_runs")
        # An existing search keeps working: no collection chosen, asks first.
        assert con.execute(
            "SELECT collection_id, auto_save, name FROM scout_missions"
        ).fetchall() == [(None, 0, "LinkedIn")]
        con.close()

        _ok(_alembic(scout_db, "downgrade", PREV))
        con = sqlite3.connect(scout_db)
        assert not {"collection_id", "auto_save"} & _cols(con, "scout_missions")
        assert "stats" not in _cols(con, "scout_runs")
        assert con.execute("SELECT COUNT(*) FROM scout_missions").fetchone()[0] == 1
        con.close()
        _ok(_alembic(scout_db, "upgrade", HEAD))

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert "ALTER TABLE scout_missions ADD COLUMN collection_id UUID" in up
        assert (
            "ALTER TABLE scout_missions ADD COLUMN auto_save BOOLEAN "
            "DEFAULT false NOT NULL" in up
        )
        assert "REFERENCES collections (id) ON DELETE SET NULL" in up
        assert "ALTER TABLE scout_runs ADD COLUMN stats JSON" in up
        # Additions only: nothing is rewritten, dropped or backfilled.
        assert "DROP" not in up and "UPDATE scout" not in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        for col in ("collection_id", "auto_save", "stats"):
            assert f"DROP COLUMN {col}" in down
