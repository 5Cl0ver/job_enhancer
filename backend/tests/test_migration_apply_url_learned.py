"""Migration c7d8e9f0a1b3 (a job's learned company link, spec 040).

Offline Postgres SQL only — never a real database (see
tests/test_migration_email_sync.py). The SQLite round trip is covered by the
chain in tests/test_migration_scout_review.py reaching head.
"""

from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "b6c7d8e9f0a2", "c7d8e9f0a1b3"


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert (
        "ALTER TABLE saved_jobs ADD COLUMN apply_url_learned BOOLEAN DEFAULT false "
        "NOT NULL" in up
    )
    # Additive: nothing rewritten or dropped.
    assert "DROP COLUMN" not in up and "UPDATE saved_jobs" not in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP COLUMN apply_url_learned" in down
