"""Apply from the app (spec 023)

Revision ID: t8c9d0e1f2a4
Revises: s7b8c9d0e1f3
Create Date: 2026-11-25

- apply_runs.messages: the conversation between the user and Claude.
- apply_runs.claude_at: Claude's last connector call ("Claude stopped").
- job_listings title/company/location: HTML entities ("&amp;") turned back
  into plain words; new saves are cleaned by the model.
Additive, plus a data fix the downgrade leaves in place (the plain words are
right either way).
"""

import sqlalchemy as sa

from alembic import op

revision = "t8c9d0e1f2a4"
down_revision = "s7b8c9d0e1f3"
branch_labels = None
depends_on = None

# &amp; last, so "&amp;lt;" becomes "&lt;" and not "<".
_ENTITIES = (
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&quot;", '"'),
    ("&#39;", "'"),
    ("&#x27;", "'"),
    ("&apos;", "'"),
    ("&nbsp;", " "),
    ("&amp;", "&"),
)


def _plain(column: str) -> str:
    expr = column
    for entity, char in _ENTITIES:
        quoted = char.replace("'", "''")
        expr = f"REPLACE({expr}, '{entity}', '{quoted}')"
    return expr


def upgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.add_column(
            sa.Column("messages", sa.JSON(), nullable=False, server_default="[]")
        )
        batch.add_column(
            sa.Column("claude_at", sa.DateTime(timezone=True), nullable=True)
        )
    for column in ("title", "company", "location"):
        op.execute(
            f"UPDATE job_listings SET {column} = {_plain(column)} "
            f"WHERE {column} LIKE '%&%;%'"
        )


def downgrade() -> None:
    with op.batch_alter_table("apply_runs") as batch:
        batch.drop_column("claude_at")
        batch.drop_column("messages")
