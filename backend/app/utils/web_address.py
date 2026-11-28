"""Public web addresses (spec 040).

A link the app keeps for a job and opens later must be an http(s) address on
a public host: never an IP address, localhost or a one-word (intranet) host.
"""

import ipaddress
from urllib.parse import urlsplit


def public_web_url(url: str | None) -> bool:
    try:
        parts = urlsplit(url or "")
        host = (parts.hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or "." not in host:
        return False
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return False
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return True
    return False
