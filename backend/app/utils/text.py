"""Plain words from text that arrived HTML-escaped (spec 023).

Job pages and job APIs hand titles over as "Microsoft 365 &amp; Copilot".
Everything that stores or compares a job's title, company or place goes
through ``unescape`` first, so "&amp;" and "&" are always the same job.
"""

import html
import re

_ENTITY = re.compile(r"&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);")


def unescape(value):
    """'&amp;amp;' → '&': unescaped until no entity is left (at most 3 times).
    Non-strings pass through untouched."""
    if not isinstance(value, str):
        return value
    for _ in range(3):
        if not _ENTITY.search(value):
            break
        value = html.unescape(value)
    return value.replace("\xa0", " ")
