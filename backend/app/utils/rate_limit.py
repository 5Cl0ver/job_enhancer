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


def _ip(value: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address((value or "").strip())
    except ValueError:
        return None


def _private(host: str) -> bool:
    ip = _ip(host)
    if ip is None:
        return host in ("testclient", "localhost")
    return ip.is_private or ip.is_loopback


def _bucket(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str:
    """One person's key: an IPv4 address, or the /64 an IPv6 one sits in (a
    single connection usually gets a whole /64)."""
    if ip.version == 6:
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    return str(ip)


def client_ip(request: Request) -> str:
    """The person's address, for rate limits.

    Render runs behind Cloudflare: the direct peer is Render's private proxy,
    Cloudflare sets ``CF-Connecting-IP`` / ``True-Client-IP`` to the visitor,
    and Render appends Cloudflare's edge address to X-Forwarded-For (so the
    rightmost entry is the edge, the one before it is what Cloudflare saw).
    Behind a private peer: CF-Connecting-IP, else True-Client-IP, else the
    second-from-right X-Forwarded-For entry, else the peer. Never the leftmost
    entry (the client can type it). A public peer is the client itself, and
    its headers are ignored. Invalid values are skipped.
    """
    peer = request.client.host if request.client else ""
    peer_ip = _ip(peer)
    if peer and not _private(peer) and peer_ip is not None:
        return _bucket(peer_ip)
    for header in ("cf-connecting-ip", "true-client-ip"):
        ip = _ip(request.headers.get(header))
        if ip is not None:
            return _bucket(ip)
    hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",")]
    hops = [h for h in hops if h]
    if len(hops) >= 2:
        ip = _ip(hops[-2])
        if ip is not None:
            return _bucket(ip)
    return _bucket(peer_ip) if peer_ip is not None else (peer or "unknown")


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
