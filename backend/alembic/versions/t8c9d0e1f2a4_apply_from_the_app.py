"""Apply from the app (spec 023)

Revision ID: t8c9d0e1f2a4
Revises: s7b8c9d0e1f3
Create Date: 2026-11-25

- apply_runs.messages: the conversation between the user and Claude.
- apply_runs.claude_at: Claude's last connector call ("Claude stopped").
- job_listings title/company/location: HTML entities ("&amp;") turned back
  into plain words, and their dedup keys (title_normalized,
  company_normalized, content_hash) recomputed to match, so the same job saved
  again with plain words is still the same job. A hash another row already
  has is left as it was (the column is unique). New saves are cleaned by the
  model and by dedup.normalize.
Additive, plus a data fix the downgrade leaves in place (the plain words are
right either way).
"""

import hashlib
import html
import re

import sqlalchemy as sa

from alembic import op

revision = "t8c9d0e1f2a4"
down_revision = "s7b8c9d0e1f3"
branch_labels = None
depends_on = None

# Frozen copies (a migration never changes with the app's code).
_ENTITY = re.compile(r"&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);")
_NON_ALPHA = re.compile(r"[^a-z0-9\s]")
_WHITESPACE = re.compile(r"\s+")


def _unescape(value):
    if not isinstance(value, str):
        return value
    for _ in range(3):
        if not _ENTITY.search(value):
            break
        value = html.unescape(value)
    return value.replace("\xa0", " ")


def _norm(text):
    text = _unescape(text or "").lower()
    return _WHITESPACE.sub(" ", _NON_ALPHA.sub(" ", text)).strip()


def _hash(title, company, location):
    raw = f"{_norm(title)}|{_norm(company)}|{_norm(location)}"
    return hashlib.sha256(raw.encode()).hexdigest()


def upgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.add_column(
            sa.Column("messages", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(
            sa.Column("claude_at", sa.DateTime(timezone=True), nullable=True)
        )

    bind = op.get_bind()
    if op.get_context().as_sql:
        # Offline SQL (no rows to read): nothing to fix.
        return
    rows = bind.execute(
        sa.text(
            "SELECT id, title, company, location FROM job_listings "
            "WHERE title LIKE '%&%;%' OR company LIKE '%&%;%' "
            "OR location LIKE '%&%;%'"
        )
    ).fetchall()
    taken = {
        h for (h,) in bind.execute(sa.text("SELECT content_hash FROM job_listings"))
    }
    for row_id, title, company, location in rows:
        title, company, location = (
            _unescape(title),
            _unescape(company),
            _unescape(location),
        )
        values = {
            "id": row_id,
            "title": title,
            "company": company,
            "location": location,
            "tn": _norm(title),
            "cn": _norm(company),
        }
        new_hash = _hash(title, company, location)
        if new_hash not in taken:
            taken.add(new_hash)
            values["hash"] = new_hash
            bind.execute(
                sa.text(
                    "UPDATE job_listings SET title = :title, company = :company, "
                    "location = :location, title_normalized = :tn, "
                    "company_normalized = :cn, content_hash = :hash WHERE id = :id"
                ),
                values,
            )
        else:
            bind.execute(
                sa.text(
                    "UPDATE job_listings SET title = :title, company = :company, "
                    "location = :location, title_normalized = :tn, "
                    "company_normalized = :cn WHERE id = :id"
                ),
                values,
            )


def downgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.drop_column("claude_at")
        batch.drop_column("messages")
