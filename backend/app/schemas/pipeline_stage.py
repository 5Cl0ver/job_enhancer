"""Pydantic schemas for PipelineStages."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class PipelineStageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    sort_order: int = Field(0, ge=0)


class PipelineStageUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    color: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    sort_order: int | None = Field(None, ge=0)


class PipelineStageSchema(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    sort_order: int
    color: str | None
    is_default: bool
    created_at: datetime

    model_config = {"from_attributes": True}
