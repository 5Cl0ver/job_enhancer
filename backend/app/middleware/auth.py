"""Supabase JWT validation dependency.

Supabase Auth issues HS256-signed JWTs. The frontend sends the session
access token as `Authorization: Bearer <token>`; we verify it with the
project's JWT secret (Supabase dashboard -> Settings -> API -> JWT Secret).
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)


def _decode_token(token: str) -> dict:
    """Verify and decode a Supabase access token."""
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Resolve the authenticated User from the Supabase JWT.

    Creates the user on first login if they don't exist yet.
    Raises 401 if the token is missing/invalid or the account is deleted.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = _decode_token(credentials.credentials)
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
