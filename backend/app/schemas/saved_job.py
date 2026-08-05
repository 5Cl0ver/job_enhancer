"""Pydantic schemas for SavedJobs."""

import uuid
from datetime import datetime

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
    job_type: str | None = Field(default=None, max_length=50)
    collection_id: uuid.UUID | None = None
    notes: str | None = None

    @field_validator("salary_min", "salary_max", mode="before")
    @classmethod
    def _round_salary(cls, v: object) -> object:
        # Sites list salaries with cents (Indeed: "$80,708.90 a year"). The
        # strict int fields rejected those floats (422 int_from_float) and the
        # save failed — round instead; nobody needs the cents.
        if isinstance(v, float):
            return round(v)
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


class SavedJobUpdate(BaseModel):
    collection_id: uuid.UUID | None = None
    pipeline_stage_id: uuid.UUID | None = None
    notes: str | None = None
    applied_at: datetime | None = None
    is_archived: bool | None = None


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
    created_at: datetime
    updated_at: datetime
    job_listing: JobListingSchema

    model_config = {"from_attributes": True}
