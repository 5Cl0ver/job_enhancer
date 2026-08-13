"""add users.claude_project_url — shared Claude Project link

One source of truth for the user's Claude Project so the browser extension and
the web app both open drafts/research there, and editing it in either place
updates both.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-08-11
"""

import sqlalchemy as sa
from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("claude_project_url", sa.String(length=2048), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "claude_project_url")
