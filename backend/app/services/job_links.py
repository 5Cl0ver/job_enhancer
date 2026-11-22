"""Tie an email to the saved job it's really about, when the scan couldn't.

Two places the user can say "this is the same job":

- **A job made from an email** ("Same job as…"): :func:`link_job` moves its
  emails onto the real job, moves that job forward to the further stage of the
  two (never back), and archives the email-made copy. :func:`unlink_job` puts
  everything back.
- **An update about a job that isn't saved** ("It's one of my jobs"):
  :func:`link_event` puts the email on the chosen job and moves its card
  forward, like an approved update. The Email page's Undo reverses it.

Either way the email becomes an approved update on the real job, so the
sender is remembered: their next email goes to that job by itself.

:func:`rank_jobs` orders the user's saved jobs for the picker from what the app
kept about the emails (sender, subject, the names it read), never the body.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from email.utils import parseaddr

from fastapi import HTTPException
from rapidfuzz import fuzz
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.detected_event import STATUS_APPLIED, STATUS_UNSAVED, DetectedEvent
from app.models.job_listing import JobListing
from app.models.pipeline_stage import PipelineStage
from app.models.saved_job import ORIGIN_EMAIL, SavedJob
from app.schemas.job_link import JobOption, LinkResult, LinkUndo, MovedEvent
from app.services.email_match import (
    _company_terms,
    _domain_labels,
    _same_company,
    company_initials,
)
from app.services.email_scan import _stage_orders, card_action
from app.services.tracker import move_job_to_stage

LIKELY = 3  # the score at which a job is shown as a likely match
_RECENT = timedelta(days=120)


def _score(
    job: dict, *, company: str, title: str, subjects: str, labels: list[str]
) -> int:
    """How well one saved job fits what the emails say (0 = no sign)."""
    score = 0
    name = job.get("company") or ""
    _, rare, squashed = _company_terms(name)
    initials = company_initials(name)
    if company and _same_company(company, name):
        score += 4
    elif company and fuzz.token_set_ratio(company.lower(), name.lower()) >= 85:
        score += 3
    # The sender's own domain: careers.vellacor.example, dhs.example.gov.
    if any(
        label in (squashed, initials) or (len(label) >= 5 and label in rare)
        for label in labels
    ):
        score += 4
    words = re.findall(r"[a-z0-9]+", f"{subjects} {company}".lower())
    capitals = re.findall(r"\b[A-Z]{3,8}\b", subjects)
    if (initials and initials.upper() in capitals) or (
        rare and all(t in words for t in rare)
    ):
        score += 3
    # The title: what the email's name says, or the whole title in a subject.
    job_title = re.findall(r"[a-z0-9]+", (job.get("title") or "").lower())
    said = re.findall(r"[a-z0-9]+", subjects.lower())
    if (title and fuzz.token_sort_ratio(title.lower(), " ".join(job_title)) >= 85) or (
        len(job_title) >= 2 and f" {' '.join(job_title)} " in f" {' '.join(said)} "
    ):
        score += 3
    applied = job.get("applied_at")
    if score and applied and applied >= datetime.now(tz=UTC) - _RECENT:
        score += 1  # a recent application is likelier to get a reply
    return score


def rank_jobs(
    jobs: list[dict],
    *,
    company: str = "",
    title: str = "",
    subjects: list[str] = (),
    senders: list[str] = (),
) -> list[dict]:
    """Every job, likeliest first; each gets ``likely`` when the emails point
    at it. The rest follow newest application first, then newest saved."""
    labels = _domain_labels([parseaddr(s)[1].lower() for s in senders if s])
    text = "\n".join(subjects)
    scored = [
        (_score(j, company=company, title=title, subjects=text, labels=labels), j)
        for j in jobs
    ]

    def newest(j: dict) -> tuple:
        applied, saved = j.get("applied_at"), j.get("saved_at")
        return (
            applied is not None,
            applied or saved or datetime.min.replace(tzinfo=UTC),
        )

    scored.sort(key=lambda sj: (sj[0], newest(sj[1])), reverse=True)
    return [{**j, "likely": s >= LIKELY} for s, j in scored]


async def active_jobs(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """The user's active saved jobs with the names they see."""
    rows = (
        await db.execute(
            select(
                SavedJob.id,
                SavedJob.job_listing_id,
                SavedJob.applied_at,
                SavedJob.created_at,
                SavedJob.origin,
                func.coalesce(SavedJob.custom_company, JobListing.company).label(
                    "company"
                ),
                func.coalesce(SavedJob.custom_title, JobListing.title).label("title"),
                func.coalesce(SavedJob.custom_location, JobListing.location).label(
                    "location"
                ),
                PipelineStage.name.label("stage"),
            )
            .join(JobListing, SavedJob.job_listing_id == JobListing.id)
            .outerjoin(PipelineStage, SavedJob.pipeline_stage_id == PipelineStage.id)
            .where(SavedJob.user_id == user_id, SavedJob.is_archived.is_(False))
        )
    ).all()
    return [
        {
            "id": r.id,
            "job_listing_id": r.job_listing_id,
            "company": r.company,
            "title": r.title,
            "location": r.location,
            "stage": r.stage,
            "origin": r.origin,
            "applied_at": _aware(r.applied_at),
            "saved_at": _aware(r.created_at),
        }
        for r in rows
    ]


