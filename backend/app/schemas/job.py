"""Pydantic schemas for job listings — search responses and pagination."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class JobListingSchema(BaseModel):
    id: uuid.UUID
    external_id: str
    source: str
    title: str
    company: str
    location: str
    is_remote: bool
    description: str | None
    salary_min: int | None
    salary_max: int | None
    salary_period: str | None = None  # "yearly" (also when null) or "hourly"
    currency: str | None
    job_type: str | None
    apply_url: str
    posted_at: datetime | None
    is_expired: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedMeta(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class JobSearchResponse(BaseModel):
    results: list[JobListingSchema]
    meta: PaginatedMeta


class MatchResponse(BaseModel):
    """Resume ↔ job keyword coverage for the match score UI."""

    has_resume: bool
    has_description: bool
    score: int  # 0-100; meaningful only when both flags are true
    matched: list[str] = []
    missing: list[str] = []


class JobSearchParams(BaseModel):
    q: str
    location: str | None = None
    remote_only: bool = False
    salary_min: int | None = None
    job_type: str | None = None
    page: int = 1
    page_size: int = 20
