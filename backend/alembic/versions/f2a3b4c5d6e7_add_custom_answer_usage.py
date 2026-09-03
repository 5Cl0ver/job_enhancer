"""add usage tracking to custom_answers (use_count, last_used_at)

Powers the Answer Library insights: how many times autofill reused each learned
answer, and when it was last used.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-03
"""

import sqlalchemy as sa

from alembic import op

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "custom_answers",
        sa.Column("use_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "custom_answers",
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("custom_answers", "last_used_at")
    op.drop_column("custom_answers", "use_count")
