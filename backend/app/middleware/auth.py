"""Supabase JWT validation dependency.

Supabase Auth signs access tokens with the project's *current* JWT signing key.
Modern projects use an asymmetric key (ECC P-256 / RSA), so we verify a token's
signature against the project's public keys, published as a JWKS at
`https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.

The frontend sends the session access token as `Authorization: Bearer <token>`.
A connected Job Catcher may instead send its own pass, `Bearer jcx_…` (spec
019): looked up by hash, revocable, never a Supabase token.
"""

from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.extension_connect import TOKEN_PREFIX, user_for_token

_bearer = HTTPBearer(auto_error=False)

# Supabase's public signing keys, cached in-process. Keys rotate rarely; on a
# key-id miss we refresh once (handles rotation) before giving up.
_jwks_cache: dict[str, Any] | None = None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _fetch_jwks(*, force: bool = False) -> dict[str, Any]:
    global _jwks_cache
    if _jwks_cache is None or force:
        url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


def _find_key(jwks: dict[str, Any], kid: str | None) -> dict[str, Any] | None:
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


async def _decode_token(token: str) -> dict:
    """Verify and decode a Supabase access token against the project's JWKS."""
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except JWTError as exc:
        raise _unauthorized("Malformed token") from exc

    jwks = await _fetch_jwks()
    key = _find_key(jwks, kid)
    if key is None:
        # Signing key may have rotated — refresh once and retry.
        jwks = await _fetch_jwks(force=True)
        key = _find_key(jwks, kid)
    if key is None:
        raise _unauthorized("Signing key not found")

    try:
        return jwt.decode(
            token,
            key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
    except JWTError as exc:
        raise _unauthorized("Invalid or expired token") from exc


async def _resolve_user(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
    *,
    allow_pass: bool,
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if credentials.credentials.startswith(TOKEN_PREFIX):
        if not allow_pass:
            # Job Catcher's pass only opens what Job Catcher does; account,
            # admin, email and connection settings need the app itself.
            raise _unauthorized("Sign in to the Job Enhancer app to do this.")
        user = await user_for_token(db, credentials.credentials)
        if user is None:
            raise _unauthorized("Job Catcher is disconnected. Connect it again.")
        return user

    claims = await _decode_token(credentials.credentials)
    email: str | None = claims.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing email claim",
        )

    result = await db.execute(
        select(User).where(User.email == email, User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if user is None:
        # First login — create the user account
        from app.services.users import create_user  # local import to avoid circular

        meta: dict = claims.get("user_metadata") or {}
        user = await create_user(
            db=db,
            email=email,
            name=meta.get("full_name") or meta.get("name"),
            image=meta.get("avatar_url") or meta.get("picture"),
            admin_email=settings.admin_email,
        )

    return user


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Resolve the authenticated User from the app's Supabase session.

    Creates the user on first login if they don't exist yet. Refuses a Job
    Catcher pass: every route is app-session only unless it opts in with
    ``get_user_or_pass``. Raises 401 if the token is missing/invalid or the
    account is deleted.
    """
    return await _resolve_user(credentials, db, allow_pass=False)


async def get_user_or_pass(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Like ``get_current_user``, but a connected Job Catcher's pass is also
    accepted. ONLY for the routes Job Catcher calls (see
    tests/api/test_pass_routes.py, which holds the allowlist)."""
    return await _resolve_user(credentials, db, allow_pass=True)


async def require_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Dependency that additionally requires admin role."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return user


# Type aliases for cleaner route signatures
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
