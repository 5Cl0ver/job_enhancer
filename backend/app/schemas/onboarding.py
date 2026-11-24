"""Onboarding (spec 019 part B, contracts/api.md)."""

from pydantic import BaseModel, ConfigDict, Field, StrictBool


class WelcomeState(BaseModel):
    step: int
    done: bool


class ChecklistItem(BaseModel):
    key: str
    done: bool
    required: bool


class OnboardingOut(BaseModel):
    welcome: WelcomeState
    checklist_hidden: bool
    items: list[ChecklistItem]
    required_done: int
    required_total: int


class OnboardingPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    welcome_step: int | None = Field(None, ge=0, le=4)
    welcome_done: StrictBool | None = None
    profile_reviewed: StrictBool | None = None
    checklist_hidden: StrictBool | None = None
