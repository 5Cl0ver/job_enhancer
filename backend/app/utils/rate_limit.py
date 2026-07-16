"""Per-user rate-limit keying for slowapi.

Rate limits key on the authenticated user (JWT `sub` claim) so users
behind a shared IP don't throttle each other; unauthenticated requests
fall back to the client IP. Claims are read WITHOUT verification here —
that's fine for bucketing; real verification happens in the auth
dependency.
"""

from fastapi import Request
from jose import jwt
from slowapi.util import get_remote_address


def rate_limit_key(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            sub = jwt.get_unverified_claims(auth[7:]).get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:
            pass
    return get_remote_address(request)
