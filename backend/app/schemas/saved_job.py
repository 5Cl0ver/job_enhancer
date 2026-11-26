"""Pydantic schemas for SavedJobs."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.job import JobListingSchema, JobListingSummarySchema


class SavedJobCreate(BaseModel):
    job_listing_id: uuid.UUID
    collection_id: uuid.UUID | None = None
    notes: str | None = None


class ManualJobCreate(BaseModel):
    """A job the user found on an external site (FR-004a)."""

    url: str = Field(min_length=8, max_length=2000)
    title: str = Field(min_length=1, max_length=500)
    company: str = Field(min_length=1, max_length=255)
    location: str = Field(default="Not specified", max_length=255)
    is_remote: bool = False
    # Optional richer detail the extension can capture from the page.
    description: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_period: Literal["yearly", "hourly"] | None = None
    job_type: str | None = Field(default=None, max_length=50)
    collection_id: uuid.UUID | None = None
    notes: str | None = None
    # Job Catcher says "extension"; the app's own form leaves it. Every other
    # origin is set by the server, never taken from a request.
    origin: Literal["manual", "extension"] = "manual"

    @field_validator("salary_min", "salary_max", mode="before")
    @classmethod
    def _round_salary(cls, v: object) -> object:
        # Sites list salaries with cents (Indeed: "$80,708.90 a year"). Round
        # them. Also drop non-positive sentinels — Indeed sends -1 for "no max",
        # which otherwise displayed as "$80,000 – -$1".
        if isinstance(v, (int, float)):
            n = round(v)
            return n if n > 0 else None
        return v

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


class JobSavedCheck(BaseModel):
    """Ask whether a job is already in the user's tracker (extension pre-check)."""

    title: str = Field(min_length=1, max_length=500)
    company: str = Field(default="", max_length=255)
    location: str = Field(default="", max_length=255)
    # The page's link: matches a job saved before its page was read (spec 015).
    url: str = Field(default="", max_length=2000)


class JobSavedResult(BaseModel):
    saved: bool
    # True when the job is saved but its listing has no real description yet —
    # tells the extension "if you can see full details right now, send them".
    needs_details: bool = False


class BackfillResult(BaseModel):
    """Outcome of a passive detail backfill from the extension."""

    updated: bool
    fields: list[str] = []


