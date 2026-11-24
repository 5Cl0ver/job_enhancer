"""Pydantic schemas for User endpoints."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, StrictInt, field_validator


class UserProfile(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str | None = None
    image: str | None = None
    role: str
    follow_up_days: int
    claude_project_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminJobCatcher(BaseModel):
    version: str
    last_seen_at: datetime
    outdated: bool


class AdminUserRow(UserProfile):
    """A row of the owner's user list (spec 019 part C, US7)."""

    last_active_at: datetime | None = None
    # welcome_done, resume, profile, job_catcher, first_job, email, claude
    onboarding: dict[str, bool]
    job_catcher: AdminJobCatcher | None = None
    usage_today: dict[str, int]
    usage_month: dict[str, int]


class AllowancesIn(BaseModel):
    """The owner's allowance numbers (validated in services/allowance)."""

    model_config = {"extra": "forbid"}

    ai_document: StrictInt | None = Field(None, ge=0, le=10_000)
    ai_read: StrictInt | None = Field(None, ge=0, le=10_000)
    ai_autofill: StrictInt | None = Field(None, ge=0, le=10_000)
    live_search: StrictInt | None = Field(None, ge=0, le=10_000)
    jsearch_month_cap: StrictInt | None = Field(None, ge=0, le=10_000)
    jsearch_owner_reserve: StrictInt | None = Field(None, ge=0, le=10_000)


CLAUDE_URL_PREFIX = "https://claude.ai/"


class UserUpdate(BaseModel):
    name: str | None = None
    follow_up_days: int | None = Field(None, ge=1, le=90)
    claude_project_url: str | None = Field(None, max_length=2048)

    @field_validator("claude_project_url")
    @classmethod
    def _http_or_empty(cls, v: str | None) -> str | None:
        # Empty string clears it; otherwise only a claude.ai address (it's
        # opened from the app and Job Catcher, so nothing else may ride in).
        if not v:
            return None
        if not v.startswith(CLAUDE_URL_PREFIX) or any(c.isspace() for c in v):
            raise ValueError("Claude project link must start with https://claude.ai/")
        return v


class ClaudeProjectUpdate(BaseModel):
    """Just the Claude Project link (Job Catcher's one account setting)."""

    claude_project_url: str | None = Field(None, max_length=2048)

    _http_or_empty = field_validator("claude_project_url")(
        UserUpdate._http_or_empty.__func__  # type: ignore[attr-defined]
    )


class AdminUserUpdate(BaseModel):
    """Admin-only change to another user's role (promote/demote)."""

    role: Literal["user", "admin"]


class LanguageEntry(BaseModel):
    """One language the user speaks (spec 020): fluent/native, and levels from
    1 (beginner) to 5 (fluent) per ability. Unset levels stay unset."""

    language: str = Field(min_length=1, max_length=60)
    native: bool = False
    comprehension: int | None = Field(None, ge=1, le=5)
    reading: int | None = Field(None, ge=1, le=5)
    speaking: int | None = Field(None, ge=1, le=5)
    writing: int | None = Field(None, ge=1, le=5)
    overall: int | None = Field(None, ge=1, le=5)

    @field_validator("language")
    @classmethod
    def _named(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Name the language")
        return v


class ApplicationProfileSchema(BaseModel):
    """The "profile vault": answers job applications always ask for. Everything
    optional — the user shares only what they want. Consumed by ATS autofill."""

    first_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=50)
    address_line1: str | None = Field(None, max_length=255)
    address_line2: str | None = Field(None, max_length=255)
    city: str | None = Field(None, max_length=100)
    state: str | None = Field(None, max_length=100)
    postal_code: str | None = Field(None, max_length=20)
    country: str | None = Field(None, max_length=100)
    linkedin_url: str | None = Field(None, max_length=500)
    github_url: str | None = Field(None, max_length=500)
    portfolio_url: str | None = Field(None, max_length=500)
    authorized_to_work: bool | None = None
    requires_sponsorship: bool | None = None
    willing_to_relocate: bool | None = None
    desired_salary: int | None = Field(None, ge=0)
    notice_period: str | None = Field(None, max_length=100)
    languages: list[LanguageEntry] | None = Field(None, max_length=10)

    @field_validator("linkedin_url", "github_url", "portfolio_url")
    @classmethod
    def _http_only(cls, v: str | None) -> str | None:
        # Empty string means "clear the field"; anything else must be a URL.
        if not v:
            return None
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v

    @field_validator("phone")
    @classmethod
    def _dialable(cls, v: str | None) -> str | None:
        # The frontend formats/validates properly (libphonenumber); this is the
        # backstop: a phone must at least be 7-15 digits (E.164 range).
        if not v:
            return None
        digits = sum(c.isdigit() for c in v)
        if not 7 <= digits <= 15:
            raise ValueError("Enter a real phone number")
        return v

    model_config = {"from_attributes": True}


class CustomAnswerSchema(BaseModel):
    """One learned answer to a question the profile vault can't map."""

    question_key: str = Field(min_length=1, max_length=255)
    question_text: str = Field(min_length=1, max_length=500)
    answer: str = Field(min_length=1)
    # Optional so the extension's upserts (which omit these) still validate; the
    # GET populates them from the row for the Answer Library / insights view.
    updated_at: datetime | None = None
    use_count: int = 0
    last_used_at: datetime | None = None

    model_config = {"from_attributes": True}


class CustomAnswersUsed(BaseModel):
    """Question keys autofill just reused — bump their usage insights."""

    question_keys: list[str] = Field(default_factory=list, max_length=200)


class CustomAnswersUpsert(BaseModel):
    """Bulk save of answers the user just taught us (learn-as-you-go)."""

    answers: list[CustomAnswerSchema] = Field(default_factory=list, max_length=200)


class ProfileFillResult(BaseModel):
    """Outcome of 'Fill from resume': the updated vault + which fields the
    resume was able to fill (empty ones only — user answers are never touched)."""

    profile: ApplicationProfileSchema
    filled: list[str]
