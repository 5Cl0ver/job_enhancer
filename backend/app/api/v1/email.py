"""Email auto-status endpoints — connect an inbox, scan it, review updates.

A scan is one read-only sync (``email_sync``): inbox + spam, per-folder
cursors, headers first, bodies only for possible job emails. Its cursors are
saved in the same transaction as the detected events. One scan per account at
a time; a scan during a server-requested backoff returns 429 without
connecting.
"""

import asyncio
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal, get_db
from app.middleware.auth import get_current_user
from app.models.detected_event import (
    STATUS_AUTO_APPLIED,
    STATUS_CONTACT,
    STATUS_HIDDEN,
    STATUS_PENDING,
    STATUS_REVIEW,
    STATUS_UNSAVED,
    DetectedEvent,
)
from app.models.email_account import STATUS_CONNECTED, STATUS_ERROR
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import SavedJob
from app.models.user import User
from app.schemas.email_account import (
    ConsideredOut,
    DetectedEventOut,
    EmailAccountOut,
    EmailConnectRequest,
    EmailMessageOut,
    EmailSettingsRequest,
    FolderSyncOut,
    JobEmailLatestOut,
    JobEmailsSeenIn,
    KeepEventRequest,
    MatchCandidateOut,
    ProviderInfoOut,
    RecheckIn,
    RecheckOut,
    ResolveEventRequest,
    ScanResult,
    TrackEventRequest,
    UnseenOut,
)
from app.schemas.job_link import JobOption, LinkEventRequest
from app.services import (
    bug_reports,
    email_recheck,
    email_review,
    email_sync,
    email_sync_state,
    email_view,
    job_links,
)
from app.services import email_accounts as svc
from app.services.email_classify import UNSURE
from app.services.email_imap import ImapAuthError
from app.services.email_job_names import clean_role, is_sender_person
from app.services.email_prefilter import company_tokens
from app.services.email_providers import detect_provider
from app.services.email_scan import (
    IMPORTANT_EVENTS,
    _candidate_jobs,
    detect_events,
    email_id_of,
    mail_link,
    mail_search_link,
)
from app.utils import crypto

router = APIRouter()

# One scan per account at a time (in-process; the backend runs one instance).
_SCAN_LOCKS: dict[uuid.UUID, asyncio.Lock] = {}


async def _events_out(
    db: AsyncSession, provider: str, events: list[DetectedEvent]
) -> list[DetectedEventOut]:
    """Enrich stored events with a link to the job in the app (job_listing_id),
    the card's current stage, a link to the email in webmail (built from
    provider + subject), and — for a needs-review item — its candidate jobs'
    names. A candidate the user has since archived or deleted is left out."""
    if not events:
        return []
    ids: set[uuid.UUID] = {e.saved_job_id for e in events if e.saved_job_id}
    for e in events:
        ids.update(uuid.UUID(c) for c in e.review_candidates or [])
    rows = (
        await db.execute(
            select(
                SavedJob.id,
                SavedJob.job_listing_id,
                SavedJob.is_archived,
                func.coalesce(SavedJob.custom_company, JobListing.company).label(
                    "company"
                ),
                func.coalesce(SavedJob.custom_title, JobListing.title).label("title"),
                PipelineStage.name.label("stage"),
            )
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .outerjoin(PipelineStage, SavedJob.pipeline_stage_id == PipelineStage.id)
            .where(SavedJob.id.in_(ids), SavedJob.user_id == events[0].user_id)
        )
    ).all()
    job_of = {r.id: r for r in rows}
    listing_of = {r.id: r.job_listing_id for r in rows}
    stage_names = set(
        await db.scalars(
            select(PipelineStage.name).where(PipelineStage.user_id == events[0].user_id)
        )
    )
    out: list[DetectedEventOut] = []
    for e in events:
        d = DetectedEventOut.model_validate(e)
        d.category = category_of(e)
        d.job_listing_id = listing_of.get(e.saved_job_id)
        if (j := job_of.get(e.saved_job_id)) is not None:
            d.company, d.title = j.company, j.title
            d.current_stage = j.stage
        else:  # not a saved job: the names read from the email, if any
            d.company, d.title = e.job_company, e.job_title
            if d.company and not d.company[0].isalnum():
                d.company = None  # a leftover like ".io" stored by an older scan
            # An older scan may have kept a sentence or the sender's own name:
            # better to ask the user than to show those.
            if is_sender_person(d.company, e.from_addr):
                d.company = None
            d.title = clean_role(d.title, strict=False) if d.title else None
        d.stage_missing = bool(e.target_stage) and e.target_stage not in stage_names
        d.mail_link = mail_link(
            provider,
            subject=e.subject,
            email_id=email_id_of(e.logical_key),
            folder=e.folder,
            from_addr=e.from_addr,
        )
        d.mail_search_link = mail_search_link(provider, e.subject, e.from_addr)
        if e.status in (STATUS_REVIEW, STATUS_HIDDEN):
            d.review_reason = (
                "unsure" if e.event_type == UNSURE else e.match_evidence or "no_match"
            )
            for c in e.review_candidates or []:
                r = job_of.get(uuid.UUID(c))
                if r is not None and not r.is_archived:
                    d.candidates.append(
                        MatchCandidateOut(
                            company=r.company,
                            title=r.title,
                            job_listing_id=r.job_listing_id,
                            saved_job_id=r.id,
                        )
                    )
        out.append(d)
    return out


