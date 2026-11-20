"""What is waiting on the user, as counts for the navigation badges."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.attention import AttentionOut
from app.services import email_review, scout_review

router = APIRouter()


@router.get("", response_model=AttentionOut)
async def attention(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AttentionOut:
    return AttentionOut(
        email_review=await email_review.count_to_review(db, user.id),
        scout_review=await scout_review.count_to_review(db, user.id),
    )
