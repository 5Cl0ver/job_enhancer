"""Pydantic schemas for SavedSearches and the New Matches feed (FR-024)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.job import JobListingSchema


class SavedSearchCreate(BaseModel):
    q: str = Field(min_length=1, max_length=255)
    location: str | None = Field(None, max_length=255)
    remote_only: bool = False
    salary_min: int | None = Field(None, ge=0)
    salary_max: int | None = Field(None, ge=0)
    experience: str | None = Field(None, pattern="^(entry|mid|senior)$")
    job_type: str | None = Field(None, max_length=50)
    name: str | None = Field(None, max_length=255)


class SavedSearchSchema(BaseModel):
    id: uuid.UUID
    name: str
    q: str
    location: str | None
    remote_only: bool
    salary_min: int | None
    salary_max: int | None
    experience: str | None
    job_type: str | None
    is_active: bool
    last_run_at: datetime | None
    last_viewed_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SearchMatches(BaseModel):
    search: SavedSearchSchema
    new_jobs: list[JobListingSchema]
    new_count: int


class NewMatchesResponse(BaseModel):
    matches: list[SearchMatches]
    total_new: int
