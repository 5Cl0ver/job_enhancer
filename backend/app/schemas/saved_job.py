"""Pydantic schemas for SavedJobs."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.job import JobListingSchema


class SavedJobCreate(BaseModel):
    job_listing_id: uuid.UUID
    collection_id: uuid.UUID | None = None
    notes: str | None = None


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
