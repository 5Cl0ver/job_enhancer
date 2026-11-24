"""Fair use and real "last active" (spec 019 part C)

Revision ID: r6a7b8c9d0e2
Revises: q5f6a7b8c9d1
Create Date: 2026-11-24

- usage_counters: per person, per kind, per Pacific day (plus the one shared
  monthly JSearch row, user_id NULL). Unique with NULLS NOT DISTINCT on
  Postgres so the shared row stays one row.
- app_settings: owner-editable settings (the allowance numbers).
- users.last_active_at: real use, backfilled from updated_at.
Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "r6a7b8c9d0e2"
down_revision = "q5f6a7b8c9d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_counters",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            primary_key=True,
            autoincrement=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("period", sa.String(10), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint(
            "user_id",
            "kind",
            "period",
            name="uq_usage_counters_user_kind_period",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index("ix_usage_counters_user_id", "usage_counters", ["user_id"])
    op.create_index("ix_usage_counters_period", "usage_counters", ["period"])

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True)
        )
    op.execute("UPDATE users SET last_active_at = updated_at")

    if op.get_bind().dialect.name == "postgresql":
        for table in ("usage_counters", "app_settings"):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("last_active_at")
    op.drop_table("app_settings")
    op.drop_index("ix_usage_counters_period", table_name="usage_counters")
    op.drop_index("ix_usage_counters_user_id", table_name="usage_counters")
    op.drop_table("usage_counters")
