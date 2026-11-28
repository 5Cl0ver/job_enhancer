"""Public web addresses (spec 040).

A link the app keeps for a job and opens later must be an http(s) address on
a public host: never an IP address (in any spelling: 127.1, 0x7f.0.0.1,
0177.0.0.1, 2130706433), localhost or a one-word (intranet) host.
"""

import ipaddress
import re
from urllib.parse import urlsplit

# A label that is a number: decimal, octal or hex. No real top-level domain is.
_NUMERIC = re.compile(r"(0x[0-9a-f]*|\d+)", re.IGNORECASE)


def public_web_url(url: str | None) -> bool:
    try:
        parts = urlsplit(url or "")
        host = (parts.hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    labels = host.split(".")
    if len(labels) < 2 or _NUMERIC.fullmatch(labels[-1]):
        return False  # one word, or an IP address in shorthand
    return not (
        host == "localhost" or host.endswith((".localhost", ".local", ".internal"))
    )
