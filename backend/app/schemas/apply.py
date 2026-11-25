"""Request bodies for Apply with Claude (spec 022). Responses are the plain
dicts from services/apply_runs.view (documented in the spec's plan)."""

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class ApplyStart(BaseModel):
    saved_job_id: uuid.UUID


class AnswerIn(BaseModel):
    id: str = Field(max_length=40)
    answer: str | None = Field(default=None, max_length=2000)
    skipped: bool = False


class AnswersIn(BaseModel):
    answers: list[AnswerIn] = Field(default_factory=list, max_length=12)
    done: bool = False


class DecisionIn(BaseModel):
    decision: Literal["submit", "fix", "self"]
    note: str | None = Field(default=None, max_length=2000)


class RequestResult(BaseModel):
    ok: bool
    reason: str | None = Field(default=None, max_length=60)
    filled: list[str] = Field(default_factory=list, max_length=200)
    need: list[str] = Field(default_factory=list, max_length=200)
    answers: list[dict] = Field(default_factory=list, max_length=200)


class ExtensionEvent(BaseModel):
    kind: Literal["blocked_submit", "submit_pressed"]
    url: str | None = Field(default=None, max_length=2000)


class FactOut(BaseModel):
    id: uuid.UUID
    question: str
    answer: str
    saved_job_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class FactIn(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)
