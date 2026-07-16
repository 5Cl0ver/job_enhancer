"""Job search endpoints (US1 — Search and Discover Jobs)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.job_listing import JobListing
from app.models.user import User
from app.schemas.job import JobListingSchema, JobSearchResponse
from app.services.job_search import aggregate_and_deduplicate

router = APIRouter()


@router.get("/", response_model=JobSearchResponse)
async def search_jobs(
    q: str = Query(..., min_length=1, max_length=255, description="Search query"),
    location: str | None = Query(None, max_length=255),
    remote_only: bool = Query(False),
    salary_min: int | None = Query(None, ge=0),
    salary_max: int | None = Query(None, ge=0),
    experience: str | None = Query(None, pattern="^(entry|mid|senior)$"),
    job_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobSearchResponse:
    """Search jobs across Adzuna and JSearch, deduplicated and paginated."""
    return await aggregate_and_deduplicate(
        db=db,
        q=q,
        location=location,
        remote_only=remote_only,
        salary_min=salary_min,
        salary_max=salary_max,
        experience=experience,
        job_type=job_type,
        page=page,
        page_size=page_size,
    )


@router.get("/{job_id}", response_model=JobListingSchema)
async def get_job(
    job_id: uuid.UUID,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobListingSchema:
    """Fetch a single job listing by ID."""
    listing = await db.scalar(select(JobListing).where(JobListing.id == job_id))
    if not listing:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobListingSchema.model_validate(listing)
