"""Migration q5f6a7b8c9d1 (onboarding progress, spec 019 part B).

A SQLite temp file stamped at the previous revision, plus offline Postgres SQL —
never a real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "p4e5f6a7b8c0", "q5f6a7b8c9d1"
SET_UP, FRESH = "a" * 32, "b" * 32


def test_existing_users_are_backfilled_as_done(tmp_path):
    db = tmp_path / "onboarding.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE application_profiles (user_id CHAR(32), first_name VARCHAR(100));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        f"INSERT INTO users VALUES ('{SET_UP}'), ('{FRESH}');"
        f"INSERT INTO application_profiles VALUES ('{SET_UP}', 'Wren'), ('{FRESH}', '');"
    )
    con.commit()
    con.close()

    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    rows = dict(
        (uid, (step, done, reviewed))
        for uid, step, done, reviewed in con.execute(
            "SELECT user_id, welcome_step, welcome_done_at IS NOT NULL,"
            " profile_reviewed_at IS NOT NULL FROM user_onboarding"
        )
    )
    con.close()
    # Nobody already here is sent through the Welcome; a filled profile counts.
    assert rows == {SET_UP: (4, 1, 1), FRESH: (4, 1, 0)}

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    con.close()
    assert "user_onboarding" not in tables


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "CREATE TABLE user_onboarding" in up
    assert "ON DELETE CASCADE" in up
    assert "ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE user_onboarding" in down
