"""Bugs & ideas: one inbox for every bug and idea (spec 032)

Revision ID: a5b6c7d8e9f1
Revises: z4c5d6e7f8a0
Create Date: 2026-11-25

- bug_reports: one bug or idea each, in one format, whatever its source. No
  user column: a caught report never says who hit it.
- bug_report_events: what happened to a report (seen, status, edit, note,
  merge, split, link, unlink), append-only.
- bug_report_links: "related to" pairs, stored once with a_id < b_id.
- bug_report_shots: screenshots as bytes (their routes come in part B).

Data:
- The problems Claude reported in past Apply with Claude runs (spec 030,
  apply_runs.problems) are brought in once: open -> new, fixed -> fixed,
  ignored -> wont_fix, linked to their run and job. The same problem in
  several runs becomes one report with their counts added up. Only online:
  offline SQL can't read the runs.
- The 5 starting entries, each with a unique seed_key, added once.
Additive; downgrade drops the 4 tables (the runs keep their problems).
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime
from urllib.parse import urlsplit

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import context, op

revision = "a5b6c7d8e9f1"
down_revision = "z4c5d6e7f8a0"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_KINDS = ("fill", "job_catcher", "tab", "resume", "site", "other")
_STATUS = {"open": "new", "fixed": "fixed", "ignored": "wont_fix"}

SEEDS = [
    {
        "seed_key": "032-claude-stops",
        "type": "bug",
        "section": "apply",
        "severity": "major",
        "title": "Claude stops at random after starting from a job listing page",
        "actual": (
            "The start line was pasted while on the job listing. Claude moved "
            "to the right page, then the app said it had stopped, and it had "
            "to be restarted by hand."
        ),
        "expected": "Claude keeps going after it moves to the application page.",
    },
    {
        "seed_key": "032-job-catcher-out-of-date",
        "type": "bug",
        "section": "job_catcher",
        "severity": "major",
        "title": "The app doesn't make it obvious when Job Catcher is out of date",
        "actual": (
            "A computer stayed on 0.42.0 while 0.44.0 was out, so fixed bugs "
            'kept happening. Only a small "hasn\'t checked in lately" line '
            "showed."
        ),
        "expected": "The app says plainly when Job Catcher is out of date.",
    },
    {
        "seed_key": "032-fill-then-fix",
        "type": "idea",
        "section": "apply",
        "severity": None,
        "title": "Fill everything, fix at the end",
        "actual": (
            "One growing list of every field across all pages. Taps on a "
            "field are saved as fixes for later instead of being sent to "
            "Claude mid-fill. Two modes: Page by page (the default: pause "
            "after each page, then Continue) and Keep going. Claude uses its "
            "best judgment on unknown required fields and marks them. The "
            "owner reviews everything at the end, then Claude applies the "
            "fixes."
        ),
        "expected": "",
    },
    {
        "seed_key": "032-real-choices",
        "type": "idea",
        "section": "apply",
        "severity": None,
        "title": "Show the form's real choices when I change an answer",
        "actual": (
            "Tapping a dropdown or radio question (for example veteran status) "
            "to change it opens a free text box. It should show the choices "
            "the form itself offers, to pick from."
        ),
        "expected": "",
    },
    {
        "seed_key": "032-review-repeats",
        "type": "bug",
        "section": "apply",
        "severity": "major",
        "title": "The final review repeats the same questions",
        "actual": (
            "The review page lists the same question more than once (for "
            "example veteran status under Page 4 and again under Page 5), "
            "which is confusing."
        ),
        "expected": "Each question shows once, with its latest answer.",
    },
]


def _reports_table(offline: bool) -> sa.Table:
    # Offline SQL can't render JSON values: they go in as JSON text, which
    # Postgres reads as json.
    js = sa.Text if offline else sa.JSON
    return sa.table(
        "bug_reports",
        sa.column("id", _UUID),
        sa.column("type", sa.String),
        sa.column("title", sa.String),
        sa.column("section", sa.String),
        sa.column("kind", sa.String),
        sa.column("place", sa.String),
        sa.column("steps", js),
        sa.column("actual", sa.Text),
        sa.column("expected", sa.Text),
        sa.column("severity", sa.String),
        sa.column("confidence", sa.String),
        sa.column("source", sa.String),
        sa.column("status", sa.String),
        sa.column("needs_check", sa.Boolean),
        sa.column("pinned", sa.Boolean),
        sa.column("fingerprint", sa.String),
        sa.column("count", sa.Integer),
        sa.column("first_seen", sa.DateTime(timezone=True)),
        sa.column("last_seen", sa.DateTime(timezone=True)),
        sa.column("context", js),
        sa.column("run_id", _UUID),
        sa.column("job_id", _UUID),
        sa.column("seed_key", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )


def _row(now: datetime, **cols) -> dict:
    return {
        "id": uuid.uuid4(),
        "kind": "manual",
        "place": None,
        "steps": [],
        "expected": "",
        "confidence": "sure",
        "source": "owner",
        "status": "new",
        "needs_check": False,
        "pinned": False,
        "fingerprint": None,
        "count": 1,
        "first_seen": now,
        "last_seen": now,
        "context": {},
        "run_id": None,
        "job_id": None,
        "seed_key": None,
        "created_at": now,
        "updated_at": now,
        **cols,
    }


# The same as services/bug_reports.run_fingerprint (a test holds them equal),
# copied so this migration never changes when the app does.
def _fingerprint(section: str, kind: str, place: str) -> str:
    return hashlib.sha1(f"{section}|{kind}|{place}".encode()).hexdigest()[:16]


def _host(url: str | None) -> str:
    try:
        host = urlsplit((url or "").strip()).hostname
    except ValueError:
        return ""
    return host.lower().removeprefix("www.") if host else ""


def _when(value) -> datetime | None:
    try:
        at = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _old_problems(bind, now: datetime) -> list[dict]:
    """Every past run's problems, one report per fingerprint."""
    runs = sa.table(
        "apply_runs",
        sa.column("id", _UUID),
        sa.column("saved_job_id", _UUID),
        sa.column("problems", sa.JSON),
    )
    found: dict[str, dict] = {}
    for run_id, job_id, problems in bind.execute(
        sa.select(runs.c.id, runs.c.saved_job_id, runs.c.problems)
    ):
        for p in problems or []:
            if not isinstance(p, dict) or not str(p.get("what") or "").strip():
                continue
            what = str(p["what"]).strip()
            kind = p.get("kind") if p.get("kind") in _KINDS else "other"
            section = "job_catcher" if kind in ("job_catcher", "resume") else "apply"
            host = p.get("site") or _host(p.get("page"))
            fp = _fingerprint(section, kind, f"{host}|{what[:60].lower()}")
            at = _when(p.get("at")) or now
            count = max(1, int(p.get("count") or 1))
            row = found.get(fp)
            if row is None:
                found[fp] = _row(
                    now,
                    type="bug",
                    title=what[:140],
                    section=section,
                    kind=kind,
                    place=(p.get("page") or host or None),
                    actual=what,
                    severity="major",
                    source="run",
                    status=_STATUS.get(p.get("status"), "new"),
                    fingerprint=fp,
                    count=count,
                    first_seen=at,
                    last_seen=at,
                    context={
                        k: str(p[k])[:60]
                        for k in ("job_catcher", "playbook")
                        if p.get(k)
                    },
                    run_id=run_id,
                    job_id=job_id,
                )
                continue
            row["count"] += count
            row["first_seen"] = min(row["first_seen"], at)
            if at >= row["last_seen"]:
                # The latest run's status, page and links win.
                row.update(
                    last_seen=at,
                    status=_STATUS.get(p.get("status"), "new"),
                    place=p.get("page") or row["place"],
                    run_id=run_id,
                    job_id=job_id,
                )
    return list(found.values())


