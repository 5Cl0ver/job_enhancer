"""Pydantic schemas for SavedJobs."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.job import JobListingSchema


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


class JobSavedResult(BaseModel):
    saved: bool
    # True when the job is saved but its listing has no real description yet —
    # tells the extension "if you can see full details right now, send them".
    needs_details: bool = False


class BackfillResult(BaseModel):
    """Outcome of a passive detail backfill from the extension."""

    updated: bool
    fields: list[str] = []


class MarkAppliedRequest(BaseModel):
    """Auto-track: the extension saw an application get submitted. At least one
    of title/company is needed (Indeed's confirmation gives only the company)."""

    title: str = Field(default="", max_length=500)
    company: str = Field(default="", max_length=255)


class MarkAppliedResult(BaseModel):
    matched: bool


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

    applications: list[ApplicationSyncItem] = Field(default_factory=list, max_length=500)


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


class SavedJobUpdate(BaseModel):
    collection_id: uuid.UUID | None = None
    pipeline_stage_id: uuid.UUID | None = None
    notes: str | None = None
    applied_at: datetime | None = None
    is_archived: bool | None = None
    flagged_for_research: bool | None = None
    # Outreach email tracking. Send an ISO timestamp to mark "emailed", or null
    # to clear it. The route accepts both since the field is Optional.
    emailed_at: datetime | None = None


class SavedJobSchema(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    job_listing_id: uuid.UUID
    collection_id: uuid.UUID | None
    pipeline_stage_id: uuid.UUID | None
    notes: str | None
    applied_at: datetime | None
    last_stage_change: datetime
    is_archived: bool
    flagged_for_research: bool = False
    emailed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    job_listing: JobListingSchema

    model_config = {"from_attributes": True}
