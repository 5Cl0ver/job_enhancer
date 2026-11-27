"""What Claude is told for an Apply with Claude run (spec 022).

``app/apply/playbook.md`` holds the steps and ``app/apply/rules.md`` holds the
locked rules, which always come last. Both are read once at import and ship
with the app (the Dockerfile copies ``app/``). Bump the version when either
changes, so a run's log shows which text Claude had.
"""

from pathlib import Path

APPLY_PLAYBOOK_VERSION = "2026.12.04"

_DIR = Path(__file__).resolve().parent.parent / "apply"


def _read(name: str) -> str:
    return (_DIR / f"{name}.md").read_text(encoding="utf-8").strip()


PLAYBOOK = _read("playbook")
RULES = _read("rules")


def playbook_text() -> str:
    return f"{PLAYBOOK}\n\n{RULES}"
