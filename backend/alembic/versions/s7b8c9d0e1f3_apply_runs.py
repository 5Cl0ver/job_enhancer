"""Apply with Claude (spec 022 part B)

Revision ID: s7b8c9d0e1f3
Revises: r6a7b8c9d0e2
Create Date: 2026-11-24

- apply_runs: one application Claude makes for one saved job.
- apply_requests: what Claude asked Job Catcher to do (photos, fill).
- apply_photos: Job Catcher's photos of each page (deleted 30 days after).
- profile_facts: things the user told Claude that the résumé doesn't say.
- resumes.is_master: the big résumé Claude tailors from.
- resumes.document_id: a résumé made for a job, from this document.
Additive.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "s7b8c9d0e1f3"
down_revision = "r6a7b8c9d0e2"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
# Frozen here (not imported from the model) so the migration never changes.
_OPEN = (
    "status IN ('waiting', 'reading', 'questions', 'writing', 'filling', "
    "'needs_you', 'review', 'submitting')"
)


def _ts(name: str, nullable: bool = False) -> sa.Column:
    if nullable:
        return sa.Column(name, sa.DateTime(timezone=True), nullable=True)
    return sa.Column(
        name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def _user() -> sa.Column:
    return sa.Column(
        "user_id", _UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


def _run() -> sa.Column:
    return sa.Column(
        "run_id",
        _UUID,
        sa.ForeignKey("apply_runs.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "apply_runs",
        sa.Column("id", _UUID, primary_key=True),
        _user(),
        sa.Column(
            "saved_job_id",
            _UUID,
            sa.ForeignKey("saved_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="waiting"),
        sa.Column("questions", sa.JSON(), nullable=False),
        sa.Column(
            "answers_done", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("pages", sa.JSON(), nullable=False),
        sa.Column("help", sa.JSON(), nullable=True),
        sa.Column("review", sa.JSON(), nullable=True),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("apply_hosts", sa.JSON(), nullable=False),
        sa.Column(
            "resume_id",
            _UUID,
            sa.ForeignKey("resumes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "document_id",
            _UUID,
            sa.ForeignKey("generated_documents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("playbook_version", sa.String(20), nullable=False),
        _ts("created_at"),
        _ts("started_at", nullable=True),
        _ts("last_activity_at"),
        _ts("finished_at", nullable=True),
    )
    op.create_index("ix_apply_runs_user_id", "apply_runs", ["user_id"])
    op.create_index("ix_apply_runs_saved_job_id", "apply_runs", ["saved_job_id"])
    # One open run per user, held by the database (two quick presses).
    op.create_index(
        "uq_apply_runs_one_open",
        "apply_runs",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text(_OPEN),
        sqlite_where=sa.text(_OPEN),
    )

    op.create_table(
        "apply_requests",
        sa.Column("id", _UUID, primary_key=True),
        _run(),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("page_n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("result", sa.JSON(), nullable=True),
        _ts("created_at"),
        _ts("done_at", nullable=True),
    )
    op.create_index("ix_apply_requests_run_id", "apply_requests", ["run_id"])

    op.create_table(
        "apply_photos",
        sa.Column("id", _UUID, primary_key=True),
        _run(),
        _user(),
        sa.Column("page_n", sa.Integer(), nullable=False),
        sa.Column("part", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        _ts("created_at"),
    )
    op.create_index("ix_apply_photos_run_id", "apply_photos", ["run_id"])
    op.create_index("ix_apply_photos_user_id", "apply_photos", ["user_id"])

    op.create_table(
        "profile_facts",
        sa.Column("id", _UUID, primary_key=True),
        _user(),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column(
            "saved_job_id",
            _UUID,
            sa.ForeignKey("saved_jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        _ts("created_at"),
        _ts("updated_at"),
    )
    op.create_index("ix_profile_facts_user_id", "profile_facts", ["user_id"])

    with op.batch_alter_table("resumes") as batch:
        batch.add_column(
            sa.Column(
                "is_master", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch.add_column(sa.Column("document_id", _UUID, nullable=True))
        batch.create_foreign_key(
            "fk_resumes_document_id",
            "generated_documents",
            ["document_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if op.get_bind().dialect.name == "postgresql":
        for table in ("apply_runs", "apply_requests", "apply_photos", "profile_facts"):
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    with op.batch_alter_table("resumes") as batch:
        batch.drop_constraint("fk_resumes_document_id", type_="foreignkey")
        batch.drop_column("document_id")
        batch.drop_column("is_master")
    op.drop_index("ix_profile_facts_user_id", table_name="profile_facts")
    op.drop_table("profile_facts")
    op.drop_index("ix_apply_photos_user_id", table_name="apply_photos")
    op.drop_index("ix_apply_photos_run_id", table_name="apply_photos")
    op.drop_table("apply_photos")
    op.drop_index("ix_apply_requests_run_id", table_name="apply_requests")
    op.drop_table("apply_requests")
    op.drop_index("uq_apply_runs_one_open", table_name="apply_runs")
    op.drop_index("ix_apply_runs_saved_job_id", table_name="apply_runs")
    op.drop_index("ix_apply_runs_user_id", table_name="apply_runs")
    op.drop_table("apply_runs")
