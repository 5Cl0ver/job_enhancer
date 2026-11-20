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
Source = Literal["linkedin", "indeed", "ziprecruiter", "google_jobs", "local_companies"]
Remote = Literal["any", "remote_only", "no_remote"]
POSTED_WITHIN = (1, 3, 7, 14, 30)
MAX_JOBS_PER_RUN = 10


# "Within N miles" of the search's city. The three boards all take these.
Radius = Literal[5, 10, 25, 50, 100]


def place_problem(source: str, location: str | None, remote: str) -> str | None:
    """Why a search can't run where it's set to look, or None. Local companies
    are found around a place, so that search needs one (and on-site work)."""
    if source != "local_companies":
        return None
    if not location:
        return "Add a city or area: Scout looks for companies near it."
    if remote == "remote_only":
        return (
            "Local companies are near you: choose on-site or hybrid, not remote only."
        )
    return None


class Overrides(BaseModel):
    """A broad search's overrides: titles always searched, titles never
    searched, and words that skip a job without opening it."""

    always: list[str] = Field(default_factory=list)
    never: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)

    @field_validator("always", "never", "avoid")
    @classmethod
    def _lists(cls, v: list[str]) -> list[str]:
        return _clean_list(v, 20, 80)


class MissionCreate(BaseModel):
    source: Source
    # Required unless ``broad``: then the search uses the user's hidden
    # "Anything I'd be good at" track and Claude chooses the titles.
    track_id: uuid.UUID | None = None
    broad: bool = False
    overrides: Overrides | None = None
    name: str | None = Field(None, max_length=80)  # blank = made from the rest
    job_count: int = Field(5, ge=1, le=MAX_JOBS_PER_RUN)
    posted_within_days: int = 7
    min_pay: int | None = Field(None, ge=0, le=1_000_000)
    location: str | None = Field(None, max_length=120)
    radius_miles: Radius | None = None
    remote: Remote = "any"
    min_fit: int = Field(6, ge=0, le=10)
    extra_instructions: str | None = Field(None, max_length=1000)
    # Where good fits are saved; null = a collection named after the resume type.
    collection_id: uuid.UUID | None = None
    # Save good fits without asking first.
    auto_save: bool = False

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

    @model_validator(mode="after")
    def _place(self) -> "MissionCreate":
        problem = place_problem(self.source, self.location, self.remote)
        if problem:
            raise ValueError(problem)
        if not self.broad and self.track_id is None:
            raise ValueError("Choose a resume type, or Anything I'd be good at.")
        return self


class MissionUpdate(BaseModel):
    source: Source | None = None
    track_id: uuid.UUID | None = None
    broad: bool | None = None
    overrides: Overrides | None = None
    name: str | None = Field(None, max_length=80)
    job_count: int | None = Field(None, ge=1, le=MAX_JOBS_PER_RUN)
    posted_within_days: int | None = None
    min_pay: int | None = Field(None, ge=0, le=1_000_000)
    location: str | None = Field(None, max_length=120)
    radius_miles: Radius | None = None
    remote: Remote | None = None
    min_fit: int | None = Field(None, ge=0, le=10)
    extra_instructions: str | None = Field(None, max_length=1000)
    collection_id: uuid.UUID | None = None
    auto_save: bool | None = None

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
    # "Anything I'd be good at": Claude chooses the titles.
    broad: bool = False
    overrides: Overrides | None = None
    job_count: int
    posted_within_days: int
    min_pay: int | None
    location: str | None
    radius_miles: int | None = None
    remote: str
    min_fit: int
    extra_instructions: str | None
    collection_id: uuid.UUID | None = None
    auto_save: bool = False
    # The collection good fits go into: the one chosen, or the name the one for
    # this resume type has (or will get the first time something is saved).
    collection_name: str = ""
    last_run_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RunFolder(BaseModel):
    """A collection jobs go into. ``id`` is null while it doesn't exist yet (it
    is made the first time something is saved into it)."""

    id: uuid.UUID | None
    name: str


class _Where(BaseModel):
    """Which collection to save into: one of the user's, or a new one by name.
    Neither = the search's own."""

    collection_id: uuid.UUID | None = None
    new_collection_name: str | None = Field(None, max_length=100)

    @field_validator("new_collection_name")
    @classmethod
    def _tidy_name(cls, v: str | None) -> str | None:
        return (" ".join(v.split()) or None) if v is not None else None

    @model_validator(mode="after")
    def _one_place(self):
        if self.collection_id is not None and self.new_collection_name:
            raise ValueError("Choose a collection or name a new one, not both.")
        return self


