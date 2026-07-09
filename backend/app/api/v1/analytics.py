"""User analytics endpoints (US5 — User Dashboard and Analytics)."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import CurrentUser
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob

router = APIRouter()


class WeeklyActivity(BaseModel):
    week_start: str  # ISO date YYYY-MM-DD
    count: int


class AnalyticsSummary(BaseModel):
    total_saved: int
    total_applied: int
    total_interviews: int
    response_rate: float  # applied / total_saved * 100
    weekly_activity: list[WeeklyActivity]


@router.get("/summary", response_model=AnalyticsSummary)
async def get_analytics_summary(
    user: CurrentUser = Depends(),
    db: AsyncSession = Depends(get_db),
) -> AnalyticsSummary:
    now = datetime.now(tz=timezone.utc)

    # Total saved jobs
    total_saved = (
        await db.scalar(
            select(func.count()).select_from(SavedJob).where(SavedJob.user_id == user.id)
        )
    ) or 0

    # Applied count — SavedJob has applied_at set
    total_applied = (
        await db.scalar(
            select(func.count())
            .select_from(SavedJob)
            .where(SavedJob.user_id == user.id, SavedJob.applied_at.isnot(None))
        )
    ) or 0

    # Interview count — pipeline stage name contains "Interview"
    interview_stage_ids = (
        await db.execute(
            select(PipelineStage.id).where(
                PipelineStage.user_id == user.id,
                PipelineStage.name.ilike("%interview%"),
            )
        )
    ).scalars().all()

    total_interviews = 0
    if interview_stage_ids:
        total_interviews = (
            await db.scalar(
                select(func.count())
                .select_from(SavedJob)
                .where(
                    SavedJob.user_id == user.id,
                    SavedJob.pipeline_stage_id.in_(interview_stage_ids),
                )
            )
        ) or 0

    response_rate = (total_applied / total_saved * 100) if total_saved > 0 else 0.0

    # Weekly activity — applications per week for last 8 weeks
    weekly: list[WeeklyActivity] = []
    for weeks_back in range(7, -1, -1):
        week_start = now - timedelta(weeks=weeks_back + 1)
        week_end = now - timedelta(weeks=weeks_back)
        count = (
            await db.scalar(
                select(func.count())
                .select_from(SavedJob)
                .where(
                    SavedJob.user_id == user.id,
                    SavedJob.applied_at >= week_start,
                    SavedJob.applied_at < week_end,
                )
            )
        ) or 0
        weekly.append(WeeklyActivity(week_start=week_start.date().isoformat(), count=count))

    return AnalyticsSummary(
        total_saved=total_saved,
        total_applied=total_applied,
        total_interviews=total_interviews,
        response_rate=round(response_rate, 1),
        weekly_activity=weekly,
    )
