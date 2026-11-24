"""Saved jobs endpoints (US2 — Save and Organize Jobs)."""

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, get_user_or_pass
from app.models.job_listing import JobListing
from app.models.saved_job import ORIGIN_EXTENSION
from app.models.user import User
from app.schemas.job_link import JobOption, LinkJobRequest, LinkResult, LinkUndo
from app.schemas.saved_job import (
    ApplicationSyncRequest,
    ApplicationSyncResult,
    BackfillResult,
    JobResumeIn,
    JobSavedCheck,
    JobSavedResult,
    JobSourceOut,
    ListingRename,
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
from app.services import job_links, job_source
from app.services import saved_jobs as svc

router = APIRouter()


@router.get("/", response_model=list[SavedJobListItem])
async def list_saved_jobs(
    collection_id: uuid.UUID | None = Query(None),
    pipeline_stage_id: uuid.UUID | None = Query(None),
    is_archived: bool = Query(False),
    user: User = Depends(get_user_or_pass),
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
    fits = await svc.scout_fits(db, user.id)
    doubtful = await svc.doubtful_names(db, user.id)
    out = []
    for r in rows:
        item = SavedJobListItem.model_validate(r)
        item.scout = fits.get(r.id)
        item.name_doubtful = r.id in doubtful
        out.append(item)
    return out


@router.get("/summary", response_model=SavedJobSummaryResponse)
async def saved_jobs_summary(
    version: str | None = Query(None, max_length=64),
    user: User = Depends(get_user_or_pass),
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
                resume_id=r.resume_id,
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
    listing = await db.get(JobListing, data.job_listing_id)
    sj = await svc.save_job(db, user.id, data, origin=svc.listing_origin(listing))
    await db.commit()
    return SavedJobSchema.model_validate(sj)


@router.post("/manual", response_model=SavedJobSchema, status_code=201)
async def save_manual_job(
    data: ManualJobCreate,
    request: Request,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> SavedJobSchema:
    """Add a job found on an external site by URL + details (FR-004a)."""
    # Job Catcher builds from before it sent ``origin`` are told apart by where
    # the request comes from: only an extension has a chrome-extension origin.
    from_extension = request.headers.get("origin", "").startswith("chrome-extension://")
    sj = await svc.save_manual_job(
        db, user.id, data, origin=ORIGIN_EXTENSION if from_extension else None
    )
    await db.commit()
    return SavedJobSchema.model_validate(sj)


@router.post("/check", response_model=JobSavedResult)
async def check_saved(
    data: JobSavedCheck,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> JobSavedResult:
    """Is this job already in the user's tracker? Used by the extension to show
    an 'already saved' state before the user clicks. `needs_details` invites a
    passive backfill when the extension can see the full posting."""
    listing = await svc.get_saved_listing(
        db, user.id, data.title, data.company, data.location, data.url
    )
    if listing is None:
        return JobSavedResult(saved=False)
    return JobSavedResult(saved=True, needs_details=svc.listing_needs_details(listing))


@router.post("/backfill", response_model=BackfillResult)
async def backfill_details(
    data: ManualJobCreate,
    user: User = Depends(get_user_or_pass),
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
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> MarkAppliedResult:
    """Auto-track: the extension detected an application SUBMIT on an ATS page.
    Moves the matching saved job to Applied (sets applied_at). No match → no-op."""
    matched = await svc.mark_applied(
        db, user.id, data.title, data.company, data.saved_job_id
    )
    if matched:
        await db.commit()
    return MarkAppliedResult(matched=matched)


@router.post("/sync-applications", response_model=ApplicationSyncResult)
async def sync_applications(
    data: ApplicationSyncRequest,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> ApplicationSyncResult:
    """Bulk-reconcile applications the user already made on a job board (read off
    their 'My jobs' list by the extension): fuzzy-match each to a saved job and
    move it to the mapped stage, importing the rest as new tracked jobs."""
    result = await svc.sync_applications(db, user.id, data.applications)
    await db.commit()
    return result


@router.get("/{saved_job_id}/source", response_model=JobSourceOut)
async def saved_job_source(
    saved_job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobSourceOut:
    """Where this job came from: its folder, and the Scout search or the email
    that put it in My Jobs."""
    return await job_source.job_source(db, user.id, saved_job_id)


@router.patch("/{saved_job_id}/listing", response_model=SavedJobListItem)
async def rename_listing(
    saved_job_id: uuid.UUID,
    data: ListingRename,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedJobListItem:
    """Fix (or confirm) a saved job's title, company, place or link. Only this
    user's job changes; the shared listing is never edited."""
    sj = await svc.rename_listing(db, user.id, saved_job_id, data)
    await db.commit()
    sj = await svc.get_saved_job(db, sj.id, user.id, with_description=False)
    return SavedJobListItem.model_validate(sj)


@router.get("/{saved_job_id}/link-options", response_model=list[JobOption])
async def link_options(
    saved_job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[JobOption]:
    """The saved jobs a job made from an email could really be, likeliest first."""
    return await job_links.job_options(db, user.id, saved_job_id)


@router.post("/{saved_job_id}/link", response_model=LinkResult)
async def link_job(
    saved_job_id: uuid.UUID,
    data: LinkJobRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LinkResult:
    """This job made from an email is really another saved job: its emails move
    there, that card moves forward if needed, and this copy is removed."""
    result = await job_links.link_job(db, user.id, saved_job_id, data.target_id)
    await db.commit()
    return result


@router.post("/{saved_job_id}/unlink", status_code=204)
async def unlink_job(
    saved_job_id: uuid.UUID,
    data: LinkUndo,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Undo a link: the copy comes back with its emails."""
    await job_links.unlink_job(db, user.id, saved_job_id, data)
    await db.commit()


@router.put("/{saved_job_id}/resume", status_code=204)
async def choose_job_resume(
    saved_job_id: uuid.UUID,
    data: JobResumeIn,
    user: User = Depends(get_user_or_pass),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The résumé Job Catcher uploads and fills from for this job (spec 020).
    Job Catcher's "Filling from … · Change" and the app's job page both set it."""
    await svc.set_job_resume(db, user.id, saved_job_id, data.resume_id)
    await db.commit()
    return Response(status_code=204)


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
