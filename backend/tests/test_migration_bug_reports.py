"""Migration a5b6c7d8e9f1 (Bugs & ideas; spec 032): the 4 tables, past run
problems brought in once with their status mapped, and the 5 starting entries.

A SQLite temp file stamped at the previous revision, plus offline Postgres SQL —
never a real database (see tests/test_migration_email_sync.py).
"""

import json
import sqlite3
import uuid

from app.services.bug_reports import run_fingerprint
from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "z4c5d6e7f8a0", "a5b6c7d8e9f1"
NEW = {"bug_reports", "bug_report_events", "bug_report_links", "bug_report_shots"}
RUN1, RUN2, JOB1, JOB2 = (uuid.uuid4().hex for _ in range(4))
PAGE = "https://acme.wd1.myworkdayjobs.com/apply/1"


def _p(what, kind, status, at, count=1, **more):
    return {
        "id": uuid.uuid4().hex[:10],
        "at": at,
        "kind": kind,
        "what": what,
        "page": PAGE,
        "site": "acme.wd1.myworkdayjobs.com",
        "count": count,
        "status": status,
        "job": "IT Engineer at Northwind Labs",
        "job_catcher": "0.44.0",
        "playbook": "2026.11.30",
        **more,
    }


def _db(tmp_path):
    db = tmp_path / "bugs.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE users (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE saved_jobs (id CHAR(32) PRIMARY KEY);"
        "CREATE TABLE apply_runs (id CHAR(32) PRIMARY KEY,"
        " saved_job_id CHAR(32) NOT NULL, problems JSON DEFAULT '[]' NOT NULL);"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
    )
    con.execute("INSERT INTO saved_jobs VALUES (?), (?)", [JOB1, JOB2])
    run1 = [
        _p("Said no résumé box", "job_catcher", "open", "2026-11-20T10:00:00+00:00"),
        _p("Lost the tab", "tab", "fixed", "2026-11-20T11:00:00+00:00", count=2),
        _p("", "fill", "open", "2026-11-20T11:00:00+00:00"),  # nothing said
    ]
    run2 = [
        _p("Said no résumé box", "job_catcher", "open", "2026-11-22T09:00:00+00:00"),
        _p("Phone box wrong", "fill", "ignored", "2026-11-22T09:30:00+00:00"),
        # From before pages were kept: no page, no site, no time.
        {"id": "old1", "kind": "other", "what": "Got stuck", "count": 1},
    ]
    con.execute(
        "INSERT INTO apply_runs VALUES (?, ?, ?), (?, ?, ?)",
        [RUN1, JOB1, json.dumps(run1), RUN2, JOB2, json.dumps(run2)],
    )
    con.commit()
    con.close()
    return db


def _reports(db):
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("SELECT * FROM bug_reports")]
    con.close()
    return rows


def test_round_trip_with_old_problems_and_starting_entries(tmp_path):
    db = _db(tmp_path)
    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    con.close()
    assert tables >= NEW
    rows = _reports(db)

    seeds = [r for r in rows if r["seed_key"]]
    assert len(seeds) == 5
    assert sorted(r["type"] for r in seeds) == ["bug", "bug", "bug", "idea", "idea"]
    assert {r["source"] for r in seeds} == {"owner"}
    assert {r["status"] for r in seeds} == {"new"}
    ideas = [r for r in seeds if r["type"] == "idea"]
    assert all(r["severity"] is None for r in ideas)
    by_title = {r["title"]: r for r in seeds}
    assert by_title["The app doesn't make it obvious when Job Catcher is out of date"][
        "section"
    ] == ("job_catcher")
    assert by_title["Fill everything, fix at the end"]["section"] == "apply"

    old = {r["title"]: r for r in rows if r["source"] == "run"}
    assert set(old) == {
        "Said no résumé box",
        "Lost the tab",
        "Phone box wrong",
        "Got stuck",
    }
    stuck = old["Got stuck"]
    assert (stuck["place"], stuck["status"], stuck["section"]) == (None, "new", "apply")
    assert stuck["fingerprint"] == run_fingerprint("apply", "other", "", "Got stuck")
    assert json.loads(stuck["context"]) == {}
    jc = old["Said no résumé box"]
    # The same problem in two runs is one report, counted twice, linked to the
    # latest run and job.
    assert (jc["section"], jc["status"], jc["count"]) == ("job_catcher", "new", 2)
    assert (jc["run_id"], jc["job_id"]) == (RUN2, JOB2)
    assert jc["fingerprint"] == run_fingerprint(
        "job_catcher", "job_catcher", "acme.wd1.myworkdayjobs.com", "Said no résumé box"
    )
    assert json.loads(jc["context"]) == {
        "job_catcher": "0.44.0",
        "playbook": "2026.11.30",
    }
    assert jc["first_seen"].startswith("2026-11-20")
    assert jc["last_seen"].startswith("2026-11-22")
    tab = old["Lost the tab"]
    assert (tab["section"], tab["status"], tab["count"], tab["run_id"]) == (
        "apply",
        "fixed",
        2,
        RUN1,
    )
    assert old["Phone box wrong"]["status"] == "wont_fix"
    assert {r["severity"] for r in old.values()} == {"major"}
    assert "Northwind" not in json.dumps(rows)  # job text isn't copied in

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    kept = json.loads(
        con.execute("SELECT problems FROM apply_runs WHERE id = ?", [RUN1]).fetchone()[
            0
        ]
    )
    con.close()
    assert not NEW & tables
    assert len(kept) == 3  # the runs keep their problems

    # Up again: the starting entries are there once, not twice.
    _ok(_alembic(db, "upgrade", HEAD))
    assert len([r for r in _reports(db) if r["seed_key"]]) == 5


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    for table in NEW:
        assert f"CREATE TABLE {table}" in up
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in up
    assert "ON DELETE CASCADE" in up and "ON DELETE SET NULL" in up
    assert up.count("INSERT INTO bug_reports") == 5
    assert "CREATE UNIQUE INDEX ix_bug_reports_fingerprint" in up
    assert "'032-review-repeats'" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    for table in NEW:
        assert f"DROP TABLE {table}" in down
