"""Connect Job Catcher with one press (spec 019, research R4).

1. The panel starts a request: it gets a short ``code`` to show and a secret
   ``poll_token`` only it knows (we keep the token's hash).
2. The user opens the app's /connect page, signed in, and approves the code.
3. The panel polls with its token. Once approved, it receives its own pass —
   a ``jcx_…`` token — exactly once; the request is then used.

The code alone can sign nothing in; only the panel holding the poll token gets
the pass. Approval also needs the panel's ``proof``: the /connect page asks
the Job Catcher in the same Chrome for it, so a link sent to someone else can't
be approved for an attacker's Job Catcher (device-code phishing). Requests last
5 minutes and work once. Passes are stored as sha256 hashes, are revocable per
computer, stop after 90 days unused and after a year regardless, and an account
keeps at most 10 (the oldest goes). Nothing secret here is ever logged.
"""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.extension import (
    ExtensionConnectRequest,
    ExtensionInstall,
    ExtensionToken,
)
from app.models.user import User

TOKEN_PREFIX = "jcx_"
REQUEST_TTL = timedelta(minutes=5)
TOKEN_IDLE_LIMIT = timedelta(days=90)
TOKEN_MAX_AGE = timedelta(days=365)
MAX_TOKENS = 10
TOUCH_EVERY = timedelta(minutes=15)
# Connects waiting at once, across everyone: above this, start says "busy".
MAX_PENDING = 500
# …and from one address (one person rarely needs more than one).
MAX_PENDING_PER_CLIENT = 3
# No 0/O, 1/I/L: a code people can read aloud and compare at a glance.
_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def same_hash(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


class Busy(Exception):
    """Too many Connects waiting right now."""


class TooManyHere(Exception):
    """Too many Connects waiting from this address."""


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    # SQLite hands back naive datetimes; Postgres aware ones.
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _new_code() -> str:
    raw = "".join(secrets.choice(_CODE_CHARS) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_code(code: str) -> str:
    raw = "".join(c for c in code.upper() if c.isalnum())
    return f"{raw[:4]}-{raw[4:8]}" if len(raw) == 8 else ""


def _state(req: ExtensionConnectRequest) -> str:
    """The request's status, with expiry applied (stored rows aren't rewritten)."""
    if req.status == "pending" and _aware(req.expires_at) <= _now():
        return "expired"
    if req.status == "approved" and _aware(req.expires_at) <= _now():
        return "expired"
    return req.status


async def start(
    db: AsyncSession, proof_hash: str, client: str = ""
) -> tuple[ExtensionConnectRequest, str]:
    """A new request; returns it and the raw poll token (never stored).
    ``proof_hash``: sha256 of a secret only the starting Job Catcher holds.
    ``client``: the starter's rate-limit address (stored only as a hash).
    Raises ``Busy`` when too many are waiting overall, ``TooManyHere`` when
    too many are waiting from this address."""
    pending = await db.scalar(
        select(func.count())
        .select_from(ExtensionConnectRequest)
        .where(
            ExtensionConnectRequest.status == "pending",
            ExtensionConnectRequest.expires_at > _now(),
        )
    )
    if (pending or 0) >= MAX_PENDING:
        raise Busy()
    client_hash = hash_secret(client) if client else ""
    if client_hash:
        here = await db.scalar(
            select(func.count())
            .select_from(ExtensionConnectRequest)
            .where(
                ExtensionConnectRequest.client_hash == client_hash,
                ExtensionConnectRequest.status == "pending",
                ExtensionConnectRequest.expires_at > _now(),
            )
        )
        if (here or 0) >= MAX_PENDING_PER_CLIENT:
            raise TooManyHere()
    poll_token = secrets.token_urlsafe(32)
    for _ in range(5):
        code = _new_code()
        taken = await db.scalar(
            select(ExtensionConnectRequest.id).where(
                ExtensionConnectRequest.code == code
            )
        )
        if taken is None:
            break
    req = ExtensionConnectRequest(
        code=code,
        poll_token_hash=hash_secret(poll_token),
        proof_hash=proof_hash.lower(),
        client_hash=client_hash,
        status="pending",
        expires_at=_now() + REQUEST_TTL,
    )
    db.add(req)
    await db.flush()
    return req, poll_token


async def by_code(db: AsyncSession, code: str) -> ExtensionConnectRequest | None:
    norm = normalize_code(code)
    if not norm:
        return None
    return await db.scalar(
        select(ExtensionConnectRequest).where(ExtensionConnectRequest.code == norm)
    )


async def by_poll_token(
    db: AsyncSession, poll_token: str
) -> ExtensionConnectRequest | None:
    return await db.scalar(
        select(ExtensionConnectRequest).where(
            ExtensionConnectRequest.poll_token_hash == hash_secret(poll_token)
        )
    )


def seconds_left(req: ExtensionConnectRequest) -> int:
    return max(0, int((_aware(req.expires_at) - _now()).total_seconds()))


def state(req: ExtensionConnectRequest) -> str:
    return _state(req)


async def approve(
    db: AsyncSession, req: ExtensionConnectRequest, user: User, proof: str
) -> str:
    """Approve a pending request for ``user`` when ``proof`` is the starting
    Job Catcher's. Returns the resulting state ("bad_proof" when it isn't)."""
    current = _state(req)
    if current != "pending":
        return current
    if not proof or not same_hash(hash_secret(proof), req.proof_hash):
        return "bad_proof"
    req.status = "approved"
    req.user_id = user.id
    await db.flush()
    return "approved"


async def cancel(db: AsyncSession, req: ExtensionConnectRequest) -> str:
    current = _state(req)
    if current in ("pending", "approved"):
        req.status = "cancelled"
        await db.flush()
        return "cancelled"
    return current


async def poll(
    db: AsyncSession, poll_token: str
) -> tuple[str, str | None, User | None]:
    """The request's state for the panel holding ``poll_token``. On the first
    poll after approval, mints the pass and returns it with the user — once."""
    req = await by_poll_token(db, poll_token)
    if req is None:
        return "unknown", None, None
    current = _state(req)
    if current != "approved" or req.user_id is None:
        return current, None, None
    user = await db.get(User, req.user_id)
    if user is None or user.deleted_at is not None:
        req.status = "cancelled"
        await db.flush()
        return "cancelled", None, None
    # Hand it over exactly once: only the poll that flips approved → used wins.
    flipped = await db.execute(
        update(ExtensionConnectRequest)
        .where(
            ExtensionConnectRequest.id == req.id,
            ExtensionConnectRequest.status == "approved",
        )
        .values(status="used")
    )
    if flipped.rowcount != 1:
        return "used", None, None
    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    db.add(
        ExtensionToken(
            user_id=user.id, token_hash=hash_secret(token), created_at=_now()
        )
    )
    await db.flush()
    # At most MAX_TOKENS computers per account: the oldest are disconnected.
    live = await list_tokens(db, user.id)
    for old in live[MAX_TOKENS:]:
        old.revoked_at = _now()
    await db.flush()
    return "approved", token, user


async def user_for_token(db: AsyncSession, token: str) -> User | None:
    """The account a ``jcx_`` pass belongs to, or None (unknown, revoked,
    unused for 90 days, or the account is gone)."""
    row = await db.scalar(
        select(ExtensionToken).where(ExtensionToken.token_hash == hash_secret(token))
    )
    if row is None or row.revoked_at is not None:
        return None
    now = _now()
    last = _aware(row.last_used_at or row.created_at)
    if now - last > TOKEN_IDLE_LIMIT or now - _aware(row.created_at) > TOKEN_MAX_AGE:
        return None
    user = await db.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        return None
    if row.last_used_at is None or now - _aware(row.last_used_at) > TOUCH_EVERY:
        row.last_used_at = now
        await db.commit()
    return user


async def list_tokens(db: AsyncSession, user_id: uuid.UUID) -> list[ExtensionToken]:
    return list(
        (
            await db.execute(
                select(ExtensionToken)
                .where(
                    ExtensionToken.user_id == user_id,
                    ExtensionToken.revoked_at.is_(None),
                )
                .order_by(ExtensionToken.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def revoke_raw(db: AsyncSession, user_id: uuid.UUID, token: str) -> bool:
    """Sign-out from a Job Catcher: revoke the pass it holds."""
    row = await db.scalar(
        select(ExtensionToken).where(
            ExtensionToken.token_hash == hash_secret(token),
            ExtensionToken.user_id == user_id,
        )
    )
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = _now()
    await db.flush()
    return True


async def revoke_all(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Disconnect every Job Catcher of this account (after a password reset)."""
    result = await db.execute(
        update(ExtensionToken)
        .where(ExtensionToken.user_id == user_id, ExtensionToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await db.flush()
    return result.rowcount or 0


async def purge_connect_requests(
    session_factory: async_sessionmaker[AsyncSession],
) -> int:
    """Delete Connect requests older than a day (they last 5 minutes). Runs on
    the scheduler, never on a request."""
    async with session_factory() as db:
        result = await db.execute(
            delete(ExtensionConnectRequest).where(
                ExtensionConnectRequest.created_at < _now() - timedelta(days=1)
            )
        )
        await db.commit()
        return result.rowcount or 0


async def revoke(db: AsyncSession, user_id: uuid.UUID, token_id: uuid.UUID) -> bool:
    row = await db.scalar(
        select(ExtensionToken).where(
            ExtensionToken.id == token_id, ExtensionToken.user_id == user_id
        )
    )
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = _now()
    await db.flush()
    return True


async def hello(
    db: AsyncSession,
    user_id: uuid.UUID,
    install_id: str,
    version: str,
    browser: str | None,
    token: str | None = None,
) -> ExtensionInstall:
    """Record a Job Catcher saying hello; ties the pass (if any) to it."""
    row = await db.scalar(
        select(ExtensionInstall).where(
            ExtensionInstall.user_id == user_id,
            ExtensionInstall.install_id == install_id,
        )
    )
    now = _now()
    if row is None:
        row = ExtensionInstall(
            user_id=user_id,
            install_id=install_id,
            version=version,
            browser=browser,
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(row)
    else:
        row.version = version
        row.browser = browser or row.browser
        row.last_seen_at = now
    if token and token.startswith(TOKEN_PREFIX):
        await db.execute(
            update(ExtensionToken)
            .where(
                ExtensionToken.token_hash == hash_secret(token),
                ExtensionToken.user_id == user_id,
            )
            .values(install_id=install_id, browser=browser)
        )
    await db.flush()
    return row


async def installs(db: AsyncSession, user_id: uuid.UUID) -> list[ExtensionInstall]:
    return list(
        (
            await db.execute(
                select(ExtensionInstall)
                .where(ExtensionInstall.user_id == user_id)
                .order_by(ExtensionInstall.last_seen_at.desc())
            )
        )
        .scalars()
        .all()
    )
