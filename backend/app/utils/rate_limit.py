"""Rate-limit keying for slowapi.

Rate limits key on the authenticated user (JWT `sub` claim) so users
behind a shared IP don't throttle each other; unauthenticated requests
fall back to the client IP. Claims are read WITHOUT verification here —
that's fine for bucketing; real verification happens in the auth
dependency. Public endpoints (Job Catcher's Connect) key on the client IP
only (``client_ip``), whatever Authorization says.
"""

import hashlib
import ipaddress

from fastapi import Request
from jose import jwt


def _private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host in ("testclient", "localhost")
    return ip.is_private or ip.is_loopback


def client_ip(request: Request) -> str:
    """The person's IP address. Behind Render's proxy the direct peer is a
    private address and the proxy APPENDS the address it saw to
    X-Forwarded-For, so the rightmost entry is the real one; anything to its
    left could have been typed by the client, so it's never trusted. A public
    direct peer (no proxy) is the client itself."""
    peer = request.client.host if request.client else ""
    if peer and not _private(peer):
        return peer
    forwarded = request.headers.get("x-forwarded-for", "")
    hops = [h.strip() for h in forwarded.split(",") if h.strip()]
    if hops:
        try:
            return str(ipaddress.ip_address(hops[-1]))
        except ValueError:
            pass
    return peer or "unknown"


def rate_limit_key(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer jcx_"):
        # A Job Catcher pass: bucket by a short hash, never the pass itself.
        return "ext:" + hashlib.sha256(auth[7:].encode()).hexdigest()[:12]
    if auth.startswith("Bearer "):
        try:
            sub = jwt.get_unverified_claims(auth[7:]).get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:
            pass
    return client_ip(request)
