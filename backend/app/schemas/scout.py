"""Pydantic schemas for Claude Scout: resume types, saved searches (missions),
runs, what they found, and the extension's exact page copies."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_TRACKS = 8


def _clean_list(values: list[str], limit: int, max_len: int) -> list[str]:
    """Trim, drop blanks and case-insensitive repeats, keep order."""
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        v = " ".join(str(v).split())
        if not v:
            continue
        if len(v) > max_len:
            raise ValueError(f"'{v[:30]}…' is longer than {max_len} characters")
        if v.lower() not in seen:
            seen.add(v.lower())
            out.append(v)
    if len(out) > limit:
        raise ValueError(f"at most {limit} entries")
    return out


class SkipRules(BaseModel):
    """What Claude Scout should pass over for this resume type."""

    # Skip jobs that require a degree with no "or equivalent experience".
    degree_only: bool = True
    # Skip jobs asking for more than this many years (None = no limit).
    max_years: int | None = Field(None, ge=0, le=40)
    # Words that rule a job out ("clearance", "SAP", "Director").
    exclude: list[str] = Field(default_factory=list)

    @field_validator("exclude")
    @classmethod
    def _exclude(cls, v: list[str]) -> list[str]:
        return _clean_list(v, 40, 60)


class TrackBase(BaseModel):
    target_titles: list[str] = Field(default_factory=list)
    key_skills: list[str] = Field(default_factory=list)
    skip_rules: SkipRules = Field(default_factory=SkipRules)
    min_pay: int | None = Field(None, ge=0, le=1_000_000)
    resume_id: uuid.UUID | None = None
    notes: str | None = Field(None, max_length=2000)

    @field_validator("target_titles")
    @classmethod
    def _titles(cls, v: list[str]) -> list[str]:
        return _clean_list(v, 15, 100)

    @field_validator("key_skills")
    @classmethod
    def _skills(cls, v: list[str]) -> list[str]:
        return _clean_list(v, 40, 60)


class TrackCreate(TrackBase):
    name: str = Field(..., min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("name can't be blank")
        return v


class TrackUpdate(BaseModel):
    """Partial update: only the fields sent change."""

    name: str | None = Field(None, min_length=1, max_length=60)
    target_titles: list[str] | None = None
    key_skills: list[str] | None = None
    skip_rules: SkipRules | None = None
    min_pay: int | None = Field(None, ge=0, le=1_000_000)
    resume_id: uuid.UUID | None = None
    notes: str | None = Field(None, max_length=2000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else TrackCreate._name(v)

    @field_validator("target_titles")
    @classmethod
    def _titles(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _clean_list(v, 15, 100)

    @field_validator("key_skills")
    @classmethod
    def _skills(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _clean_list(v, 40, 60)


class TrackOut(BaseModel):
    id: uuid.UUID
    name: str
    target_titles: list[str]
    key_skills: list[str]
    skip_rules: SkipRules
    min_pay: int | None
    resume_id: uuid.UUID | None
    # The attached resume's file name, so the page can show it without a lookup.
    resume_filename: str | None = None
    notes: str | None
    sort_order: int
    # Saved jobs tagged with this resume type.
    job_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# --------------------------------------------------------------------------- #
# Missions (saved searches) and runs
# --------------------------------------------------------------------------- #
Source = Literal["linkedin", "indeed", "ziprecruiter"]
Remote = Literal["any", "remote_only", "no_remote"]
POSTED_WITHIN = (1, 3, 7, 14, 30)
MAX_JOBS_PER_RUN = 10


# "Within N miles" of the search's city. The three boards all take these.
Radius = Literal[5, 10, 25, 50, 100]


class MissionCreate(BaseModel):
    source: Source
    track_id: uuid.UUID
    name: str | None = Field(None, max_length=80)  # blank = made from the rest
    job_count: int = Field(5, ge=1, le=MAX_JOBS_PER_RUN)
    posted_within_days: int = 7
    min_pay: int | None = Field(None, ge=0, le=1_000_000)
    location: str | None = Field(None, max_length=120)
    radius_miles: Radius | None = None
    remote: Remote = "any"
    min_fit: int = Field(6, ge=0, le=10)
    extra_instructions: str | None = Field(None, max_length=1000)

    @field_validator("posted_within_days")
    @classmethod
    def _posted(cls, v: int) -> int:
        if v not in POSTED_WITHIN:
            raise ValueError(f"must be one of {', '.join(map(str, POSTED_WITHIN))}")
        return v

    @field_validator("name", "location", "extra_instructions")
    @classmethod
    def _tidy(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return " ".join(v.split()) or None


class MissionUpdate(BaseModel):
    source: Source | None = None
    track_id: uuid.UUID | None = None
    name: str | None = Field(None, max_length=80)
    job_count: int | None = Field(None, ge=1, le=MAX_JOBS_PER_RUN)
    posted_within_days: int | None = None
    min_pay: int | None = Field(None, ge=0, le=1_000_000)
    location: str | None = Field(None, max_length=120)
    radius_miles: Radius | None = None
    remote: Remote | None = None
    min_fit: int | None = Field(None, ge=0, le=10)
    extra_instructions: str | None = Field(None, max_length=1000)

    @field_validator("posted_within_days")
    @classmethod
    def _posted(cls, v: int | None) -> int | None:
        return None if v is None else MissionCreate._posted(v)

    @field_validator("name", "location", "extra_instructions")
    @classmethod
    def _tidy(cls, v: str | None) -> str | None:
        return MissionCreate._tidy(v)


class MissionOut(BaseModel):
    id: uuid.UUID
    name: str
    source: str
    track_id: uuid.UUID
    job_count: int
    posted_within_days: int
    min_pay: int | None
    location: str | None
    radius_miles: int | None = None
    remote: str
    min_fit: int
    extra_instructions: str | None
    last_run_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class FindingOut(BaseModel):
    id: uuid.UUID
    outcome: str
    source: str
    url: str
    company: str
    title: str
    fit_score: int
    why_fit: str
    gaps: str
    app_note: str | None
    saved_job_id: uuid.UUID | None
    job_listing_id: uuid.UUID | None = None  # for the "open job" link
    created_at: datetime

    model_config = {"from_attributes": True}


class RunCounts(BaseModel):
    saved: int = 0
    below_bar: int = 0
    duplicate: int = 0
    waiting_for_copy: int = 0
    no_copy: int = 0


class RunOut(BaseModel):
    id: uuid.UUID
    mission_id: uuid.UUID | None
    name: str
    source: str
    track_name: str
    target: int
    status: str
    note: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    counts: RunCounts
    findings: list[FindingOut] = Field(default_factory=list)


class ActiveRunOut(BaseModel):
    """For the extension: is a run open, so job pages should be captured?"""

    run_id: uuid.UUID | None


class CaptureIn(BaseModel):
    """A posting as the extension read it off the page (``extractJob``)."""

    url: str = Field(..., min_length=8, max_length=2000)
    title: str = Field(..., min_length=1, max_length=500)
    company: str = Field(..., min_length=1, max_length=255)
    location: str | None = Field(None, max_length=255)
    is_remote: bool = False
    description: str = Field(..., min_length=200)
    salary_min: int | None = None
    salary_max: int | None = None
    salary_period: Literal["yearly", "hourly"] | None = None
    job_type: str | None = Field(None, max_length=50)
    via: str | None = Field(None, max_length=20)

    @field_validator("salary_min", "salary_max", mode="before")
    @classmethod
    def _salary(cls, v: object) -> object:
        if isinstance(v, (int, float)):
            n = round(v)
            return n if n > 0 else None
        return v

    @model_validator(mode="after")
    def _period(self) -> "CaptureIn":
        if self.salary_min is None and self.salary_max is None:
            self.salary_period = None
        return self


class CaptureOut(BaseModel):
    stored: bool
