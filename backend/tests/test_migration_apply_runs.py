"""Migration s7b8c9d0e1f3 (Apply with Claude; spec 022 part B).

A SQLite temp file stamped at the previous revision, plus offline Postgres SQL —
never a real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "r6a7b8c9d0e2", "s7b8c9d0e1f3"
NEW = {"apply_runs", "apply_requests", "apply_photos", "profile_facts"}


def test_round_trip_keeps_resumes(tmp_path):
    db = tmp_path / "apply.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE saved_jobs (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE generated_documents (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE resumes (id CHAR(32) PRIMARY KEY, filename VARCHAR(255));"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        "INSERT INTO resumes VALUES ('" + "a" * 32 + "', 'me.pdf');"
    )
    con.commit()
    con.close()

    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert tables >= NEW
    assert con.execute(
        "SELECT filename, is_master, document_id FROM resumes"
    ).fetchone() == (
        "me.pdf",
        0,
        None,
    )
    con.close()

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    cols = {r[1] for r in con.execute("PRAGMA table_info(resumes)")}
    assert con.execute("SELECT filename FROM resumes").fetchone() == ("me.pdf",)
    con.close()
    assert not NEW & tables
    assert not {"is_master", "document_id"} & cols


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    for table in NEW:
        assert f"CREATE TABLE {table}" in up
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in up
    assert "ON DELETE CASCADE" in up
    assert "ADD COLUMN is_master BOOLEAN DEFAULT false NOT NULL" in up
    assert "fk_resumes_document_id" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP TABLE apply_runs" in down
