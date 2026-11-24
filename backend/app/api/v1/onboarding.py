"""Onboarding: the Welcome's progress and the Getting started checklist
(spec 019 part B, contracts/api.md). App session only: Job Catcher's pass is
refused (see tests/api/test_pass_routes.py)."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.onboarding import OnboardingOut, OnboardingPatch
from app.services import onboarding as svc

router = APIRouter()


@router.get("/onboarding", response_model=OnboardingOut)
async def get_onboarding(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OnboardingOut:
    return await svc.state(db, user)


@router.patch("/onboarding", response_model=OnboardingOut)
async def patch_onboarding(
    changes: OnboardingPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OnboardingOut:
    return await svc.patch(db, user, changes)
