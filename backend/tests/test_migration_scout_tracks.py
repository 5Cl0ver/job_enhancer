"""Migration f7a8b9c0d1e3 (resume types): upgrade, downgrade.

SQLite temp file built at the older schema, plus offline Postgres SQL — never a
real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

import pytest

from tests.test_migration_email_sync import (
    _alembic,
    _cols,
    _ok,
    legacy_db,  # noqa: F401 — fixture
)

PREV, HEAD = "e6f7a8b9c0d1", "f7a8b9c0d1e3"


@pytest.fixture
def scout_db(legacy_db):  # noqa: F811
    """The email migrations' old schema, plus the resumes table tracks point at."""
    con = sqlite3.connect(legacy_db)
    con.execute("CREATE TABLE resumes (id CHAR(32) PRIMARY KEY)")
    con.commit()
    con.close()
    _ok(_alembic(legacy_db, "upgrade", PREV))
    return legacy_db


class TestResumeTracksMigration:
    def test_round_trip(self, scout_db):
        _ok(_alembic(scout_db, "upgrade", HEAD))
        con = sqlite3.connect(scout_db)
        assert {"name", "target_titles", "skip_rules", "resume_id"} <= _cols(
            con, "resume_tracks"
        )
        assert "track_id" in _cols(con, "saved_jobs")
        con.close()

        _ok(_alembic(scout_db, "downgrade", PREV))
        con = sqlite3.connect(scout_db)
        assert "track_id" not in _cols(con, "saved_jobs")
        assert not _cols(con, "resume_tracks")
        con.close()
        _ok(_alembic(scout_db, "upgrade", HEAD))

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert "CREATE TABLE resume_tracks" in up
        assert "ALTER TABLE resume_tracks ENABLE ROW LEVEL SECURITY" in up
        assert "ADD COLUMN track_id UUID" in up
        assert "ON DELETE SET NULL" in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert "DROP COLUMN track_id" in down and "DROP TABLE resume_tracks" in down
