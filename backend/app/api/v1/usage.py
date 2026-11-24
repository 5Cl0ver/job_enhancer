"""What's left of today's free allowances (spec 019 part C, contracts/api.md).
App session only: Job Catcher's pass is refused."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.services import allowance

router = APIRouter()


@router.get("/usage")
async def get_usage(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await allowance.usage(db, user)