class ConfirmIn(_Where):
    """The user's answer to a run's review: the findings they ticked."""

    finding_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    # The findings the user was looking at. Only picks among these that are
    # left unticked are passed on: one Claude reported a moment ago, after the
    # page last refreshed, stays waiting. Null = every pick in the run.
    shown_ids: list[uuid.UUID] | None = Field(None, max_length=200)


class SaveFindingIn(_Where):
    pass


class FindingSaved(BaseModel):
    finding_id: uuid.UUID
    saved_job_id: uuid.UUID | None


class FindingFailed(BaseModel):
    finding_id: uuid.UUID
    reason: str


class ConfirmOut(BaseModel):
    saved: list[FindingSaved] = Field(default_factory=list)
    already: list[FindingSaved] = Field(default_factory=list)
    failed: list[FindingFailed] = Field(default_factory=list)
    folder: RunFolder


class SaveFindingOut(BaseModel):
    finding_id: uuid.UUID
    saved_job_id: uuid.UUID | None
    already: bool = False
    folder: RunFolder


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
    # The collection a saved finding's job is in.
    collection_id: uuid.UUID | None = None
    collection_name: str | None = None
    # The user can still put it in My Jobs (its page copy exists).
    can_save: bool = False
    # Broad searches: the resume type Claude said this job is closest to.
    closest_track_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RunCounts(BaseModel):
    picked: int = 0
    saved: int = 0
    skipped: int = 0
    below_bar: int = 0
    duplicate: int = 0
    waiting_for_copy: int = 0
    no_copy: int = 0


class RunTitle(BaseModel):
    title: str
    good_fits: int = 0


class TitleTried(BaseModel):
    """A title a broad search has tried, for its settings."""

    title: str
    runs: int
    good_fits: int
    last_tried_at: datetime | None
    # Found nothing in 3 runs: left out for 2 weeks (never an Always title).
    resting: bool
    always: bool
    never: bool


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
    # Picks are waiting for the user to tick and save.
    needs_review: bool = False
    # Where a confirm would save by default (single-run view only).
    folder: RunFolder | None = None
    # The result rows Claude checked, and why some were passed over.
    looked_at: dict[str, int] | None = None
    # What to change when a finished search came back short.
    tip: str | None = None
    # Which instructions it used: per section, when the user's edit was made
    # (null = the original). Null for runs from before spec 010.
    instructions: dict[str, str | None] | None = None
    # "Anything I'd be good at": the titles this run searched, with good fits.
    broad: bool = False
    titles: list["RunTitle"] = Field(default_factory=list)
    findings: list[FindingOut] = Field(default_factory=list)


class ActiveRunOut(BaseModel):
    """For the extension: is a run open, so job pages should be captured?"""

    run_id: uuid.UUID | None
    # Copy job pages on any site, not only the three job boards: a Google Jobs
    # or Local companies run that Claude has started.
    any_site: bool = False


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


# --------------------------------------------------------------------------- #
# Local companies a search checked
# --------------------------------------------------------------------------- #
class CompanyOut(BaseModel):
    id: uuid.UUID
    name: str
    website: str | None
    careers_url: str | None
    last_checked_at: datetime | None
    times_checked: int
    # "openings", "none", "no_careers" from the latest report; null until one.
    last_result: str | None
    never_check: bool
    # Due for a check on the next run.
    due: bool = False

    model_config = {"from_attributes": True}


class CompanyUpdate(BaseModel):
    """``never_check``: stop (or start again) checking it. ``check_next``: put
    it first in line for the next run."""

    never_check: bool | None = None
    check_next: bool = False


# --------------------------------------------------------------------------- #
# The Instructions page and the run log (spec 010)
# --------------------------------------------------------------------------- #
class InstructionSection(BaseModel):
    key: str
    title: str
    kind: Literal["text", "rubric", "limits"]
    original: str | dict[str, int]
    current: str | dict[str, int]
    edited: bool
    edited_at: datetime | None
    # The app's own original changed since the user edited this.
    original_changed: bool = False
    ranges: dict[str, list[int]] | None = None
    labels: dict[str, str] | None = None


class InstructionsOut(BaseModel):
    sections: list[InstructionSection]
    # The scoring line Claude gets, made from the current weights.
    rubric_text: str
    # Always sent after the main steps; never editable.
    locked_rules: str
    # What the connector tells Claude about itself, and each Scout tool.
    connector_note: str
    tools: list[dict[str, str]]
    fixed_limits: list[dict[str, str]]


class InstructionSave(BaseModel):
    """A text section's new text, or the numbers for scoring and limits."""

    text: str | None = Field(None, max_length=20000)
    values: dict[str, int] | None = None


class InstructionVersionOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    # A "reset to original" entry.
    reset: bool
    body: str | dict[str, int]


class RunEventOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    tool: str
    summary: str
    ok: bool
    request: dict | None
    response: dict | None

    model_config = {"from_attributes": True}
