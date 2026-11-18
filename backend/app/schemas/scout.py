"""Pydantic schemas for Claude Scout (resume types now; missions and runs next)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

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