def upgrade() -> None:
    now_col = {"nullable": False, "server_default": sa.func.now()}
    op.create_table(
        "bug_reports",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column("title", sa.String(140), nullable=False),
        sa.Column("section", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("place", sa.String(300)),
        sa.Column("box", sa.String(200)),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("actual", sa.Text(), nullable=False),
        sa.Column("expected", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(10)),
        sa.Column("confidence", sa.String(10), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column(
            "needs_check", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("fixed_in", sa.String(60)),
        sa.Column("came_back_at", sa.DateTime(timezone=True)),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("fingerprint", sa.String(16)),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_seen", sa.DateTime(timezone=True), **now_col),
        sa.Column("last_seen", sa.DateTime(timezone=True), **now_col),
        sa.Column("context", sa.JSON(), nullable=False),
        sa.Column("run_id", _UUID, sa.ForeignKey("apply_runs.id", ondelete="SET NULL")),
        sa.Column("job_id", _UUID, sa.ForeignKey("saved_jobs.id", ondelete="SET NULL")),
        sa.Column("seed_key", sa.String(40), unique=True),
        sa.Column(
            "merged_into_id",
            _UUID,
            sa.ForeignKey("bug_reports.id", ondelete="SET NULL"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), **now_col),
        sa.Column("updated_at", sa.DateTime(timezone=True), **now_col),
    )
    op.create_index("ix_bug_reports_status_type", "bug_reports", ["status", "type"])
    op.create_index("ix_bug_reports_section", "bug_reports", ["section"])
    op.create_index(
        "ix_bug_reports_fingerprint", "bug_reports", ["fingerprint"], unique=True
    )
    op.create_index("ix_bug_reports_last_seen", "bug_reports", ["last_seen"])

    op.create_table(
        "bug_report_events",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "report_id",
            _UUID,
            sa.ForeignKey("bug_reports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("actor", sa.String(10), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), **now_col),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index(
        "ix_bug_report_events_report_id", "bug_report_events", ["report_id"]
    )

    op.create_table(
        "bug_report_links",
        sa.Column(
            "a_id",
            _UUID,
            sa.ForeignKey("bug_reports.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "b_id",
            _UUID,
            sa.ForeignKey("bug_reports.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), **now_col),
    )
    op.create_index("ix_bug_report_links_b_id", "bug_report_links", ["b_id"])

    op.create_table(
        "bug_report_shots",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "report_id",
            _UUID,
            sa.ForeignKey("bug_reports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mime", sa.String(20), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), **now_col),
    )
    op.create_index("ix_bug_report_shots_report_id", "bug_report_shots", ["report_id"])

    # The table is new, so the seeds go in exactly once; seed_key is unique,
    # and a deleted one never comes back (this never runs again).
    now = datetime.now(tz=UTC)
    offline = context.is_offline_mode()
    rows = [] if offline else _old_problems(op.get_bind(), now)
    rows += [_row(now, **seed) for seed in SEEDS]
    if offline:
        rows = [
            {**r, "steps": json.dumps(r["steps"]), "context": json.dumps(r["context"])}
            for r in rows
        ]
    op.bulk_insert(_reports_table(offline), rows)

    if op.get_bind().dialect.name == "postgresql":
        for table in (
            "bug_reports",
            "bug_report_events",
            "bug_report_links",
            "bug_report_shots",
        ):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_bug_report_shots_report_id", table_name="bug_report_shots")
    op.drop_table("bug_report_shots")
    op.drop_index("ix_bug_report_links_b_id", table_name="bug_report_links")
    op.drop_table("bug_report_links")
    op.drop_index("ix_bug_report_events_report_id", table_name="bug_report_events")
    op.drop_table("bug_report_events")
    for name in ("last_seen", "fingerprint", "section", "status_type"):
        op.drop_index(f"ix_bug_reports_{name}", table_name="bug_reports")
    op.drop_table("bug_reports")
