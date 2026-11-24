"""Job Catcher: latest release, hello, one-press Connect, connected computers
(spec 019, contracts/api.md).

Codes, poll tokens, proofs and passes travel only in request bodies (never in
URLs, so never in access logs) and are never logged. Every way a code can be
wrong (unknown, expired, used, cancelled, wrong proof) answers the same 404.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from slowapi import Limiter
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user, get_session_user
from app.models.user import User
from app.services import extension_connect as svc
from app.services import releases
from app.utils.rate_limit import rate_limit_key

router = APIRouter()
_limiter = Limiter(key_func=rate_limit_key)
_bearer = HTTPBearer(auto_error=False)

_GONE = "That Connect link has expired. Press Connect in Job Catcher again."


def _gone() -> HTTPException:
    return HTTPException(status_code=404, detail=_GONE)


class LatestOut(BaseModel):
    version: str | None
    notes: str
    published_at: str | None
    sha256: str | None
    download_url: str


@router.get("/latest", response_model=LatestOut)
async def latest() -> dict:
    """The newest Job Catcher release (public, cached)."""
    return await releases.latest()


class HelloIn(BaseModel):
    install_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    version: str = Field(min_length=1, max_length=32, pattern=r"^\d+(\.\d+){1,3}$")
    browser: str | None = Field(None, max_length=64)


class HelloOut(BaseModel):
    latest: str | None
    update_available: bool


@router.post("/hello", response_model=HelloOut)
async def hello(
    data: HelloIn,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> HelloOut:
    """A Job Catcher says which version it is (on sign-in, then hourly)."""
    token = credentials.credentials if credentials else None
    await svc.hello(db, user.id, data.install_id, data.version, data.browser, token)
    await db.commit()
    info = await releases.latest()
    return HelloOut(
        latest=info["version"],
        update_available=releases.is_older(data.version, info["version"]),
    )


# ---- Connect -------------------------------------------------------------


class StartIn(BaseModel):
    # sha256 (hex) of a secret only the starting Job Catcher keeps.
    proof_hash: str = Field(pattern=r"^[0-9a-fA-F]{64}$")


class StartOut(BaseModel):
    code: str
    poll_token: str
    expires_in: int


@router.post("/connect/start", response_model=StartOut)
@_limiter.limit("10/hour")
async def connect_start(
    request: Request, data: StartIn, db: AsyncSession = Depends(get_db)
) -> StartOut:
    req, poll_token = await svc.start(db, data.proof_hash)
    await db.commit()
    return StartOut(
        code=req.code, poll_token=poll_token, expires_in=svc.seconds_left(req)
    )


class CodeIn(BaseModel):
    code: str = Field(min_length=8, max_length=12)


class StatusOut(BaseModel):
    status: str
    expires_in: int


@router.post("/connect/status", response_model=StatusOut)
@_limiter.limit("30/minute")
async def connect_status(
    request: Request,
    data: CodeIn,
    user: User = Depends(get_session_user),
    db: AsyncSession = Depends(get_db),
) -> StatusOut:
    """For the app's approval page: is this code still waiting?"""
    req = await svc.by_code(db, data.code)
    if req is None or svc.state(req) != "pending":
        raise _gone()
    return StatusOut(status="pending", expires_in=svc.seconds_left(req))


class ApproveIn(CodeIn):
    # The Job Catcher's proof, handed to the /connect page by the Job Catcher
    # in the same Chrome. Without it nothing is approved.
    proof: str = Field(min_length=20, max_length=128)


@router.post("/connect/approve")
@_limiter.limit("10/hour")
async def connect_approve(
    request: Request,
    data: ApproveIn,
    user: User = Depends(get_session_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    req = await svc.by_code(db, data.code)
    if req is None:
        raise _gone()
    result = await svc.approve(db, req, user, data.proof)
    if result != "approved":
        raise _gone()
    await db.commit()
    return {"status": "approved"}


class CancelIn(BaseModel):
    code: str | None = Field(None, min_length=8, max_length=12)
    poll_token: str | None = Field(None, min_length=20, max_length=128)


@router.post("/connect/cancel")
@_limiter.limit("30/minute")
async def connect_cancel(
    request: Request,
    data: CancelIn,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cancel from Job Catcher (its poll token) or from the approval page (the
    code: harmless, a cancelled request just has to be started again)."""
    req = None
    if data.poll_token:
        req = await svc.by_poll_token(db, data.poll_token)
    elif data.code:
        req = await svc.by_code(db, data.code)
    if req is None:
        raise _gone()
    await svc.cancel(db, req)
    await db.commit()
    return {"status": "cancelled"}


class PollIn(BaseModel):
    poll_token: str = Field(min_length=20, max_length=128)


@router.post("/connect/poll")
@_limiter.limit("60/minute")
async def connect_poll(
    request: Request, data: PollIn, db: AsyncSession = Depends(get_db)
) -> dict:
    """Job Catcher waiting for approval. Gets its pass once, then never again."""
    status, token, user = await svc.poll(db, data.poll_token)
    await db.commit()
    if status == "unknown":
        raise _gone()
    if token is None or user is None:
        return {"status": status}
    return {"status": "approved", "token": token, "email": user.email}


# ---- Connected computers ---------------------------------------------------


class TokenOut(BaseModel):
    id: uuid.UUID
    browser: str | None
    version: str | None
    created_at: datetime
    last_used_at: datetime | None


@router.get("/tokens", response_model=list[TokenOut])
async def list_tokens(
    user: User = Depends(get_session_user), db: AsyncSession = Depends(get_db)
) -> list[TokenOut]:
    rows = await svc.list_tokens(db, user.id)
    versions = {i.install_id: i.version for i in await svc.installs(db, user.id)}
    return [
        TokenOut(
            id=t.id,
            browser=t.browser,
            version=versions.get(t.install_id or ""),
            created_at=t.created_at,
            last_used_at=t.last_used_at,
        )
        for t in rows
    ]


@router.delete("/tokens/current", status_code=204)
async def revoke_current(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Sign out in Job Catcher: its own pass stops working everywhere."""
    if credentials is None or not credentials.credentials.startswith(svc.TOKEN_PREFIX):
        raise HTTPException(status_code=400, detail="Not a Job Catcher sign-in.")
    await svc.revoke_raw(db, user.id, credentials.credentials)
    await db.commit()
    return Response(status_code=204)


@router.delete("/tokens/{token_id}", status_code=204)
async def revoke(
    token_id: uuid.UUID,
    user: User = Depends(get_session_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Disconnect one computer, from the app."""
    if not await svc.revoke(db, user.id, token_id):
        raise HTTPException(status_code=404, detail="Not found.")
    await db.commit()
    return Response(status_code=204)
