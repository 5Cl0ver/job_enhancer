"""Request bodies for Apply with Claude (spec 022). Responses are the plain
dicts from services/apply_runs.view (documented in the spec's plan)."""

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class ApplyStart(BaseModel):
    saved_job_id: uuid.UUID
    # A résumé the user picked (spec 025): Claude skips writing one.
    resume_id: uuid.UUID | None = None
    # Page by page (the default) or Keep going (spec 033).
    mode: Literal["page", "keep"] = "page"


class AnswerIn(BaseModel):
    id: str = Field(max_length=40)
    answer: str | None = Field(default=None, max_length=2000)
    skipped: bool = False
    # Claude's guess, left as it was (spec 030): used, not kept as told.
    guessed: bool = False


class AnswersIn(BaseModel):
    # One checklist is at most 12; a whole run at most 30 (spec 030).
    answers: list[AnswerIn] = Field(default_factory=list, max_length=30)
    done: bool = False


class ResumeDecisionIn(BaseModel):
    decision: Literal["use", "change"]
    note: str | None = Field(default=None, max_length=2000)


class FixIn(BaseModel):
    """One answer bubble the user changed or asked about (spec 026)."""

    page: int | None = Field(default=None, ge=1, le=99)
    q: str = Field(max_length=300)
    a: str = Field(default="", max_length=2000)
    to: str | None = Field(default=None, max_length=2000)
    ask: str | None = Field(default=None, max_length=500)


class FixAddIn(BaseModel):
    """A box the owner tapped in Your application, on any step: change it, or
    ask Claude about it. It waits on the run for a checkpoint (spec 033)."""

    step: str = Field(min_length=1, max_length=200)
    q: str = Field(min_length=1, max_length=300)
    # Which one, when a step asks the same question twice (each job's title).
    k: int = Field(default=1, ge=1, le=120)
    to: str | None = Field(default=None, max_length=2000)
    ask: str | None = Field(default=None, max_length=500)


class FixEditIn(BaseModel):
    to: str | None = Field(default=None, max_length=2000)
    ask: str | None = Field(default=None, max_length=500)


class ModeIn(BaseModel):
    mode: Literal["page", "keep"]


class DecisionIn(BaseModel):
    decision: Literal["submit", "fix", "self"]
    note: str | None = Field(default=None, max_length=2000)
    fixes: list[FixIn] | None = Field(default=None, max_length=30)


class LiveIn(BaseModel):
    """Job Catcher's reading of the page being filled (spec 026)."""

    url: str = Field(max_length=2000)
    title: str | None = Field(default=None, max_length=300)
    boxes: list[dict] = Field(default_factory=list, max_length=300)
    # The site's own name for the step on screen (Workday's progress bar).
    step: str | None = Field(default=None, max_length=300)


class RequestResult(BaseModel):
    ok: bool
    reason: str | None = Field(default=None, max_length=60)
    filled: list[str] = Field(default_factory=list, max_length=200)
    need: list[str] = Field(default_factory=list, max_length=200)
    answers: list[dict] = Field(default_factory=list, max_length=200)
    # fill: what happened to the résumé on this page (spec 026).
    resume: Literal["attached", "no_box", "no_file", "failed"] | None = None


class ExtensionEvent(BaseModel):
    kind: Literal["blocked_submit", "submit_pressed", "confirmation_seen"]
    url: str | None = Field(default=None, max_length=2000)
    # The confirmation's own words ("Thank you for applying"), spec 023.
    words: str | None = Field(default=None, max_length=300)


class HelpDoneIn(BaseModel):
    reply: str | None = Field(default=None, max_length=1000)


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class FactOut(BaseModel):
    id: uuid.UUID
    question: str
    answer: str
    saved_job_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class FactIn(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)
