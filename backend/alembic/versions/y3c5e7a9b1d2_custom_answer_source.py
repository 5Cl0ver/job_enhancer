"""Answers learned from Claude's runs (spec 029)

Revision ID: y3c5e7a9b1d2
Revises: x2a3b4c5d6e8
Create Date: 2026-11-25

- custom_answers.source: where a remembered answer came from. "claude" = an
  answer Claude gave in Apply with Claude that the user approved and sent;
  null = the user's own (typed, taught or edited). Additive.
"""

import sqlalchemy as sa

from alembic import op

revision = "y3c5e7a9b1d2"
down_revision = "x2a3b4c5d6e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("custom_answers", sa.Column("source", sa.String(20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("custom_answers") as batch:
        batch.drop_column("source")
