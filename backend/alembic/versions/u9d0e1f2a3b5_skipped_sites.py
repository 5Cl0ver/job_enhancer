"""Sites to skip (spec 024)

Revision ID: u9d0e1f2a3b5
Revises: t8c9d0e1f2a4
Create Date: 2026-11-25

- skipped_sites: the sites a user never wants jobs from, one row per user and
  site (a plain host such as "learn4good.com"). Claude Scout leaves them out
  and Apply with Claude never applies through them.
Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "u9d0e1f2a3b5"
down_revision = "t8c9d0e1f2a4"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "skipped_sites",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "user_id",
            _UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("user_id", "host", name="uq_skipped_sites_user_host"),
    )
    op.create_index("ix_skipped_sites_user_id", "skipped_sites", ["user_id"])

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE skipped_sites ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_skipped_sites_user_id", table_name="skipped_sites")
    op.drop_table("skipped_sites")
