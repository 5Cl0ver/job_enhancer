"""Which build of the API is running (spec 032, research R7).

Render sets ``RENDER_GIT_COMMIT`` to the deployed commit; its first 7
characters are the API's version, shown by ``/health`` and kept on the
errors the app catches. Anywhere else (a laptop, the tests) it's ``dev``.
"""

import os


def api_version() -> str:
    return (os.environ.get("RENDER_GIT_COMMIT") or "").strip()[:7] or "dev"
