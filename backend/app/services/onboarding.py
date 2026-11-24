"""Onboarding progress (spec 019 part B, research R6).

The Getting started ticks are worked out from real state every time (a résumé
exists, a Job Catcher said hello, a job is saved, …), so they can never drift
from what the person actually has. Only what can't be derived is stored in
``user_onboarding``.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.email_account import EmailAccount
from app.models.extension import ExtensionInstall
from app.models.onboarding import UserOnboarding
from app.models.resume import Resume
from app.models.saved_job import SavedJob
from app.models.user import User
from app.schemas.onboarding import (
    ChecklistItem,
    OnboardingOut,
    OnboardingPatch,
    WelcomeState,
)

logger = logging.getLogger(__name__)

LAST_STEP = 4
# (key, required) in the order the card lists them.
ITEMS = (
    ("resume", True),
    ("profile", True),
    ("job_catcher", True),
    ("first_job", True),
    ("email", False),
    ("claude", False),
)
_CLAUDE_THROTTLE = timedelta(hours=1)


async def get_or_create(db: AsyncSession, user: User) -> UserOnboarding:
    """The user's row, made on first use. Accounts older than this feature
    were backfilled as done by the migration; a new account starts at the
    Welcome. Two first loads at once both end up with the one row."""
    row = await db.get(UserOnboarding, user.id)
    if row is not None:
        return row
    try:
        async with db.begin_nested():
            row = UserOnboarding(user_id=user.id, welcome_step=0)
            db.add(row)
    except IntegrityError:
        row = await db.get(UserOnboarding, user.id, populate_existing=True)
    await db.commit()
    return row


async def _has(db: AsyncSession, model, user_id: uuid.UUID) -> bool:
    return bool(await db.scalar(select(exists().where(model.user_id == user_id))))


async def state(db: AsyncSession, user: User) -> OnboardingOut:
    row = await get_or_create(db, user)
    done = {
        "resume": await _has(db, Resume, user.id),
        "profile": row.profile_reviewed_at is not None,
        "job_catcher": await _has(db, ExtensionInstall, user.id),
        "first_job": await _has(db, SavedJob, user.id),
        "email": await _has(db, EmailAccount, user.id),
        "claude": row.claude_seen_at is not None or bool(user.claude_project_url),
    }
    items = [ChecklistItem(key=k, done=done[k], required=r) for k, r in ITEMS]
    required = [i for i in items if i.required]
    return OnboardingOut(
        welcome=WelcomeState(
            step=row.welcome_step, done=row.welcome_done_at is not None
        ),
        checklist_hidden=row.checklist_hidden,
        items=items,
        required_done=sum(i.done for i in required),
        required_total=len(required),
    )


async def patch(
    db: AsyncSession, user: User, changes: OnboardingPatch
) -> OnboardingOut:
    row = await get_or_create(db, user)
    now = datetime.now(UTC)
    if changes.welcome_step is not None:
        row.welcome_step = max(0, min(LAST_STEP, changes.welcome_step))
    if changes.welcome_done is True:
        row.welcome_done_at = row.welcome_done_at or now
    elif changes.welcome_done is False:  # Settings → Show the welcome again
        row.welcome_done_at = None
        row.welcome_step = 0
    if changes.profile_reviewed is True:
        row.profile_reviewed_at = row.profile_reviewed_at or now
    if changes.checklist_hidden is not None:
        row.checklist_hidden = changes.checklist_hidden
    await db.commit()
    return await state(db, user)


# Per process: when each account's Claude tick was last written, so a busy
# Claude Scout run (hundreds of tool calls) costs one write an hour, not one
# query per call.
_claude_ticked: dict[uuid.UUID, datetime] = {}


async def touch_claude(
    session_factory: async_sessionmaker[AsyncSession], user_id: uuid.UUID
) -> None:
    """Note that this account's Claude used the connector: the Getting started
    "Claude" tick. At most one write an hour per account, in a session of its
    own; never raises."""
    now = datetime.now(UTC)
    last = _claude_ticked.get(user_id)
    if last is not None and now - last < _CLAUDE_THROTTLE:
        return
    if len(_claude_ticked) > 10_000:  # bounded: it's only a shortcut
        _claude_ticked.clear()
    _claude_ticked[user_id] = now
    try:
        async with session_factory() as db:
            result = await db.execute(
                update(UserOnboarding)
                .where(UserOnboarding.user_id == user_id)
                .values(claude_seen_at=now)
                .execution_options(synchronize_session=False)
            )
            if not result.rowcount:
                # Claude came before the app's first load: start the row here.
                db.add(
                    UserOnboarding(user_id=user_id, welcome_step=0, claude_seen_at=now)
                )
            await db.commit()
    except Exception as exc:  # a tick must never break a Claude tool call
        logger.warning(
            "Could not record the Claude connector use (%s)", type(exc).__name__
        )
