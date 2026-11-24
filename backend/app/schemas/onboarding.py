"""Onboarding (spec 019 part B, contracts/api.md)."""

from pydantic import BaseModel


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
    welcome_step: int | None = None
    welcome_done: bool | None = None
    profile_reviewed: bool | None = None
    checklist_hidden: bool | None = None
