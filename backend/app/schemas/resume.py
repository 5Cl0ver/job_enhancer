"""Pydantic schemas for Resumes and GeneratedDocuments."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ResumeSchema(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    filename: str
    mime_type: str
    file_size_bytes: int
    is_active: bool
    # The big "everything" résumé Claude tailors from (spec 022).
    is_master: bool = False
    # Set on a résumé made for one job: the document it's rendered from.
    document_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ResumeSkills(BaseModel):
    """Skills the app recognised in a resume's text."""

    skills: list[str]


class GeneratedDocumentCreate(BaseModel):
    job_listing_id: uuid.UUID | None = None
    resume_id: uuid.UUID
    document_type: Literal["resume", "cover_letter"]


class PromptResponse(BaseModel):
    """A ready-to-paste prompt for the "use my own Claude" bridge."""

    prompt: str
    job_title: str = ""
    company: str = ""


class ManualDocumentCreate(BaseModel):
    """Save content the user generated in their OWN AI (the bridge), so it flows
    into the same document + PDF pipeline as AI-generated docs."""

    job_listing_id: uuid.UUID | None = None
    resume_id: uuid.UUID | None = None
    document_type: Literal["resume", "cover_letter"]
    content: str = Field(..., min_length=1)
    model_used: str = "claude (my subscription)"


class AutofillField(BaseModel):
    """One form field the deterministic pass couldn't map — sent to the AI."""

    id: str = Field(min_length=1, max_length=40)
    label: str = Field(max_length=600)
    type: str = Field(default="text", max_length=20)  # text | select | radio
    options: list[str] = Field(default_factory=list, max_length=60)


class AutofillMapRequest(BaseModel):
    fields: list[AutofillField] = Field(default_factory=list, max_length=60)


class AutofillMapResponse(BaseModel):
    mappings: dict[str, str] = Field(default_factory=dict)
    # How sure the model was, 0..1 per mapped id (spec 015): the extension fills
    # at 0.75+ and only suggests below. Old extensions ignore it.
    confidence: dict[str, float] = Field(default_factory=dict)


class WorkExperienceEntry(BaseModel):
    """One job parsed from the résumé, for filling 'Work Experience' sections."""

    title: str = ""
    company: str = ""
    location: str = ""
    start_month: int | None = None
    start_year: int | None = None
    end_month: int | None = None
    end_year: int | None = None
    current: bool = False
    description: str = ""


class WorkHistoryResponse(BaseModel):
    entries: list[WorkExperienceEntry] = Field(default_factory=list)


class GeneratedDocumentUpdate(BaseModel):
    edited_content: str = Field(..., min_length=1, max_length=30_000)


class CoverLetterItem(BaseModel):
    """One of the user's cover letters, with the job it was written for."""

    id: uuid.UUID
    job_listing_id: uuid.UUID | None
    job_title: str = ""
    company: str = ""
    created_at: datetime


class CoverLetterFileOut(BaseModel):
    """A cover letter for Job Catcher: its text (for a text box) and its PDF
    (for an upload box), in one call."""

    id: uuid.UUID
    filename: str
    text: str
    pdf_base64: str


class GeneratedDocumentSchema(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    job_listing_id: uuid.UUID | None
    resume_id: uuid.UUID | None
    document_type: str
    content: str
    edited_content: str | None
    model_used: str | None
    generation_ms: int | None
    created_at: datetime

    model_config = {"from_attributes": True}
