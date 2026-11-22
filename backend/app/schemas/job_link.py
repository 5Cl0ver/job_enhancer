"""Linking an email to the saved job it's really about (see services/job_links)."""

import uuid

from pydantic import BaseModel, Field


class JobOption(BaseModel):
    """A saved job the picker offers, likeliest first."""

    saved_job_id: uuid.UUID
    title: str
    company: str
    location: str | None = None
    stage: str | None = None
    likely: bool = False  # the emails point at this job


class LinkJobRequest(BaseModel):
    target_id: uuid.UUID


class LinkEventRequest(BaseModel):
    saved_job_id: uuid.UUID


class MovedEvent(BaseModel):
    id: uuid.UUID
    previous_stage_id: uuid.UUID | None = None
    status: str | None = None


class LinkUndo(BaseModel):
    """What Undo needs to put a link back exactly as it was."""

    target_id: uuid.UUID
    events: list[MovedEvent] = Field(default_factory=list, max_length=500)
    previous_stage_id: uuid.UUID | None = None
    stage_moved: bool = False
    applied_set: bool = False  # the link gave the real job its applied date


class LinkResult(BaseModel):
    saved_job_id: uuid.UUID  # the real job, which now has the emails
    job_listing_id: uuid.UUID  # its page
    stage: str | None = None
    undo: LinkUndo
