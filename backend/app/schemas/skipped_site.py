"""Pydantic schemas for Sites to skip (spec 024)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SkippedSiteCreate(BaseModel):
    # A whole link or just a site's name; the service keeps only the site.
    site: str = Field(..., min_length=1, max_length=2000)
    # True once the user said yes to skipping a site Claude Scout searches.
    confirm: bool = False


class SkippedSiteOut(BaseModel):
    id: uuid.UUID
    host: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SkippedSiteAdded(BaseModel):
    id: uuid.UUID
    host: str
    # True when the site (or a site it's part of) was on the list already.
    already: bool = False


class SiteSuggestion(BaseModel):
    host: str
    finds: int
