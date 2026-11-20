"""Migration c0d1e2f3a4b6 (how each saved job got into My Jobs).

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

PREV, HEAD = "b9c0d1e2f3a5", "c0d1e2f3a4b6"


def _listing(con, source, url):
    lid = uuid.uuid4().hex
    con.execute(
        "INSERT INTO job_listings (id, source, apply_url) VALUES (?, ?, ?)",
        (lid, source, url),
    )
    return lid


def _job(con, listing_id):
    jid = uuid.uuid4().hex
    con.execute(
        "INSERT INTO saved_jobs (id, job_listing_id) VALUES (?, ?)", (jid, listing_id)
    )
    return jid


def _finding(con, run_id, user_id, job_id, outcome):
    con.execute(
        "INSERT INTO scout_findings (id, user_id, run_id, saved_job_id, source, url, "
        "url_key, company, title, company_key, title_key, fit_score, why_fit, gaps, "
        "outcome) VALUES (?, ?, ?, ?, 'linkedin', ?, ?, 'Vellacor', 'Admin', "
        "'vellacor', 'admin', 8, '', '', ?)",
        (
            uuid.uuid4().hex,
            user_id,
            run_id,
            job_id,
            f"https://jobs.example/{job_id}",
            job_id,
            outcome,
        ),
    )


class TestSavedJobOriginMigration:
    def _seed(self, db):
        """Jobs saved the old ways, on a database at the previous revision."""
        _ok(_alembic(db, "upgrade", PREV))
        con = sqlite3.connect(db)
        # The legacy test schema's saved_jobs/job_listings are bare; give them
        # the columns the backfill reads.
        con.execute("ALTER TABLE saved_jobs ADD COLUMN job_listing_id CHAR(32)")
        con.execute(
            "CREATE TABLE job_listings "
            "(id CHAR(32) PRIMARY KEY, source VARCHAR(20), apply_url VARCHAR(2000))"
        )
        user, run = uuid.uuid4().hex, uuid.uuid4().hex
        con.execute("INSERT INTO users (id) VALUES (?)", (user,))
        con.execute(
            "INSERT INTO scout_runs (id, user_id, criteria, playbook_version, status) "
            "VALUES (?, ?, '{}', '1', 'done')",
            (run, user),
        )
        board = "https://jobs.example/posting/1"
        jobs = {
            "scout": _job(con, _listing(con, "manual", board)),
            "passed": _job(con, _listing(con, "manual", board)),
            "yahoo": _job(
                con, _listing(con, "manual", "https://mail.yahoo.com/d/folders/1")
            ),
            "gmail": _job(
                con, _listing(con, "manual", "https://mail.google.com/mail/u/0/")
            ),
            "search": _job(con, _listing(con, "adzuna", board)),
            "typed": _job(con, _listing(con, "manual", board)),
            # A posting whose address merely mentions a mail site is not an email.
            "lookalike": _job(
                con,
                _listing(con, "manual", "https://jobs.example/?from=mail.yahoo.com"),
            ),
        }
        _finding(con, run, user, jobs["scout"], "saved")
        _finding(con, run, user, jobs["passed"], "duplicate")
        con.commit()
        con.close()
        return jobs

    def test_backfill_labels_only_what_is_certain(self, scout_db):  # noqa: F811
        jobs = self._seed(scout_db)
        _ok(_alembic(scout_db, "upgrade", HEAD))
        con = sqlite3.connect(scout_db)
        got = dict(con.execute("SELECT id, origin FROM saved_jobs").fetchall())
        con.close()
        assert got[jobs["scout"]] == "scout"
        assert got[jobs["yahoo"]] == "email"
        assert got[jobs["gmail"]] == "email"
        assert got[jobs["search"]] == "search"
        # Already in My Jobs when Scout came across it: Scout didn't save it.
        assert got[jobs["passed"]] is None
        assert got[jobs["typed"]] is None
        assert got[jobs["lookalike"]] is None

    def test_round_trip(self, scout_db):  # noqa: F811
        self._seed(scout_db)
        con = sqlite3.connect(scout_db)
        before = con.execute("SELECT COUNT(*) FROM saved_jobs").fetchone()[0]
        con.close()
        _ok(_alembic(scout_db, "upgrade", HEAD))
        _ok(_alembic(scout_db, "downgrade", PREV))
        con = sqlite3.connect(scout_db)
        assert "origin" not in _cols(con, "saved_jobs")
        assert {"job_listing_id", "track_id"} <= _cols(con, "saved_jobs")
        assert con.execute("SELECT COUNT(*) FROM saved_jobs").fetchone()[0] == before
        con.close()
        _ok(_alembic(scout_db, "upgrade", HEAD))

    def test_postgres_offline_sql(self):
        url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
        up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
        assert "ALTER TABLE saved_jobs ADD COLUMN origin VARCHAR(12)" in up
        assert "NOT NULL" not in up.split("ADD COLUMN origin")[1].split(";")[0]
        # Only the new column is written; nothing is dropped or deleted.
        assert up.count("UPDATE saved_jobs SET origin") == 3
        assert "DROP" not in up and "DELETE" not in up
        down = _ok(
            _alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)
        ).stdout
        assert "DROP COLUMN origin" in down
