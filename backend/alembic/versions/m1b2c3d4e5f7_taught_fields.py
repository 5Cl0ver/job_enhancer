"""taught_fields — boxes the user pointed at and taught (spec 017)

Revision ID: m1b2c3d4e5f7
Revises: l0a1b2c3d4e6
Create Date: 2026-11-23

Job Catcher's "Point at a box": a box the scanner couldn't place is taught
once by the user and filled by itself next time, on every computer. Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "m1b2c3d4e5f7"
down_revision = "l0a1b2c3d4e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "taught_fields",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("site", sa.String(255), nullable=False),
        sa.Column("fingerprint", sa.JSON(), nullable=False),
        sa.Column("profile_key", sa.String(40), nullable=True),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index("ix_taught_fields_user_id", "taught_fields", ["user_id"])
    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE taught_fields ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_taught_fields_user_id", table_name="taught_fields")
    op.drop_table("taught_fields")
