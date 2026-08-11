"""Pydantic schemas for User endpoints."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserProfile(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str | None = None
    image: str | None = None
    role: str
    follow_up_days: int
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    name: str | None = None
    follow_up_days: int | None = Field(None, ge=1, le=90)


class AdminUserUpdate(BaseModel):
    """Admin-only change to another user's role (promote/demote)."""

    role: Literal["user", "admin"]


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
    # Optional so the extension's upserts (which omit it) still validate; the
    # GET populates it from the row for the Settings dashboard.
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class CustomAnswersUpsert(BaseModel):
    """Bulk save of answers the user just taught us (learn-as-you-go)."""

    answers: list[CustomAnswerSchema] = Field(default_factory=list, max_length=200)


class ProfileFillResult(BaseModel):
    """Outcome of 'Fill from resume': the updated vault + which fields the
    resume was able to fill (empty ones only — user answers are never touched)."""

    profile: ApplicationProfileSchema
    filled: list[str]