def _aware(when: datetime | None) -> datetime | None:
    return when.replace(tzinfo=UTC) if when and when.tzinfo is None else when


def _options(ranked: list[dict]) -> list[JobOption]:
    return [
        JobOption(
            saved_job_id=j["id"],
            title=j["title"],
            company=j["company"],
            location=j["location"] if j["location"] != "Not specified" else None,
            stage=j["stage"],
            likely=j["likely"],
        )
        for j in ranked
    ]


async def _own_job(db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> SavedJob:
    sj = await db.scalar(
        select(SavedJob).where(SavedJob.id == job_id, SavedJob.user_id == user_id)
    )
    if sj is None:
        raise HTTPException(status_code=404, detail="Saved job not found")
    return sj


async def _events_of(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID
) -> list[DetectedEvent]:
    return list(
        await db.scalars(
            select(DetectedEvent).where(
                DetectedEvent.user_id == user_id, DetectedEvent.saved_job_id == job_id
            )
        )
    )


# --------------------------------------------------------------------------- #
# A job made from an email
# --------------------------------------------------------------------------- #
async def job_options(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID
) -> list[JobOption]:
    """The jobs an email-made job could really be, likeliest first."""
    sj = await _own_job(db, user_id, job_id)
    jobs = await active_jobs(db, user_id)
    me = next((j for j in jobs if j["id"] == sj.id), None)
    events = await _events_of(db, user_id, sj.id)
    ranked = rank_jobs(
        [j for j in jobs if j["id"] != sj.id],
        company=(me or {}).get("company") or "",
        title=(me or {}).get("title") or "",
        subjects=[e.subject for e in events],
        senders=[e.from_addr for e in events],
    )
    return _options(ranked)


async def link_job(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID, target_id: uuid.UUID
) -> LinkResult:
    """The email-made job ``job_id`` is really ``target_id``: move its emails
    there, move that card forward if the email got further, archive the copy."""
    if job_id == target_id:
        raise HTTPException(status_code=422, detail="Pick a different job")
    dup = await _own_job(db, user_id, job_id)
    target = await _own_job(db, user_id, target_id)
    if dup.origin != ORIGIN_EMAIL:
        raise HTTPException(
            status_code=409, detail="Only a job made from an email can be linked"
        )
    if dup.is_archived or target.is_archived:
        raise HTTPException(status_code=409, detail="That job was already removed")

    before_stage, before_applied = target.pipeline_stage_id, target.applied_at
    _, order = await _stage_orders(db, user_id)
    mine, theirs = order.get(dup.pipeline_stage_id), order.get(target.pipeline_stage_id)
    moved_stage = mine is not None and (theirs is None or mine > theirs)
    if moved_stage:
        await move_job_to_stage(db, target.id, dup.pipeline_stage_id, user_id)
    if target.applied_at is None and dup.applied_at is not None:
        target.applied_at = dup.applied_at

    moved = []
    for ev in await _events_of(db, user_id, dup.id):
        moved.append(MovedEvent(id=ev.id, previous_stage_id=ev.previous_stage_id))
        ev.saved_job_id = target.id
        # The email's own Undo now puts the REAL job back where it was.
        ev.previous_stage_id = before_stage
    dup.is_archived = True
    await db.flush()
    return LinkResult(
        saved_job_id=target.id,
        job_listing_id=target.job_listing_id,
        stage=await _stage_name(db, target.pipeline_stage_id),
        undo=LinkUndo(
            target_id=target.id,
            events=moved,
            previous_stage_id=before_stage if moved_stage else None,
            stage_moved=moved_stage,
            previous_applied_at=before_applied,
        ),
    )


async def unlink_job(
    db: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID, undo: LinkUndo
) -> None:
    """Undo :func:`link_job`: the copy comes back with its emails, and the real
    job goes back to the stage it had (unless it has moved since)."""
    dup = await _own_job(db, user_id, job_id)
    target = await _own_job(db, user_id, undo.target_id)
    if dup.origin != ORIGIN_EMAIL or not dup.is_archived:
        raise HTTPException(status_code=409, detail="Nothing to undo")
    _, order = await _stage_orders(db, user_id)
    for item in undo.events:
        ev = await db.scalar(
            select(DetectedEvent).where(
                DetectedEvent.id == item.id,
                DetectedEvent.user_id == user_id,
                DetectedEvent.saved_job_id == target.id,
            )
        )
        if ev is None:
            continue
        ev.saved_job_id = dup.id
        if item.previous_stage_id is None or item.previous_stage_id in order:
            ev.previous_stage_id = item.previous_stage_id
    if undo.stage_moved and target.pipeline_stage_id == dup.pipeline_stage_id:
        back = undo.previous_stage_id
        await move_job_to_stage(db, target.id, back if back in order else None, user_id)
    if undo.previous_applied_at is None:  # it had no applied date before
        target.applied_at = None
    dup.is_archived = False
    await db.flush()


async def _stage_name(db: AsyncSession, stage_id: uuid.UUID | None) -> str | None:
    if stage_id is None:
        return None
    return await db.scalar(
        select(PipelineStage.name).where(PipelineStage.id == stage_id)
    )


# --------------------------------------------------------------------------- #
# An update about a job that isn't saved
# --------------------------------------------------------------------------- #
async def _unsaved_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> DetectedEvent:
    ev = await db.scalar(
        select(DetectedEvent).where(
            DetectedEvent.id == event_id, DetectedEvent.user_id == user_id
        )
    )
    if ev is None:
        raise HTTPException(status_code=404, detail="Update not found")
    if ev.status != STATUS_UNSAVED:
        raise HTTPException(status_code=409, detail="This update is already handled")
    return ev


def likely_job(event: DetectedEvent, jobs: list[dict]) -> dict | None:
    """The one saved job an unsaved update most likely belongs to, if the
    emails clearly point at one (a tie points at none)."""
    ranked = rank_jobs(
        jobs,
        company=event.job_company or "",
        title=event.job_title or "",
        subjects=[event.subject],
        senders=[event.from_addr],
    )
    likely = [j for j in ranked if j["likely"]]
    return likely[0] if len(likely) == 1 else None


async def event_options(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID
) -> list[JobOption]:
    """The saved jobs an unsaved update could be about, likeliest first."""
    ev = await _unsaved_event(db, user_id, event_id)
    ranked = rank_jobs(
        await active_jobs(db, user_id),
        company=ev.job_company or "",
        title=ev.job_title or "",
        subjects=[ev.subject],
        senders=[ev.from_addr],
    )
    return _options(ranked)


async def link_event(
    db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID, saved_job_id: uuid.UUID
) -> DetectedEvent:
    """The update is about this saved job: put it there, and move the card
    forward to the stage the email describes (never back)."""
    ev = await _unsaved_event(db, user_id, event_id)
    job = await _own_job(db, user_id, saved_job_id)
    if job.is_archived:
        raise HTTPException(status_code=404, detail="Saved job not found")
    by_name, by_id = await _stage_orders(db, user_id)
    move, _ = card_action(
        ev.target_stage,
        by_name,
        current_order=by_id.get(job.pipeline_stage_id),
        reminder=False,
    )
    ev.previous_stage_id = job.pipeline_stage_id
    if move and ev.target_stage in by_name:
        stage_id = await db.scalar(
            select(PipelineStage.id).where(
                PipelineStage.user_id == user_id, PipelineStage.name == ev.target_stage
            )
        )
        await move_job_to_stage(db, job.id, stage_id, user_id)
    ev.saved_job_id = job.id
    ev.status = STATUS_APPLIED
    ev.applied_at = datetime.now(tz=UTC)
    await db.flush()
    return ev
