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
    created_at: datetime

    model_config = {"from_attributes": True}


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


class GeneratedDocumentUpdate(BaseModel):
    edited_content: str = Field(..., min_length=1)


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
