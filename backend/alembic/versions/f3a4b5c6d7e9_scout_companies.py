"""Claude Scout looks at local companies' own careers pages.

scout_companies: one row per user and company website a "Local companies"
search checked, with when, how often and what was there (openings, none, no
careers page), so each run mostly visits new companies and only goes back to
one after a week. Names and links only, never job text.

A new table only: nothing existing changes. The two new search sources
("google_jobs", "local_companies") fit the existing source columns.

Revision ID: f3a4b5c6d7e9
Revises: e2f3a4b5c6d8
Create Date: 2026-11-20
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f3a4b5c6d7e9"
down_revision = "e2f3a4b5c6d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scout_companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("website", sa.String(500), nullable=True),
        sa.Column("careers_url", sa.String(2000), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("times_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_result", sa.String(20), nullable=True),
        sa.Column(
            "never_check", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "key", name="uq_scout_company_user_key"),
    )
    op.create_index("ix_scout_companies_user_id", "scout_companies", ["user_id"])
    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE scout_companies ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_scout_companies_user_id", table_name="scout_companies")
    op.drop_table("scout_companies")
