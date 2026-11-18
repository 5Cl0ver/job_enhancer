"""Migration c4d5e6f7a8b9 (email review items): upgrade, downgrade, refusal.

Same approach as tests/test_migration_email_sync.py: a temporary SQLite file
built at the older schema, plus offline (``--sql``) rendering for Postgres.
Never a real database.
"""

import sqlite3

from tests.test_migration_email_sync import (
    HEAD as SYNC_HEAD,
)
from tests.test_migration_email_sync import (
    _alembic,
    _cols,
    _event,
    _ok,
    legacy_db,  # noqa: F401 — fixture
)

PREV, HEAD = SYNC_HEAD, "c4d5e6f7a8b9"
NEW_COLS = {"match_evidence", "review_candidates"}


def _notnull(con, table, col):
    return {r[1]: r[3] for r in con.execute(f"PRAGMA table_info({table})")}[col]


class TestReviewItemsMigration:
    def test_upgrade_keeps_rows_and_allows_jobless_review_items(self, legacy_db):  # noqa: F811
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        con = sqlite3.connect(legacy_db)
        assert _cols(con, "detected_events") >= NEW_COLS
        assert _notnull(con, "detected_events", "saved_job_id") == 0
        rows = con.execute(
            "SELECT message_uid, status, saved_job_id IS NOT NULL, match_evidence,"
            " review_candidates FROM detected_events ORDER BY message_uid"
        ).fetchall()
        assert rows == [
            ("10", "pending", 1, None, None),
            ("11", "applied", 1, None, None),
        ]
        _event(
            con,
            "40",
            saved_job_id=None,
            status="needs_review",
            match_evidence="several_roles",
            review_candidates='["a", "b"]',
            uidvalidity=5,
        )
        assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (
            HEAD,
        )

    def test_round_trip(self, legacy_db):  # noqa: F811
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        _ok(_alembic(legacy_db, "downgrade", PREV))
        con = sqlite3.connect(legacy_db)
        assert NEW_COLS.isdisjoint(_cols(con, "detected_events"))
        assert _notnull(con, "detected_events", "saved_job_id") == 1
        assert con.execute("SELECT count(*) FROM detected_events").fetchone() == (2,)
        con.close()
        _ok(_alembic(legacy_db, "upgrade", HEAD))

    def test_downgrade_refuses_while_jobless_items_exist(self, legacy_db):  # noqa: F811
        _ok(_alembic(legacy_db, "upgrade", HEAD))
        con = sqlite3.connect(legacy_db)
        _event(con, "41", saved_job_id=None, status="needs_review", uidvalidity=5)
        con.close()
        proc = _alembic(legacy_db, "downgrade", PREV)
        assert proc.returncode != 0 and "cannot downgrade" in proc.stderr
        con = sqlite3.connect(legacy_db)
        assert con.execute("SELECT version_num FROM alembic_version").fetchone() == (
            HEAD,
        )
        con.close()

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert "ALTER COLUMN saved_job_id DROP NOT NULL" in up
        assert "ADD COLUMN match_evidence VARCHAR(40)" in up
        assert "ADD COLUMN review_candidates JSON" in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert "RAISE EXCEPTION" in down and "SET NOT NULL" in down
