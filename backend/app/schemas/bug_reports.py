"""Pydantic schemas for Bugs & ideas (spec 032). Unknown sections, kinds,
severities and statuses are refused (422) here; the service cleans and caps
every text the same way for every source."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field

BugType = Literal["bug", "idea"]
Section = Literal["app", "job_catcher", "email", "scout", "apply", "other"]
Severity = Literal["blocker", "major", "minor"]
Confidence = Literal["sure", "not_sure"]
Status = Literal[
    "new", "confirmed", "working", "fixed", "wont_fix", "planned", "done", "no"
]
Step = Annotated[str, Field(max_length=300)]
Short = Annotated[str, Field(max_length=80)]


class BugContext(BaseModel):
    """Filled in by the app for the owner, never typed."""

    device: Short | None = None
    browser: Short | None = None
    theme: Short | None = None
    app_version: Short | None = None
    api_version: Short | None = None
    job_catcher: Short | None = None


class BugCreate(BaseModel):
    type: BugType = "bug"
    title: str = Field(min_length=1, max_length=140)
    section: Section = "app"
    place: str | None = Field(default=None, max_length=2000)
    box: str | None = Field(default=None, max_length=200)
    steps: list[Step] = Field(default_factory=list, max_length=12)
    actual: str = Field(default="", max_length=2000)
    expected: str = Field(default="", max_length=1000)
    severity: Severity | None = None
    confidence: Confidence = "sure"
    context: BugContext = Field(default_factory=BugContext)


class BugPatch(BaseModel):
    type: BugType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=140)
    section: Section | None = None
    place: str | None = Field(default=None, max_length=2000)
    box: str | None = Field(default=None, max_length=200)
    steps: list[Step] | None = Field(default=None, max_length=12)
    actual: str | None = Field(default=None, max_length=2000)
    expected: str | None = Field(default=None, max_length=1000)
    severity: Severity | None = None
    confidence: Confidence | None = None
    status: Status | None = None
    fixed_in: str | None = Field(default=None, max_length=60)
    pinned: bool | None = None
    # True: the owner looked at Claude's fix ("Looks fixed").
    checked: bool | None = None


class BugBulk(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    status: Status | None = None
    section: Section | None = None


class BugNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class BugLinkIn(BaseModel):
    other_id: uuid.UUID


class BugMergeIn(BaseModel):
    into_id: uuid.UUID
