"""How each saved job got into My Jobs.

saved_jobs.origin: scout | email | extension | claude | search | manual. Set by
the code that saves the job from now on. For jobs saved before this, only the
ones the data can place are labelled:

- scout:  a Claude Scout finding points at the job.
- email:  the job's link is the user's webmail (only "Add to My Jobs" on an
          email update writes such a link) and an email update points at it.
- search: the listing came from a job-board feed, not from a person.

Everything else stays null and shows no label, rather than a guess (a typed-in
job and one saved with Job Catcher look the same in the old data).

A new nullable column and an update of that column only: nothing else changes.

Revision ID: c0d1e2f3a4b6
Revises: b9c0d1e2f3a5
Create Date: 2026-11-19
"""

import sqlalchemy as sa

from alembic import op

revision = "c0d1e2f3a4b6"
down_revision = "b9c0d1e2f3a5"
branch_labels = None
depends_on = None

_MAIL_HOSTS = ("mail.yahoo.com", "mail.aol.com", "mail.google.com")


def upgrade() -> None:
    op.add_column("saved_jobs", sa.Column("origin", sa.String(12), nullable=True))
    op.execute(
        "UPDATE saved_jobs SET origin = 'scout' WHERE id IN ("
        "SELECT saved_job_id FROM scout_findings "
        "WHERE saved_job_id IS NOT NULL AND outcome = 'saved')"
    )
    mail = " OR ".join(f"apply_url LIKE 'https://{h}/%'" for h in _MAIL_HOSTS)
    op.execute(
        "UPDATE saved_jobs SET origin = 'email' WHERE origin IS NULL "
        "AND id IN ("
        "SELECT saved_job_id FROM detected_events WHERE saved_job_id IS NOT NULL) "
        "AND job_listing_id IN ("
        f"SELECT id FROM job_listings WHERE source = 'manual' AND ({mail}))"
    )
    op.execute(
        "UPDATE saved_jobs SET origin = 'search' WHERE origin IS NULL "
        "AND job_listing_id IN ("
        "SELECT id FROM job_listings WHERE source <> 'manual')"
    )


def downgrade() -> None:
    with op.batch_alter_table("saved_jobs") as batch:
        batch.drop_column("origin")
