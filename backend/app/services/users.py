"""User service — account creation, self-service, and data management."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.user import User
from app.services.tracker import seed_default_stages


async def create_user(
    db: AsyncSession,
    email: str,
    name: str | None = None,
    image: str | None = None,
    admin_email: str = "",
) -> User:
    """Create a new user on first OAuth login.

    Seeds:
    - Default "Saved" collection
    - 8 default Kanban pipeline stages
    """
    role = "admin" if admin_email and email == admin_email else "user"

    user = User(
        id=uuid.uuid4(),
        email=email,
        name=name,
        image=image,
        role=role,
    )
    db.add(user)
    await db.flush()  # get user.id without committing

    # Seed default collection
    default_collection = Collection(
        user_id=user.id,
        name="Saved",
        is_default=True,
        sort_order=0,
    )
    db.add(default_collection)

    # Seed default pipeline stages
    await seed_default_stages(db, user.id)

    await db.commit()
    await db.refresh(user)
    return user


async def soft_delete_user(db: AsyncSession, user: User) -> None:
    """Soft-delete a user account (hard delete scheduled later)."""
    user.deleted_at = datetime.now(UTC)
    await db.commit()
