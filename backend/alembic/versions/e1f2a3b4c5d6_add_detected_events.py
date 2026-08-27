"""add detected_events — inbox-derived pipeline updates pending review

One row per email the scanner confidently classified + matched to a saved job.
Holds the review state (pending/applied/dismissed) and the undo target
(previous_stage_id). Unique on (email_account_id, message_uid) so re-scans don't
double-detect the same message.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-08-16
"""

import sqlalchemy as sa

from alembic import op

revision = "e1f2a3b4c5d6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "detected_events",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "email_account_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("email_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "saved_job_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("saved_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("target_stage", sa.String(50), nullable=True),
        sa.Column("from_addr", sa.String(255), nullable=False, server_default=""),
        sa.Column("subject", sa.String(500), nullable=False, server_default=""),
        sa.Column("message_uid", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "previous_stage_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("pipeline_stages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "email_account_id", "message_uid", name="uq_detected_event_uid"
        ),
    )
    op.create_index(
        "ix_detected_events_user_status",
        "detected_events",
        ["user_id", "status"],
    )
    # Deny-all to the public/anon role (no policies); backend bypasses via its
    # role. Reproducible RLS on any Postgres; skipped on SQLite (tests).
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE detected_events ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_detected_events_user_status", table_name="detected_events")
    op.drop_table("detected_events")
