"""Saved jobs endpoints (US2 — Save and Organize Jobs)."""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.saved_job import (
    ApplicationSyncRequest,
    ApplicationSyncResult,
    BackfillResult,
    JobSavedCheck,
    JobSavedResult,
    ManualJobCreate,
    MarkAppliedRequest,
    MarkAppliedResult,
    SavedJobCreate,
    SavedJobListItem,
    SavedJobSchema,
    SavedJobSummary,
    SavedJobSummaryResponse,
    SavedJobUpdate,
)
from app.services import saved_jobs as svc

router = APIRouter()


@router.get("/", response_model=list[SavedJobListItem])
async def list_saved_jobs(
    collection_id: uuid.UUID | None = Query(None),
    pipeline_stage_id: uuid.UUID | None = Query(None),
    is_archived: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SavedJobListItem]:
    """Saved jobs for the list and board views. Listings carry a short
    description preview; the full text comes from ``GET /jobs/{id}``."""
    rows = await svc.list_saved_jobs(
        db,
        user.id,
        collection_id,
        pipeline_stage_id,
        is_archived,
        with_description=False,
    )
    return [SavedJobListItem.model_validate(r) for r in rows]


@router.get("/summary", response_model=SavedJobSummaryResponse)
async def saved_jobs_summary(
    version: str | None = Query(None, max_length=64),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedJobSummaryResponse:
    """Slim saved-job list for the browser extension, with a change check.

    Pass the ``version`` from the last response: if nothing changed, the
    answer is ``{"changed": false}`` from one aggregate query and the list is
    not read at all. Otherwise it returns the slim list and the new version.
    """
    current = await svc.saved_jobs_version(db, user.id)
    if version is not None and version == current:
        return SavedJobSummaryResponse(version=current, changed=False)
    rows = await svc.list_saved_job_summaries(db, user.id)
    return SavedJobSummaryResponse(
        version=current,
        changed=True,
        jobs=[
            SavedJobSummary(
                id=r.id,
                job_listing_id=r.job_listing_id,
                title=r.title,
                company=r.company,
                location=r.location,
                url=r.apply_url,
                applied_at=r.applied_at,
            )
            for r in rows
        ],
    )


@router.post("/", response_model=SavedJobSchema, status_code=201)
async def save_job(
    data: SavedJobCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedJobSchema:
    sj = await svc.save_job(db, user.id, data)
    await db.commit()
    return SavedJobSchema.model_validate(sj)


@router.post("/manual", response_model=SavedJobSchema, status_code=201)
async def save_manual_job(
    data: ManualJobCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedJobSchema:
    """Add a job found on an external site by URL + details (FR-004a)."""
    sj = await svc.save_manual_job(db, user.id, data)
    await db.commit()
    return SavedJobSchema.model_validate(sj)


@router.post("/check", response_model=JobSavedResult)
async def check_saved(
    data: JobSavedCheck,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobSavedResult:
    """Is this job already in the user's tracker? Used by the extension to show
    an 'already saved' state before the user clicks. `needs_details` invites a
    passive backfill when the extension can see the full posting."""
    listing = await svc.get_saved_listing(
        db, user.id, data.title, data.company, data.location
    )
    if listing is None:
        return JobSavedResult(saved=False)
    return JobSavedResult(saved=True, needs_details=svc.listing_needs_details(listing))


@router.post("/backfill", response_model=BackfillResult)
async def backfill_details(
    data: ManualJobCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BackfillResult:
    """Passive backfill: upgrade an already-saved job's listing with the full
    details the extension captured from the actual job page. Only ever upgrades
    (longer description / filling empty fields); no-op if the job isn't saved."""
    fields = await svc.backfill_job_details(db, user.id, data)
    if fields:
        await db.commit()
    return BackfillResult(updated=bool(fields), fields=fields)


@router.post("/mark-applied", response_model=MarkAppliedResult)
async def mark_applied(
    data: MarkAppliedRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MarkAppliedResult:
    """Auto-track: the extension detected an application SUBMIT on an ATS page.
    Moves the matching saved job to Applied (sets applied_at). No match → no-op."""
    matched = await svc.mark_applied(db, user.id, data.title, data.company)
    if matched:
        await db.commit()
    return MarkAppliedResult(matched=matched)


@router.post("/sync-applications", response_model=ApplicationSyncResult)
async def sync_applications(
    data: ApplicationSyncRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApplicationSyncResult:
    """Bulk-reconcile applications the user already made on a job board (read off
    their 'My jobs' list by the extension): fuzzy-match each to a saved job and
    move it to the mapped stage, importing the rest as new tracked jobs."""
    result = await svc.sync_applications(db, user.id, data.applications)
    await db.commit()
    return result


@router.patch("/{saved_job_id}", response_model=SavedJobListItem)
async def update_saved_job(
    saved_job_id: uuid.UUID,
    data: SavedJobUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedJobListItem:
    sj = await svc.update_saved_job(db, saved_job_id, user.id, data)
    await db.commit()
    await db.refresh(sj)  # reload server-generated updated_at
    return SavedJobListItem.model_validate(sj)


@router.delete("/{saved_job_id}", status_code=204)
async def delete_saved_job(
    saved_job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await svc.delete_saved_job(db, saved_job_id, user.id)
    await db.commit()
