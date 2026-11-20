"""Migration e2f3a4b5c6d8 (a saved job's own name).

Offline Postgres SQL only — never a real database (see
tests/test_migration_email_sync.py). The SQLite round trip is covered by the
chain in tests/test_migration_scout_review.py reaching head.
"""

from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "d1e2f3a4b5c7", "e2f3a4b5c6d8"


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    for col, kind in (
        ("custom_title", "VARCHAR(500)"),
        ("custom_company", "VARCHAR(255)"),
        ("custom_location", "VARCHAR(255)"),
        ("custom_apply_url", "TEXT"),
    ):
        assert f"ALTER TABLE saved_jobs ADD COLUMN {col} {kind}" in up
    # Nullable additions only: nothing rewritten, dropped or backfilled.
    assert "NOT NULL" not in up.split("ADD COLUMN custom_title")[1]
    assert "DROP COLUMN" not in up and "UPDATE saved_jobs" not in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    for col in (
        "custom_title",
        "custom_company",
        "custom_location",
        "custom_apply_url",
    ):
        assert f"DROP COLUMN {col}" in down
