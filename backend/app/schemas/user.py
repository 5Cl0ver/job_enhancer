"""Pydantic schemas for User endpoints."""

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


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
