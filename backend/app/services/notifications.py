"""Follow-up reminder background task — runs hourly via APScheduler.

Finds SavedJobs where:
  last_stage_change < now() - user.follow_up_days
  AND (follow_up_sent_at IS NULL OR follow_up_sent_at < last_stage_change)

Updates follow_up_sent_at to prevent duplicate reminders.
The reminder delivery mechanism is intentionally minimal (logging + DB flag).
Email / push notification integration can be layered on top.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.saved_job import SavedJob
from app.models.user import User

logger = logging.getLogger(__name__)


async def send_follow_up_reminders(session_factory: async_sessionmaker) -> None:
    """Hourly task — flag stale applications for follow-up."""
    async with session_factory() as db:
        now = datetime.now(tz=UTC)

        # Find overdue jobs via a join on User to get follow_up_days per user
        stmt = (
            select(SavedJob, User)
            .join(User, SavedJob.user_id == User.id)
            .where(
                User.deleted_at.is_(None),
                SavedJob.is_archived.is_(False),
                SavedJob.pipeline_stage_id.isnot(None),
                # follow_up_sent_at is null or older than last_stage_change
                (
                    SavedJob.follow_up_sent_at.is_(None)
                    | (SavedJob.follow_up_sent_at < SavedJob.last_stage_change)
                ),
            )
        )
        rows = (await db.execute(stmt)).all()

        count = 0
        for sj, user in rows:
            days_stale = (now - sj.last_stage_change.replace(tzinfo=UTC)).days
            if days_stale >= user.follow_up_days:
                sj.follow_up_sent_at = now
                count += 1
                logger.info(
                    "Follow-up flagged: user=%s job=%s days_stale=%d",
                    user.email,
                    sj.id,
                    days_stale,
                )

        if count > 0:
            await db.commit()
            logger.info("Follow-up reminders flagged: %d", count)
