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
    collection_id: uuid.UUID | None = None
    notes: str | None = None

    @field_validator("url")
    @classmethod
    def _http_only(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


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
