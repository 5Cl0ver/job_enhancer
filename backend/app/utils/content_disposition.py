"""File download headers that work for any file name (RFC 6266).

HTTP headers are latin-1 only, so a name like "Résumé – Wren.pdf" can't go in
raw (it raised UnicodeEncodeError → 500). The name goes twice: a plain-ASCII
stand-in every browser accepts, and the real name percent-encoded.
"""

import re
from urllib.parse import quote


def content_disposition(kind: str, filename: str) -> str:
    """``kind`` is "inline" (show in the tab) or "attachment" (download)."""
    plain = re.sub(r'[^\x20-\x7e]|["\\]', "", filename).strip() or "resume"
    return f"{kind}; filename=\"{plain}\"; filename*=UTF-8''{quote(filename, safe='')}"


def file_headers(filename: str) -> dict[str, str]:
    """Headers for a résumé file Job Catcher downloads to upload: the real
    name percent-encoded in X-Resume-Filename (the extension decodes it)."""
    return {
        "Content-Disposition": content_disposition("attachment", filename),
        "X-Resume-Filename": quote(filename, safe=""),
        "X-Content-Type-Options": "nosniff",
    }
