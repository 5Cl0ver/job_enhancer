"""Onboarding progress per account (spec 019 part B)

Revision ID: q5f6a7b8c9d1
Revises: p4e5f6a7b8c0
Create Date: 2026-11-24

One row per user: how far the Welcome got, whether the profile was reviewed,
whether the Getting started card is hidden, and when Claude was last seen
calling the connector. Every existing user is backfilled as done, so nobody
already set up is ever sent through the Welcome. Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "q5f6a7b8c9d1"
down_revision = "p4e5f6a7b8c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_onboarding",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "welcome_step", sa.SmallInteger(), nullable=False, server_default="0"
        ),
        sa.Column("welcome_done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("profile_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "checklist_hidden", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("claude_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # Everyone who already has an account is past the Welcome (FR-006).
    op.execute(
        "INSERT INTO user_onboarding (user_id, welcome_step, welcome_done_at) "
        "SELECT id, 4, CURRENT_TIMESTAMP FROM users"
    )
    # …and whoever already filled in a profile has, in effect, checked it.
    op.execute(
        "UPDATE user_onboarding SET profile_reviewed_at = CURRENT_TIMESTAMP "
        "WHERE user_id IN (SELECT user_id FROM application_profiles "
        "WHERE first_name IS NOT NULL AND first_name <> '')"
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("user_onboarding")
