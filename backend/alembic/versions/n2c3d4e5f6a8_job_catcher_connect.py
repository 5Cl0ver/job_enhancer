"""Job Catcher connect, passes and installs (spec 019)

Revision ID: n2c3d4e5f6a8
Revises: m1b2c3d4e5f7
Create Date: 2026-11-23

One-press Connect for Job Catcher: short-lived connect requests, the passes a
connected Job Catcher holds (hashes only), and which versions said hello.
Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "n2c3d4e5f6a8"
down_revision = "m1b2c3d4e5f7"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)


def _user_fk(nullable: bool = False) -> sa.Column:
    return sa.Column(
        "user_id",
        _UUID,
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=nullable,
    )


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=None if nullable else sa.func.now(),
    )


def upgrade() -> None:
    op.create_table(
        "extension_tokens",
        sa.Column("id", _UUID, primary_key=True),
        _user_fk(),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("install_id", sa.String(64), nullable=True),
        sa.Column("browser", sa.String(64), nullable=True),
        _ts("created_at"),
        _ts("last_used_at", nullable=True),
        _ts("revoked_at", nullable=True),
    )
    op.create_index("ix_extension_tokens_user_id", "extension_tokens", ["user_id"])

    op.create_table(
        "extension_connect_requests",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("code", sa.String(9), nullable=False, unique=True),
        sa.Column("poll_token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("proof_hash", sa.String(64), nullable=False),
        _user_fk(nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _ts("created_at"),
    )
    op.create_index(
        "ix_extension_connect_requests_created_at",
        "extension_connect_requests",
        ["created_at"],
    )
    op.create_index(
        "ix_extension_connect_requests_status_expires",
        "extension_connect_requests",
        ["status", "expires_at"],
    )

    op.create_table(
        "extension_installs",
        sa.Column("id", _UUID, primary_key=True),
        _user_fk(),
        sa.Column("install_id", sa.String(64), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("browser", sa.String(64), nullable=True),
        _ts("first_seen_at"),
        _ts("last_seen_at"),
        sa.UniqueConstraint("user_id", "install_id"),
    )
    op.create_index("ix_extension_installs_user_id", "extension_installs", ["user_id"])

    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        for table in (
            "extension_tokens",
            "extension_connect_requests",
            "extension_installs",
        ):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_extension_installs_user_id", table_name="extension_installs")
    op.drop_table("extension_installs")
    op.drop_index(
        "ix_extension_connect_requests_status_expires",
        table_name="extension_connect_requests",
    )
    op.drop_index(
        "ix_extension_connect_requests_created_at",
        table_name="extension_connect_requests",
    )
    op.drop_table("extension_connect_requests")
    op.drop_index("ix_extension_tokens_user_id", table_name="extension_tokens")
    op.drop_table("extension_tokens")
