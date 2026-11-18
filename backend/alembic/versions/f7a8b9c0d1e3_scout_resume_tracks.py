"""claude scout: resume types (tracks)

- resume_tracks: one row per kind of role the user targets — target titles, key
  skills, skip rules, minimum pay, and the uploaded resume to apply with.
- saved_jobs.track_id: the resume type a job was found for (nullable; cleared
  when the track is deleted).

Additive only. Downgrade drops the column and the table.

Revision ID: f7a8b9c0d1e3
Revises: e6f7a8b9c0d1
Create Date: 2026-11-18
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "f7a8b9c0d1e3"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resume_tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("target_titles", sa.JSON(), nullable=False),
        sa.Column("key_skills", sa.JSON(), nullable=False),
        sa.Column("skip_rules", sa.JSON(), nullable=False),
        sa.Column("min_pay", sa.Integer(), nullable=True),
        sa.Column(
            "resume_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resumes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
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
        sa.UniqueConstraint("user_id", "name", name="uq_resume_track_user_name"),
    )
    op.create_index("ix_resume_tracks_user_id", "resume_tracks", ["user_id"])
    # Deny-all to the public/anon role (no policies); the backend's role
    # bypasses RLS. Same posture as every other table. Skipped on SQLite.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE resume_tracks ENABLE ROW LEVEL SECURITY")

    with op.batch_alter_table("saved_jobs") as batch:
        batch.add_column(
            sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=True)
        )
        batch.create_foreign_key(
            "fk_saved_jobs_track_id",
            "resume_tracks",
            ["track_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("saved_jobs") as batch:
        batch.drop_constraint("fk_saved_jobs_track_id", type_="foreignkey")
        batch.drop_column("track_id")
    op.drop_index("ix_resume_tracks_user_id", table_name="resume_tracks")
    op.drop_table("resume_tracks")