def category_of(e: DetectedEvent) -> str:
    """Where the Email Updates page shows an item. Only an important update
    with an unclear job is a question; anything low-value is hidden."""
    important = e.event_type in IMPORTANT_EVENTS
    if e.status == STATUS_AUTO_APPLIED:
        return "moved"
    if e.status == STATUS_PENDING:
        return "important" if important else "confirmation"
    if e.status == STATUS_REVIEW and important:
        return "question"
    if e.status == STATUS_UNSAVED:
        return "unsaved"
    if e.status == STATUS_CONTACT:
        return "contact"
    return "hidden"


@router.get("/provider", response_model=ProviderInfoOut)
async def get_provider_for_address(
    address: str = Query(..., description="Email address to detect settings for"),
    user: User = Depends(get_current_user),
) -> ProviderInfoOut:
    """Tell the UI how to connect this address (which form/guide to show)."""
    return ProviderInfoOut(**detect_provider(address).as_dict())


@router.get("/account", response_model=EmailAccountOut | None)
async def get_connected_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailAccountOut | None:
    """The user's connected inbox, or null if none."""
    account = await svc.get_account(db, user.id)
    return EmailAccountOut.model_validate(account) if account else None


@router.patch("/account", response_model=EmailAccountOut)
async def update_settings(
    data: EmailSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailAccountOut:
    """Change Email Updates settings (whether sure updates move cards)."""
    account = await svc.get_account(db, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No email connected")
    account.auto_move = data.auto_move
    await db.commit()
    await db.refresh(account)
    return EmailAccountOut.model_validate(account)


@router.post("/connect", response_model=EmailAccountOut, status_code=201)
async def connect_account(
    data: EmailConnectRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailAccountOut:
    """Connect (or reconnect) a mailbox; the app-password is encrypted at rest."""
    account = await svc.connect_account(db, user.id, data)
    await db.commit()
    return EmailAccountOut.model_validate(account)


@router.delete("/account", status_code=204)
async def disconnect_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Disconnect the inbox and delete its detected events."""
    await svc.disconnect_account(db, user.id)
    await db.commit()


async def _caught_check(db: AsyncSession, provider: str, reason: str, message: str):
    """A mailbox check that failed again, in Bugs & ideas (spec 032): the
    provider and why only, never the address or any mail."""
    await bug_reports.catch_safely(
        db,
        section="email",
        kind="email_check",
        place=f"{provider} {reason}",
        message=message,
    )


@router.post("/scan", response_model=ScanResult)
async def scan_inbox(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanResult:
    """Sync the connected inbox + spam and record new detected updates (pending)."""
    account = await svc.get_account(db, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No email account connected")

    now = datetime.now(tz=UTC)
    if until := email_sync_state.backoff_until(account, now):
        raise HTTPException(
            status_code=429,
            detail=(
                "The mail server asked us to slow down. "
                f"Try again after {until:%H:%M} UTC."
            ),
            headers={"Retry-After": str(max(1, int((until - now).total_seconds())))},
        )
    lock = _SCAN_LOCKS.setdefault(account.id, asyncio.Lock())
    if lock.locked():
        raise HTTPException(status_code=409, detail="A scan is already running.")

    async with lock:
        # Failing already (spec 032): a failure now is a repeat, worth a report.
        failing = (
            account.status == STATUS_ERROR or (account.sync_backoff_level or 0) >= 1
        )
        password = crypto.decrypt(account.secret_encrypted)
        jobs = await _candidate_jobs(db, account.user_id)
        locations, email_ids = await email_sync_state.known_keys(db, account.id)
        opts = email_sync.SyncOptions(
            saved_companies=company_tokens([j["company"] for j in jobs]),
            known_locations=locations,
            known_email_ids=email_ids,
        )
        cursors = await email_sync_state.load_cursors(db, account.id)
        try:
            result = await email_sync.sync_mailbox(
                account.imap_host,
                account.imap_port,
                account.email_address,
                password,
                cursors,
                opts,
            )
        except ImapAuthError:
            account.status = STATUS_ERROR
            account.last_error = "Login failed — check your app password."
            # Not a bug report: a wrong app password is the user's to fix, and
            # the app already tells them.
            await db.commit()
            raise HTTPException(status_code=400, detail=account.last_error) from None
        except Exception as exc:
            # Couldn't connect or log in (network, or the server limiting us).
            reason = getattr(exc, "reason", None)
            if reason in email_sync.BACKOFF_REASONS:
                email_sync_state.apply_backoff(account, now)
            account.status = STATUS_ERROR
            account.last_error = "Could not reach the mail server."
            if failing:
                await _caught_check(
                    db,
                    account.provider,
                    reason if isinstance(reason, str) else "unreachable",
                    f"Could not reach the mail server ({type(exc).__name__})",
                )
            await db.commit()
            raise HTTPException(status_code=502, detail=account.last_error) from None

        detected = await detect_events(db, account, result.messages)
        # Updates the scan couldn't place, now and from earlier scans, that
        # point at one saved job: put them on it (and move it, with auto-move).
        placed = await job_links.promote_unsaved(db, account.user_id)
        moved = (
            await email_review.auto_apply(
                db, account.user_id, [*detected.created, *placed]
            )
            if account.auto_move
            else []
        )
        await email_sync_state.save_cursors(db, account.id, result, now)
        if result.interrupted in email_sync.BACKOFF_REASONS:
            email_sync_state.apply_backoff(account, now)
        else:
            email_sync_state.clear_backoff(account)
        account.last_scan_at = now
        account.status = STATUS_CONNECTED
        account.last_error = None
        await db.commit()

    return ScanResult(
        detected=len(detected.created),
        events=await _events_out(db, account.provider, detected.created),
        review=await _events_out(db, account.provider, detected.review),
        hidden=len(detected.hidden),
        moved=len(moved),
        unsaved=len(detected.unsaved),
        contacts=len(detected.contacts),
        noted=len(detected.noted),
        looked_at=len(detected.looked_at),
        skipped=detected.skipped,
        considered=[ConsideredOut.model_validate(c) for c in detected.considered],
        scanned=sum(r.headers_read for r in result.reports),
        candidates=detected.candidates,
        window_days=email_sync.BACKFILL_DAYS,
        folders=[FolderSyncOut(**_folder_out(r)) for r in result.reports],
        carried_over=result.carried_over,
        interrupted=result.interrupted,
    )


def _folder_out(report: email_sync.FolderReport) -> dict:
    d = report.as_dict()
    d["role"] = d.pop("folder_role")
    d.pop("filter_reasons", None)
    return d


@router.post("/recheck", response_model=RecheckOut, status_code=202)
async def recheck(
    data: RecheckIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecheckOut:
    """Re-read the last ``days`` days with today's rules, in the background.
    Only adds emails not stored yet; never moves a card (spec 027)."""
    account = await svc.get_account(db, user.id)
    if account is None:
        raise HTTPException(status_code=404, detail="No email account connected")
    now = datetime.now(tz=UTC)
    if until := email_sync_state.backoff_until(account, now):
        raise HTTPException(
            status_code=429,
            detail=(
                "The mail server asked us to slow down. "
                f"Try again after {until:%H:%M} UTC."
            ),
        )
    lock = _SCAN_LOCKS.setdefault(account.id, asyncio.Lock())
    if lock.locked():
        raise HTTPException(status_code=409, detail="A scan is already running.")
    return RecheckOut(
        **email_recheck.start(AsyncSessionLocal, account.id, data.days, lock)
    )


@router.get("/recheck", response_model=RecheckOut)
async def recheck_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecheckOut:
    """How the re-check is going (or how it went)."""
    account = await svc.get_account(db, user.id)
    if account is None:
        return RecheckOut(state="idle")
    return RecheckOut(**email_recheck.status(account.id))


@router.get("/events", response_model=list[DetectedEventOut])
async def list_events(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DetectedEventOut]:
    """Detected updates and needs-review items awaiting the user, newest
    first. Not capped: items stay until resolved or dismissed."""
    rows = await email_review.list_pending(db, user.id)
    account = await svc.get_account(db, user.id)
    return await _events_out(db, account.provider if account else "", rows)


@router.post("/events/{event_id}/apply", response_model=DetectedEventOut)
async def apply_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Approve a detected update — move the card to the target stage."""
    ev = await email_review.apply_event(db, user.id, event_id)
    await db.commit()
    return DetectedEventOut.model_validate(ev)


@router.post("/events/{event_id}/resolve", response_model=DetectedEventOut)
async def resolve_event(
    event_id: uuid.UUID,
    data: ResolveEventRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Say which saved job a needs-review email is about (and, if it was
    unsure, what it says). It becomes a pending update; nothing moves yet."""
    ev = await email_review.resolve_event(
        db, user.id, event_id, data.saved_job_id, data.event_type
    )
    await db.commit()
    account = await svc.get_account(db, user.id)
    (out,) = await _events_out(db, account.provider if account else "", [ev])
    return out


@router.post("/events/{event_id}/track", response_model=DetectedEventOut)
async def track_event(
    event_id: uuid.UUID,
    data: TrackEventRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Add the job an unsaved update is about to My Jobs, in the stage the
    email describes. Only on the user's click; nothing else moves."""
    account = await svc.get_account(db, user.id)
    provider = account.provider if account else ""
    ev = await email_review.track_event(
        db, user.id, event_id, data.company.strip(), data.title.strip(), provider
    )
    await db.commit()
    (out,) = await _events_out(db, provider, [ev])
    return out


@router.get("/events/{event_id}/link-options", response_model=list[JobOption])
async def event_link_options(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[JobOption]:
    """The saved jobs an unsaved update could be about, likeliest first."""
    return await job_links.event_options(db, user.id, event_id)


@router.post("/events/{event_id}/link", response_model=DetectedEventOut)
async def link_event(
    event_id: uuid.UUID,
    data: LinkEventRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """The update is about one of the user's saved jobs: put it there and move
    that card forward. Undo reverses it like any applied update."""
    ev = await job_links.link_event(db, user.id, event_id, data.saved_job_id)
    await db.commit()
    account = await svc.get_account(db, user.id)
    (out,) = await _events_out(db, account.provider if account else "", [ev])
    return out


@router.post("/events/{event_id}/unlink", response_model=DetectedEventOut)
async def unlink_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Undo "It's one of my jobs": the card goes back and the update is listed
    again, to link elsewhere or add as a new job."""
    ev = await job_links.unlink_event(db, user.id, event_id)
    await db.commit()
    account = await svc.get_account(db, user.id)
    (out,) = await _events_out(db, account.provider if account else "", [ev])
    return out


@router.get("/events/{event_id}/message", response_model=EmailMessageOut)
async def view_event_email(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailMessageOut:
    """Open the email behind a detected update — fetched read-only from the
    user's mailbox when asked, never stored, returned as plain text."""
    ev = await db.scalar(
        select(DetectedEvent).where(
            DetectedEvent.id == event_id, DetectedEvent.user_id == user.id
        )
    )
    if ev is None:
        raise HTTPException(status_code=404, detail="Detected event not found")
    account = await svc.get_account(db, user.id)
    if account is None or account.id != ev.email_account_id:
        raise HTTPException(status_code=404, detail="That mailbox isn't connected")
    try:
        viewed = await email_view.view_email(account, ev)
    except email_view.EmailGone:
        raise HTTPException(
            status_code=404,
            detail="This email is no longer in your mailbox (moved or deleted).",
        ) from None
    except email_sync.SyncInterrupted:
        raise HTTPException(
            status_code=502, detail="Couldn't reach your mailbox. Try again."
        ) from None
    return EmailMessageOut(
        subject=viewed.subject,
        from_addr=viewed.from_addr,
        date=viewed.date,
        text=viewed.text,
        mail_link=mail_link(
            account.provider,
            subject=viewed.subject,
            email_id=email_id_of(ev.logical_key),
            folder=ev.folder,
            from_addr=viewed.from_addr,
        ),
        mail_search_link=mail_search_link(
            account.provider, viewed.subject, viewed.from_addr
        ),
    )


@router.get("/job-emails/latest", response_model=list[JobEmailLatestOut])
async def job_emails_latest(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[JobEmailLatestOut]:
    """For every saved job with emails, the one that explains where its card
    sits — so the board can show "moved here by an email" on each card without
    a request per card."""
    account = await svc.get_account(db, user.id)
    provider = account.provider if account else ""
    return [
        JobEmailLatestOut(
            saved_job_id=ev.saved_job_id,
            event_id=ev.id,
            event_type=ev.event_type,
            status=ev.status,
            target_stage=ev.target_stage,
            email_date=ev.email_date,
            created_at=ev.created_at,
            mail_link=mail_link(
                provider,
                subject=ev.subject,
                email_id=email_id_of(ev.logical_key),
                folder=ev.folder,
                from_addr=ev.from_addr,
            ),
            mail_search_link=mail_search_link(provider, ev.subject, ev.from_addr),
            count=count,
        )
        for ev, count in await email_review.latest_by_job(db, user.id)
    ]


@router.get("/job-emails", response_model=list[DetectedEventOut])
async def job_emails(
    job_listing_id: uuid.UUID = Query(..., description="The job's listing id"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DetectedEventOut]:
    """Emails tied to one of the user's saved jobs (by its listing), newest
    first — so the job's page can list them and open each one."""
    saved_ids = list(
        await db.scalars(
            select(SavedJob.id).where(
                SavedJob.user_id == user.id, SavedJob.job_listing_id == job_listing_id
            )
        )
    )
    if not saved_ids:
        return []
    rows = list(
        await db.scalars(
            select(DetectedEvent)
            .where(
                DetectedEvent.user_id == user.id,
                DetectedEvent.saved_job_id.in_(saved_ids),
                DetectedEvent.status != "dismissed",
            )
            .order_by(DetectedEvent.created_at.desc())
        )
    )
    account = await svc.get_account(db, user.id)
    return await _events_out(db, account.provider if account else "", rows)


@router.post("/job-emails/seen", status_code=204)
async def job_emails_seen(
    data: JobEmailsSeenIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The user opened this job: its new emails are seen (spec 027)."""
    await email_review.mark_seen(db, user.id, data.job_listing_id)
    await db.commit()
    return Response(status_code=204)


@router.get("/job-emails/unseen", response_model=list[UnseenOut])
async def job_emails_unseen(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UnseenOut]:
    """Saved jobs with new emails, for the board's dot (spec 027)."""
    return [
        UnseenOut(saved_job_id=sid, count=n)
        for sid, n in await email_review.unseen_by_job(db, user.id)
    ]


@router.get("/new", response_model=list[DetectedEventOut])
async def new_on_your_jobs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DetectedEventOut]:
    """New emails on your jobs: kept on a job, not seen yet (14 days)."""
    account = await svc.get_account(db, user.id)
    rows = await email_review.list_new(db, user.id)
    return await _events_out(db, account.provider if account else "", rows)


@router.get("/looked-at", response_model=list[DetectedEventOut])
async def looked_at(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DetectedEventOut]:
    """Job-looking emails not put on a job (30 days): nothing disappears
    silently (spec 027)."""
    account = await svc.get_account(db, user.id)
    rows = await email_review.list_looked_at(db, user.id)
    return await _events_out(db, account.provider if account else "", rows)


@router.post("/events/{event_id}/keep", response_model=DetectedEventOut)
async def keep_event(
    event_id: uuid.UUID,
    data: KeepEventRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """ "This is about my job": put a looked-at email on that saved job. Not
    while a scan or re-check runs (it could place the same email)."""
    account = await svc.get_account(db, user.id)
    if account is not None and _SCAN_LOCKS.get(account.id, asyncio.Lock()).locked():
        raise HTTPException(
            status_code=409, detail="A scan is running. Try again in a moment."
        )
    ev = await email_review.keep_on_job(db, user.id, event_id, data.saved_job_id)
    await db.commit()
    (out,) = await _events_out(db, account.provider if account else "", [ev])
    return out


@router.post("/events/{event_id}/unkeep", response_model=DetectedEventOut)
async def unkeep_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Undo "This is about my job": back to Looked at, not shown."""
    ev = await email_review.unkeep(db, user.id, event_id)
    await db.commit()
    account = await svc.get_account(db, user.id)
    (out,) = await _events_out(db, account.provider if account else "", [ev])
    return out


@router.post("/events/{event_id}/dismiss", response_model=DetectedEventOut)
async def dismiss_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Reject a detected update — move nothing."""
    ev = await email_review.dismiss_event(db, user.id, event_id)
    await db.commit()
    return DetectedEventOut.model_validate(ev)


@router.post("/events/{event_id}/undo", response_model=DetectedEventOut)
async def undo_event(
    event_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedEventOut:
    """Reverse an applied update — put the card back where it was."""
    ev = await email_review.undo_event(db, user.id, event_id)
    await db.commit()
    return DetectedEventOut.model_validate(ev)
