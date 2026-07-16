"""User service — account creation, self-service, and data management."""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.collection import Collection
from app.models.user import User
from app.services.tracker import seed_default_stages

logger = logging.getLogger(__name__)

#: Days between soft delete and permanent purge (FR-020, data-model.md).
PURGE_GRACE_DAYS = 30


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
    """Soft-delete a user account.

    The account is immediately unusable (auth rejects deleted users).
    All rows and stored files are permanently purged by
    `purge_deleted_users` after `PURGE_GRACE_DAYS`.
    """
    user.deleted_at = datetime.now(UTC)
    await db.commit()


async def purge_deleted_users(
    session_factory: async_sessionmaker[AsyncSession],
) -> int:
    """Permanently delete accounts soft-deleted more than PURGE_GRACE_DAYS ago.

    Hard-deletes the user rows; all owned rows (saved jobs, collections,
    stages, resumes, generated documents) cascade via `ON DELETE CASCADE`
    FKs. No files exist on disk — resume text lives in the DB and PDFs
    are rendered on demand. Runs daily via APScheduler (FR-020).
    """
    cutoff = datetime.now(UTC) - timedelta(days=PURGE_GRACE_DAYS)

    async with session_factory() as db:
        result = await db.execute(
            select(User.id).where(
                User.deleted_at.is_not(None), User.deleted_at < cutoff
            )
        )
        user_ids = [row[0] for row in result.all()]
        if not user_ids:
            return 0

        await db.execute(delete(User).where(User.id.in_(user_ids)))
        await db.commit()

    logger.info("Purged %d soft-deleted account(s)", len(user_ids))
    return len(user_ids)
