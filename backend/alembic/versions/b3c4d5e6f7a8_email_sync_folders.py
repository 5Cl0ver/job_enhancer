"""email sync: per-folder cursors, folder-aware duplicate keys, scan backoff

- detected_events: add folder (default INBOX), uidvalidity, logical_key.
  The unique key (email_account_id, message_uid) becomes
  (email_account_id, folder, uidvalidity, message_uid), plus a unique
  (email_account_id, logical_key). Existing rows become folder='INBOX',
  uidvalidity=NULL, logical_key=NULL; the next scan adopts them.
- email_folder_states: new, one cursor row per account + folder.
- email_accounts: add sync_backoff_until, sync_backoff_level.

Downgrade restores the old unique key and refuses to run if two rows would
collide on (email_account_id, message_uid).

Revision ID: b3c4d5e6f7a8
Revises: f2a3b4c5d6e7
Create Date: 2026-11-03
"""

import sqlalchemy as sa

from alembic import op

revision = "b3c4d5e6f7a8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def _dialect() -> str:
    # Works offline too (``--sql``), unlike op.get_bind().
    return op.get_context().dialect.name


def upgrade() -> None:
    with op.batch_alter_table("detected_events") as batch:
        batch.add_column(
            sa.Column("folder", sa.String(255), nullable=False, server_default="INBOX")
        )
        batch.add_column(sa.Column("uidvalidity", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("logical_key", sa.String(255), nullable=True))
        batch.drop_constraint("uq_detected_event_uid", type_="unique")
        batch.create_unique_constraint(
            "uq_detected_event_location",
            ["email_account_id", "folder", "uidvalidity", "message_uid"],
        )
        batch.create_unique_constraint(
            "uq_detected_event_logical", ["email_account_id", "logical_key"]
        )

    with op.batch_alter_table("email_accounts") as batch:
        batch.add_column(
            sa.Column("sync_backoff_until", sa.DateTime(timezone=True), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "sync_backoff_level", sa.Integer(), nullable=False, server_default="0"
            )
        )

    op.create_table(
        "email_folder_states",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "email_account_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("email_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("folder_name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("uidvalidity", sa.BigInteger(), nullable=True),
        sa.Column("last_uid", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("backfill_low", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "backfill_floor", sa.BigInteger(), nullable=False, server_default="1"
        ),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(20), nullable=True),
        sa.Column("last_report", sa.JSON(), nullable=True),
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
        sa.UniqueConstraint(
            "email_account_id", "folder_name", name="uq_email_folder_state"
        ),
    )
    # Deny-all to the public/anon role, like every other table; the backend's
    # role bypasses it. Skipped on SQLite (tests).
    if _dialect() == "postgresql":
        op.execute("ALTER TABLE email_folder_states ENABLE ROW LEVEL SECURITY")


_COLLISION_MSG = (
    "cannot downgrade: detected_events has rows that share "
    "(email_account_id, message_uid) across folders or UIDVALIDITY values"
)


def downgrade() -> None:
    if _dialect() == "postgresql":
        # A DO block so the check also lands in offline (--sql) output.
        op.execute(
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM detected_events "
            "GROUP BY email_account_id, message_uid HAVING count(*) > 1) "
            f"THEN RAISE EXCEPTION '{_COLLISION_MSG}'; END IF; END $$"
        )
    else:
        dupes = (
            op.get_bind()
            .execute(
                sa.text(
                    "SELECT 1 FROM detected_events "
                    "GROUP BY email_account_id, message_uid HAVING count(*) > 1"
                )
            )
            .first()
        )
        if dupes:
            raise RuntimeError(_COLLISION_MSG)

    op.drop_table("email_folder_states")

    with op.batch_alter_table("email_accounts") as batch:
        batch.drop_column("sync_backoff_level")
        batch.drop_column("sync_backoff_until")

    with op.batch_alter_table("detected_events") as batch:
        batch.drop_constraint("uq_detected_event_logical", type_="unique")
        batch.drop_constraint("uq_detected_event_location", type_="unique")
        batch.create_unique_constraint(
            "uq_detected_event_uid", ["email_account_id", "message_uid"]
        )
        batch.drop_column("logical_key")
        batch.drop_column("uidvalidity")
        batch.drop_column("folder")
