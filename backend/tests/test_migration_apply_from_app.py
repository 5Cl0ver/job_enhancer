"""Migration t8c9d0e1f2a4 (Apply from the app; spec 023).

A SQLite temp file stamped at the previous revision, plus offline Postgres SQL —
never a real database (see tests/test_migration_email_sync.py).
"""

import sqlite3

from app.services.dedup import job_content_hash, normalize
from tests.test_migration_email_sync import _alembic, _ok

PREV, HEAD = "s7b8c9d0e1f3", "t8c9d0e1f2a4"


def _key(title, company, location):
    return job_content_hash(normalize(title), normalize(company), normalize(location))


def test_round_trip_plain_titles_and_matching_keys(tmp_path):
    db = tmp_path / "apply2.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE apply_runs (id CHAR(32) PRIMARY KEY, status VARCHAR(20));"
        "CREATE TABLE job_listings (id CHAR(32) PRIMARY KEY, title VARCHAR(500),"
        " company VARCHAR(255), location VARCHAR(255), title_normalized VARCHAR(500),"
        " company_normalized VARCHAR(255), content_hash VARCHAR(64) UNIQUE);"
        "CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY);"
        f"INSERT INTO alembic_version VALUES ('{PREV}');"
        "INSERT INTO apply_runs VALUES ('" + "a" * 32 + "', 'filling');"
    )
    rows = [
        # escaped, keyed the old way ("amp" in its keys)
        (
            "b" * 32,
            "Microsoft 365 &amp; Copilot Administrator",
            "Ben &amp; Jerry&#39;s",
            "Austin, TX",
        ),
        ("c" * 32, "AT&T Field Tech", "AT&T", "Dallas"),
        # an escaped twin of a job already saved in plain words
        ("d" * 32, "AI &amp; Automation", "Acme", "Remote"),
        ("e" * 32, "AI & Automation", "Acme", "Remote"),
    ]
    for rid, t, c, loc in rows:
        old_t = " ".join(
            t.lower()
            .replace("&", " ")
            .replace(";", " ")
            .replace("#", " ")
            .replace("'", " ")
            .split()
        )
        old_c = " ".join(
            c.lower()
            .replace("&", " ")
            .replace(";", " ")
            .replace("#", " ")
            .replace("'", " ")
            .split()
        )
        con.execute(
            "INSERT INTO job_listings VALUES (?,?,?,?,?,?,?)",
            (
                rid,
                t,
                c,
                loc,
                old_t,
                old_c,
                f"old-{rid}" if "&amp;" in t or "&amp;" in c else _key(t, c, loc),
            ),
        )
    con.commit()
    con.close()

    _ok(_alembic(db, "upgrade", HEAD))
    con = sqlite3.connect(db)
    got = {
        r[0]: r[1:]
        for r in con.execute(
            "SELECT id, title, company, title_normalized, company_normalized, content_hash FROM job_listings"
        )
    }
    title, company, tn, cn, h = got["b" * 32]
    assert (title, company) == (
        "Microsoft 365 & Copilot Administrator",
        "Ben & Jerry's",
    )
    assert (tn, cn) == (normalize(title), normalize(company))
    assert h == _key(title, company, "Austin, TX")  # a plain-words save finds it
    assert got["c" * 32][:2] == ("AT&T Field Tech", "AT&T")
    # The twin: plain words, but its hash is the saved job's: left as it was.
    assert got["d" * 32][0] == "AI & Automation"
    assert got["d" * 32][4] == "old-" + "d" * 32
    assert con.execute("SELECT messages, claude_at FROM apply_runs").fetchone() == (
        "[]",
        None,
    )
    con.close()

    _ok(_alembic(db, "downgrade", PREV))
    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(apply_runs)")}
    con.close()
    assert not {"messages", "claude_at"} & cols


def test_postgres_offline_sql():
    url = "postgresql+asyncpg://offline:offline@offline.invalid:5432/none"
    up = _ok(_alembic(None, "upgrade", f"{PREV}:{HEAD}", "--sql", url=url)).stdout
    assert "ADD COLUMN messages JSON DEFAULT '[]' NOT NULL" in up
    assert "ADD COLUMN claude_at TIMESTAMP WITH TIME ZONE" in up
    down = _ok(_alembic(None, "downgrade", f"{HEAD}:{PREV}", "--sql", url=url)).stdout
    assert "DROP COLUMN messages" in down


def test_dedup_keys_ignore_html_entities():
    assert normalize("Microsoft 365 &amp; Copilot") == normalize(
        "Microsoft 365 & Copilot"
    )
    assert _key("AI &amp; Automation", "H&amp;M", "A&nbsp;B") == _key(
        "AI & Automation", "H&M", "A B"
    )
