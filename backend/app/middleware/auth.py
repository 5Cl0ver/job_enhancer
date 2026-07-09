"""NextAuth.js v5 JWT validation dependency.

NextAuth v5 issues JWE (encrypted) tokens, not plain signed JWTs.
fastapi-nextauth-jwt handles HKDF key derivation + JWE decryption
using the shared AUTH_SECRET environment variable.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi_nextauth_jwt import NextAuthJWT
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.models.user import User

# Validate and decrypt the NextAuth session cookie / Bearer token
_jwt_validator = NextAuthJWT(secret=settings.auth_secret)


async def get_current_user(
    jwt: Annotated[dict, Depends(_jwt_validator)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Resolve the authenticated User from the decrypted JWT payload.

    Creates the user on first login if they don't exist yet (OAuth flow).
    Raises 401 if the token is invalid or the user account is deleted.
    """
    email: str | None = jwt.get("email") or jwt.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )

    result = await db.execute(
        select(User).where(User.email == email, User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()

    if user is None:
        # First OAuth login — create the user account
        from app.services.users import create_user  # local import to avoid circular

        user = await create_user(
            db=db,
            email=email,
            name=jwt.get("name"),
            image=jwt.get("picture"),
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