class AppliedJobCreate(BaseModel):
    """A job read off an application the user just submitted (spec 034)."""

    url: str = Field(min_length=8, max_length=2000)
    title: str = Field(min_length=1, max_length=500)
    company: str = Field(min_length=1, max_length=255)
    location: str = Field(default="Not specified", max_length=255)

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v

    @field_validator("title", "company", "location", mode="before")
    @classmethod
    def _trim(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class MarkAppliedRequest(BaseModel):
    """Auto-track: the extension saw an application get submitted. At least one
    of title/company is needed (Indeed's confirmation gives only the company)."""

    title: str = Field(default="", max_length=500)
    company: str = Field(default="", max_length=255)
    # The saved job itself, when the caller knows it (the side panel's linked
    # job): that one is moved, no matching by name.
    saved_job_id: uuid.UUID | None = None
    # The job read off the application itself (spec 034, Workday): when no
    # saved job matches, it's saved from these and marked applied. The user
    # did apply, so it's tracked.
    create: AppliedJobCreate | None = None


class MarkAppliedResult(BaseModel):
    matched: bool
    # Saved just now from the application (spec 034): it wasn't in My Jobs.
    created: bool = False


class ApplicationSyncItem(BaseModel):
    """One application read off a job board's 'My jobs' / applied list. The
    extension has already mapped the board's status badge to a target pipeline
    stage NAME (e.g. Indeed 'Not selected by employer' → 'Rejected')."""

    title: str = Field(min_length=1, max_length=500)
    company: str = Field(default="", max_length=255)
    location: str = Field(default="Not specified", max_length=255)
    # The job's link if the board exposed one; used as the listing URL on import.
    url: str | None = Field(default=None, max_length=2000)
    stage: str = Field(default="Applied", max_length=100)
    applied_at: datetime | None = None


class ApplicationSyncRequest(BaseModel):
    """Bulk sync of applications the user already made on a job board."""

    applications: list[ApplicationSyncItem] = Field(
        default_factory=list, max_length=500
    )


class ApplicationSyncOutcome(BaseModel):
    title: str
    company: str
    stage: str
    # updated = matched an existing saved job; imported = created a new one;
    # skipped = unusable row or an unexpected duplicate collision.
    action: Literal["updated", "imported", "skipped"]


class ApplicationSyncResult(BaseModel):
    updated: int = 0
    imported: int = 0
    skipped: int = 0
    outcomes: list[ApplicationSyncOutcome] = Field(default_factory=list)


class ListingRename(BaseModel):
    """Fix (or confirm) a saved job's name, place or link, for this user only.
    Only what's sent changes."""

    title: str | None = Field(None, min_length=1, max_length=500)
    company: str | None = Field(None, min_length=1, max_length=255)
    location: str | None = Field(None, max_length=255)
    apply_url: str | None = Field(None, min_length=8, max_length=2000)

    @field_validator("title", "company", "location")
    @classmethod
    def _tidy(cls, v: str | None) -> str | None:
        return " ".join(v.split()) if v is not None else None

    @field_validator("apply_url")
    @classmethod
    def _http_only(cls, v: str | None) -> str | None:
        if v is not None and not v.startswith(("http://", "https://")):
            raise ValueError("The link must start with http:// or https://")
        return v

    @model_validator(mode="after")
    def _something(self):
        if not any(
            v for v in (self.title, self.company, self.location, self.apply_url)
        ):
            raise ValueError("Send at least one of title, company, place or link.")
        if self.title == "" or self.company == "":
            raise ValueError("The title and company can't be empty.")
        return self


class SavedJobUpdate(BaseModel):
    collection_id: uuid.UUID | None = None
    pipeline_stage_id: uuid.UUID | None = None
    notes: str | None = None
    # The resume type to apply with (must be one of the user's); null clears it.
    track_id: uuid.UUID | None = None
    applied_at: datetime | None = None
    is_archived: bool | None = None
    flagged_for_research: bool | None = None
    # Outreach email tracking. Send an ISO timestamp to mark "emailed", or null
    # to clear it. The route accepts both since the field is Optional.
    emailed_at: datetime | None = None


class ScoutFit(BaseModel):
    """Claude Scout's score for a job it found, and the run that found it."""

    fit_score: int
    run_id: uuid.UUID


class SavedJobBase(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    job_listing_id: uuid.UUID
    collection_id: uuid.UUID | None
    pipeline_stage_id: uuid.UUID | None
    track_id: uuid.UUID | None = None
    # The résumé chosen for this job (spec 020); null = the usual one.
    resume_id: uuid.UUID | None = None
    # The cover letter that goes with this job (spec 031); null = none.
    cover_letter_id: uuid.UUID | None = None
    # scout | email | extension | claude | search | manual; null = not known.
    origin: str | None = None
    scout: ScoutFit | None = None
    # Made from an email, and its name may be wrong (a sentence for a title,
    # the sender's own name for the company): the app asks the user to check.
    name_doubtful: bool = False
    # The user's own name for the job; folded into ``job_listing`` below, so
    # every client shows it without knowing it exists.
    custom_title: str | None = Field(None, exclude=True)
    custom_company: str | None = Field(None, exclude=True)
    custom_location: str | None = Field(None, exclude=True)
    custom_apply_url: str | None = Field(None, exclude=True)
    # The user has fixed or confirmed this job's name.
    renamed: bool = False
    notes: str | None
    applied_at: datetime | None
    last_stage_change: datetime
    is_archived: bool
    flagged_for_research: bool = False
    emailed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


def _own_names(item):
    """Show the user's own name, place and link in place of the listing's."""
    own = {
        "title": item.custom_title,
        "company": item.custom_company,
        "location": item.custom_location,
        "apply_url": item.custom_apply_url,
    }
    item.renamed = any(v is not None for v in own.values())
    listing = getattr(item, "job_listing", None)
    if listing is not None:
        for field, value in own.items():
            if value:
                setattr(listing, field, value)
    return item


class SavedJobSchema(SavedJobBase):
    """A saved job with its listing's full description."""

    job_listing: JobListingSchema

    @model_validator(mode="after")
    def _names(self):
        return _own_names(self)


class SavedJobSummary(BaseModel):
    """The few fields the extension's side panel shows for a saved job."""

    id: uuid.UUID
    job_listing_id: uuid.UUID
    title: str
    company: str
    location: str
    url: str
    applied_at: datetime | None = None
    # The résumé Job Catcher uses for this job: its own, else its résumé
    # type's; null = the usual one (spec 020).
    resume_id: uuid.UUID | None = None
    # The user picked "your usual résumé" for this job on purpose.
    resume_usual: bool = False
    # The cover letter Job Catcher attaches or pastes (spec 031); null = none.
    cover_letter_id: uuid.UUID | None = None


class JobResumeIn(BaseModel):
    """Choose the résumé for one saved job. ``usual``: the usual résumé, on
    purpose (the résumé type's is not used). Neither: back to the default."""

    resume_id: uuid.UUID | None = None
    usual: bool = False


class JobCoverLetterIn(BaseModel):
    """Choose the cover letter for one saved job; null = none."""

    cover_letter_id: uuid.UUID | None = None


class SavedJobSummaryResponse(BaseModel):
    """``changed`` is False (and ``jobs`` omitted) when the caller's ``version``
    is still current — the list itself is never read in that case."""

    version: str
    changed: bool
    jobs: list[SavedJobSummary] | None = None


class SavedJobListItem(SavedJobBase):
    """A saved job for lists and the board: listing preview, no description."""

    job_listing: JobListingSummarySchema

    @model_validator(mode="after")
    def _names(self):
        return _own_names(self)


class SourceFolder(BaseModel):
    id: uuid.UUID
    name: str


class SourceScout(BaseModel):
    run_id: uuid.UUID
    finding_id: uuid.UUID
    source: str
    search_name: str
    fit_score: int
    why_fit: str
    gaps: str
    found_at: datetime


class SourceEmail(BaseModel):
    event_id: uuid.UUID
    event_type: str
    email_date: datetime | None
    mail_link: str | None
    mail_search_link: str | None


class JobSourceOut(BaseModel):
    """Where a saved job came from, for the job page's "Where this came from"."""

    origin: str | None
    saved_at: datetime
    collection: SourceFolder | None = None
    scout: SourceScout | None = None
    email: SourceEmail | None = None
