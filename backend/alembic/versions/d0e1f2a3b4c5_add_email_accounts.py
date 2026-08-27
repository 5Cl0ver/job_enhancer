"""add email_accounts — connected inbox for email auto-status

Stores one connected mailbox per user (IMAP host/port + an encrypted
app-password) so the app can read application emails and update the tracker.
The secret is a Fernet token, never plaintext.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-08-16
"""

import sqlalchemy as sa

from alembic import op

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_accounts",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("email_address", sa.String(255), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column(
            "auth_type",
            sa.String(20),
            nullable=False,
            server_default="app_password",
        ),
        sa.Column("imap_host", sa.String(255), nullable=False),
        sa.Column("imap_port", sa.Integer(), nullable=False, server_default="993"),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="connected"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
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
    # Enable Row-Level Security so the table is deny-all to the public/anon role
    # (no policies = no access); the backend connects with a bypassing role. On
    # Supabase this is auto-enabled too, but doing it here makes the security
    # posture reproducible on any Postgres. Skipped on SQLite (tests).
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("email_accounts")
