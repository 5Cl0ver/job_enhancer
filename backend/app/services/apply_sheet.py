"""Apply with Claude: one growing sheet of every box (spec 033).

The run keeps ONE sheet of everything Claude and Job Catcher filled, grouped
by the application's steps, so the app's list keeps growing and never shows a
question twice:

    sheet = {"steps": [{key, title, n, done, checked, rows: [row]}],
             "current": step key, "check": {step, at, read, keep?}}
    row   = {q, a, src: "jc" | "claude", tag, by?, claude?, guess?,
             agreement?, only_you?, options?, free?, fixed?}

- **Steps** come from Job Catcher's step label (Workday's progress bar) when it
  has one, else from the questions themselves: a page whose questions are
  mostly already in a step IS that step (a redone page, a pop-up narrowing
  the page, one address for every step), else the step still being filled,
  else a new step ("Page n" until Claude's ``page_done`` names it).
- **Rows** are upserted by question (case and punctuation folded; a question
  asked twice on one step, like each job's "Job Title", is told apart by its
  order). Rows are never deleted: a pop-up that narrows Job Catcher's reading
  never drops the rest of the step.
- **Fixes** (the owner's changes) wait on the run until a checkpoint:
  ``waiting`` → ``sent`` → ``done`` (the box now holds what they asked for) or
  ``gone`` (Claude couldn't find the box).

Everything here is pure: callers pass rows already trimmed and free of
passwords (``apply_runs``), and store what comes back.
"""

import re
import uuid
from typing import Any

from rapidfuzz import fuzz

MAX_STEPS = 30
MAX_ROWS = 120
MAX_OPTIONS = 60
OPTION_CHARS = 120
MAX_WAITING = 30  # fixes waiting at once
MAX_FIXES_KEPT = 150  # every fix in a run, any state
OVERLAP = 0.5
FIX_STATES = ("waiting", "sent", "done", "gone")
FLAGS = ("claude", "guess", "agreement", "only_you")
# What the owner checks before Submit, most important first.
CHECK_TAGS = ("agreement", "only_you", "guess", "empty")

_PLACEHOLDER = re.compile(
    r"^(?:[-—–_.\s]+|select(?: one| an? option| one or more)?"
    r"|choose(?: one| an? option)?|please (?:select|choose)(?: one| an? option)?"
    r"|none selected|no selection)\W*$",
    re.I,
)
_REQUIRED = re.compile(r"\(\s*required\s*\)|\brequired\b|\*", re.I)


def _text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def norm(q: Any) -> str:
    """A question's key: case, punctuation and "required" marks folded."""
    s = _REQUIRED.sub(" ", str(q or "")).casefold()
    return re.sub(r"[^\w]+", " ", s).strip()[:200]


def options_of(raw: Any) -> list[str]:
    """A box's choices as the form shows them (labels only): never a
    placeholder ("Select One"), at most 60 of 120 characters."""
    out: list[str] = []
    seen: set[str] = set()
    for o in raw if isinstance(raw, list) else []:
        t = _text(o, OPTION_CHARS)
        if not t or _PLACEHOLDER.match(t) or t.casefold() in seen:
            continue
        seen.add(t.casefold())
        out.append(t)
        if len(out) >= MAX_OPTIONS:
            break
    return out


def tag_of(row: dict[str, Any]) -> str | None:
    """The row's one tag, most important first."""
    empty = not str(row.get("a") or "").strip()
    if row.get("fixed"):
        return "changed"
    if row.get("agreement"):
        return "agreement"
    if row.get("only_you") and empty:
        return "only_you"
    if row.get("guess"):
        return "guess"
    if empty:
        return "empty"
    if row.get("claude"):
        return "claude"
    if row.get("by") == "job_catcher":
        return "profile"
    return None


def _steps(sheet: dict | None) -> list[dict[str, Any]]:
    return [
        {**s, "rows": [dict(r) for r in s.get("rows") or []]}
        for s in (sheet or {}).get("steps") or []
        if isinstance(s, dict)
    ]


def _questions(rows: list[dict[str, Any]]) -> set[str]:
    return {k for r in rows if (k := norm(r.get("q")))}


def _by_overlap(steps: list[dict], qs: set[str]) -> dict | None:
    """The step that already holds most of these questions (half or more)."""
    if not qs:
        return None
    best, score = None, 0.0
    for s in steps:
        f = len(qs & _questions(s["rows"])) / len(qs)
        if f > score or (f == score and f and best is not None):
            best, score = s, f
    return best if score >= OVERLAP else None


def _by_key(steps: list[dict], key: str) -> dict | None:
    return next((s for s in steps if s["key"] == key), None)


def _new_step(steps: list[dict], key: str, title: str) -> dict:
    if len(steps) >= MAX_STEPS:
        return steps[-1]
    keys = {s["key"] for s in steps}
    base, i = key, 2
    while key in keys:
        key, i = f"{base}#{i}", i + 1
    n = len(steps) + 1
    step = {
        "key": key,
        "title": _text(title, 120) or f"Page {n}",
        "n": n,
        "done": False,
        "checked": False,
        "rows": [],
    }
    steps.append(step)
    return step


def _match(rows: list[dict], q: str, k: int, src: str, used: set[int]) -> dict | None:
    """The row this question is: the k-th with the same question, else (once,
    across Job Catcher's and Claude's wording) a near-identical question."""
    nq = norm(q)
    same = [r for r in rows if norm(r.get("q")) == nq]
    if len(same) >= k:
        return same[k - 1]
    if k != 1 or len(nq) < 8:
        return None
    for r in rows:
        other = norm(r.get("q"))
        if (
            id(r) not in used
            and r.get("src") != src
            and len(other) >= 8
            and fuzz.token_set_ratio(nq, other) >= 90
        ):
            return r
    return None


def _apply(row: dict, item: dict, src: str) -> None:
    a = str(item.get("a") or "")
    if src == "jc":
        # Job Catcher read the page: what's really in the box, in its words.
        row.update(q=item["q"], a=a, src="jc")
    elif row.get("src") == "claude" or not row.get("a"):
        row["a"] = a
    if src == "claude":
        # Claude's latest word on this box (a redone page may drop a guess).
        for flag in FLAGS:
            if item.get(flag) is True:
                row[flag] = True
            else:
                row.pop(flag, None)
    if item.get("by") == "job_catcher":
        row["by"] = "job_catcher"
    opts = options_of(item.get("options"))
    if opts:
        # Choices as last seen (a country can change the states offered).
        row["options"] = opts
        if item.get("free") is True:
            row["free"] = True
        else:
            row.pop("free", None)


def _upsert(step: dict, incoming: list[dict], src: str) -> None:
    rows = step["rows"]
    counts: dict[str, int] = {}
    used: set[int] = set()
    for item in incoming or []:
        if not isinstance(item, dict):
            continue
        nq = norm(item.get("q"))
        if not nq:
            continue
        k = counts[nq] = counts.get(nq, 0) + 1
        row = _match(rows, str(item["q"]), k, src, used)
        if row is None:
            if len(rows) >= MAX_ROWS:
                continue
            row = {"q": str(item["q"]), "a": "", "src": src}
            rows.append(row)
        used.add(id(row))
        _apply(row, item, src)
    for row in rows:
        row["tag"] = tag_of(row)


def _done(sheet: dict | None, steps: list[dict], current: str) -> dict[str, Any]:
    return {**(sheet or {}), "steps": steps, "current": current}


def merge_live(
    sheet: dict | None, rows: list[dict], label: str | None = None
) -> tuple[dict, str | None]:
    """Job Catcher's reading of the page on screen. With its step label, that
    step; else the step holding most of these questions, else the step still
    being filled, else a new one. Never deletes a row."""
    steps = _steps(sheet)
    if not rows:
        return _done(sheet, steps, (sheet or {}).get("current")), None
    key = norm(label)
    if key:
        step = _by_key(steps, key) or _new_step(steps, key, _text(label, 120))
    else:
        step = _by_overlap(steps, _questions(rows))
        if step is None and steps and not steps[-1]["done"]:
            step = steps[-1]
        if step is None:
            step = _new_step(steps, f"page-{len(steps) + 1}", "")
    _upsert(step, rows, "jc")
    return _done(sheet, steps, step["key"]), step["key"]


def merge_page(
    sheet: dict | None,
    rows: list[dict],
    title: str,
    *,
    label: str | None = None,
) -> tuple[dict, str]:
    """A page Claude finished (``page_done``): its answers and marks, into the
    step it is: Job Catcher's label for the page on screen, else the step
    holding most of its questions (a page done again after a fix), else the
    step being filled, else a new step named by Claude."""
    steps = _steps(sheet)
    title = _text(title, 120)
    key = norm(label)
    qs = _questions(rows)
    step = None
    if key:
        step = _by_key(steps, key) or _new_step(steps, key, _text(label, 120))
    if step is None:
        step = _by_overlap(steps, qs)
    if step is None and not qs and title:
        # A page with no boxes (a review page) done again: the same step.
        step = next((s for s in steps if s["title"] == title and not s["rows"]), None)
    if step is None and steps and not steps[-1]["done"]:
        step = steps[-1]
    if step is None:
        step = _new_step(steps, norm(title) or f"page-{len(steps) + 1}", title)
    if title and step["key"].startswith("page-") and not step["done"]:
        # Named by Claude the first time it's done (Job Catcher's label wins).
        step["title"] = title
    step["done"] = True
    _upsert(step, rows, "claude")
    return _done(sheet, steps, step["key"]), step["key"]


def merge_into(sheet: dict | None, key: str | None, rows: list[dict]) -> dict:
    """Job Catcher's reading of a finished page (its photos' answers), into
    that page's step."""
    steps = _steps(sheet)
    step = _by_key(steps, key or "")
    if step is None or not rows:
        return _done(sheet, steps, (sheet or {}).get("current"))
    _upsert(step, rows, "jc")
    return _done(sheet, steps, (sheet or {}).get("current"))


def from_pages(pages: list[dict] | None) -> dict:
    """A sheet for a run from before spec 033: its pages, merged."""
    sheet: dict = {"steps": []}
    for page in pages or []:
        if not isinstance(page, dict) or page.get("title") == "Confirmation":
            continue
        sheet, key = merge_page(sheet, page.get("answers") or [], page.get("title"))
        if page.get("jc_answers"):
            sheet = merge_into(sheet, key, page["jc_answers"])
    return sheet


def step_of(sheet: dict | None, key: str | None) -> dict | None:
    return _by_key(_steps(sheet), key or "")


def rows_to_check(sheet: dict | None) -> list[dict[str, Any]]:
    """Agreements, "only you", guesses and empty boxes, each question once
    (its latest step's row), most important first."""
    latest: dict[str, tuple[dict, dict]] = {}
    for s in _steps(sheet):
        for r in s["rows"]:
            if tag_of(r) in CHECK_TAGS:
                latest.pop(norm(r["q"]), None)
                latest[norm(r["q"])] = (s, r)
    out = [{"step": s["key"], "title": s["title"], **r} for s, r in latest.values()]
    return sorted(out, key=lambda x: CHECK_TAGS.index(tag_of(x) or "empty"))


def counts(sheet: dict | None) -> dict[str, int]:
    steps = _steps(sheet)
    filled = sum(1 for s in steps for r in s["rows"] if str(r.get("a")).strip())
    return {
        "steps": len(steps),
        "filled": filled,
        "to_check": len(rows_to_check(sheet)),
    }


# --------------------------------------------------------------------------- #
# Fixes: the owner's changes, waiting for a checkpoint
# --------------------------------------------------------------------------- #


def find_row(sheet: dict | None, step: str, q: str, k: int = 1) -> dict | None:
    s = step_of(sheet, step)
    if s is None:
        return None
    same = [r for r in s["rows"] if norm(r.get("q")) == norm(q)]
    return same[k - 1] if 0 < k <= len(same) else None


def _fix_list(fixes: Any) -> list[dict[str, Any]]:
    return [dict(f) for f in fixes or [] if isinstance(f, dict)]


def waiting(fixes: Any, step: str | None = None) -> list[dict[str, Any]]:
    return [
        f
        for f in _fix_list(fixes)
        if f.get("status") == "waiting" and (step is None or f.get("step") == step)
    ]


def add_fix(
    sheet: dict | None,
    fixes: Any,
    *,
    step: str,
    q: str,
    k: int = 1,
    to: str = "",
    ask: str = "",
    now: str,
) -> tuple[list[dict], dict]:
    """A change ("to") or a question ("ask") about one box in the sheet. The
    same box's waiting fix is updated, never doubled."""
    if not (to or ask):
        raise ValueError("Say what to change it to, or what to ask Claude.")
    row = find_row(sheet, step, q, k)
    if row is None:
        raise ValueError("That box isn't in your application.")
    out = _fix_list(fixes)
    key = (step, norm(row["q"]), k)
    for f in out:
        if (
            f.get("status") == "waiting"
            and (f["step"], norm(f["q"]), f.get("k", 1)) == key
        ):
            f.update(to=to or None, ask=ask or None, at=now)
            return out, f
    if len(waiting(out)) >= MAX_WAITING:
        raise ValueError(
            f"{MAX_WAITING} fixes are waiting, the most at once. Send them first."
        )
    fix = {
        "id": uuid.uuid4().hex[:10],
        "step": step,
        "q": row["q"],
        "k": k,
        "now": _text(row.get("a"), 300),
        "to": to or None,
        "ask": ask or None,
        "status": "waiting",
        "at": now,
    }
    return [*out, fix][-MAX_FIXES_KEPT:], fix


def edit_fix(
    fixes: Any, fix_id: str, *, to: str = "", ask: str = "", now: str
) -> list[dict]:
    if not (to or ask):
        raise ValueError("Say what to change it to, or what to ask Claude.")
    out = _fix_list(fixes)
    for f in out:
        if f.get("id") == fix_id:
            if f.get("status") != "waiting":
                raise ValueError("Claude already has that fix.")
            f.update(to=to or None, ask=ask or None, at=now)
            return out
    raise LookupError("Fix not found")


def remove_fix(fixes: Any, fix_id: str) -> list[dict]:
    out = _fix_list(fixes)
    keep = [f for f in out if f.get("id") != fix_id]
    if len(keep) == len(out):
        raise LookupError("Fix not found")
    gone = next(f for f in out if f.get("id") == fix_id)
    if gone.get("status") != "waiting":
        raise ValueError("Claude already has that fix.")
    return keep


def send(fixes: Any, ids: set[str], now: str) -> list[dict]:
    out = _fix_list(fixes)
    for f in out:
        if f.get("id") in ids and f.get("status") == "waiting":
            f.update(status="sent", sent_at=now)
    return out


def for_claude(sheet: dict | None, fix: dict) -> dict[str, Any]:
    """A fix as Claude gets it: the box's label and value are the web page's
    (kept apart from the owner's words, as in spec 030), `to` / `ask` are the
    owner's, `step` says where the box is, `id` is for ``mark_fixes``."""
    s = step_of(sheet, fix.get("step"))
    row = find_row(sheet, fix.get("step"), fix.get("q"), fix.get("k", 1))
    out: dict[str, Any] = {
        "id": fix["id"],
        "step": s["title"] if s else fix.get("step"),
        "box_on_page": fix.get("q"),
        "now_on_page": _text((row or {}).get("a", fix.get("now")), 300),
    }
    if fix.get("to"):
        out["to"] = fix["to"]
    if fix.get("ask"):
        out["ask"] = fix["ask"]
    return out


def _same(a: Any, to: Any) -> bool:
    na, nt = norm(a), norm(to)
    if not na or not nt:
        return False
    return na == nt or f" {nt} " in f" {na} " or f" {na} " in f" {nt} "


def settle(sheet: dict | None, fixes: Any, now: str) -> tuple[dict, list[dict]]:
    """A fix is done once its box holds what the owner asked for: the row is
    marked "You changed it"."""
    out = _fix_list(fixes)
    steps = _steps(sheet)
    changed = False
    for f in out:
        if f.get("status") not in ("waiting", "sent") or not f.get("to"):
            continue
        s = _by_key(steps, f.get("step"))
        same = [
            r for r in (s or {}).get("rows", []) if norm(r.get("q")) == norm(f.get("q"))
        ]
        k = f.get("k", 1)
        row = same[k - 1] if 0 < k <= len(same) else None
        if row is not None and _same(row.get("a"), f["to"]):
            f.update(status="done", done_at=now)
            row["fixed"] = True
            row["tag"] = tag_of(row)
            changed = True
    if not changed:
        return sheet or {"steps": []}, out
    return {**(sheet or {}), "steps": steps}, out


def mark(
    sheet: dict | None, fixes: Any, *, done: set[str], gone: set[str], now: str
) -> tuple[dict, list[dict], int]:
    """Claude says which fixes it made, and which boxes it couldn't find."""
    out = _fix_list(fixes)
    steps = _steps(sheet)
    n = 0
    for f in out:
        if f.get("status") not in ("waiting", "sent"):
            continue
        if f.get("id") in gone:
            f.update(status="gone", done_at=now)
            n += 1
        elif f.get("id") in done:
            f.update(status="done", done_at=now)
            n += 1
            if f.get("to"):
                s = _by_key(steps, f.get("step"))
                same = [
                    r
                    for r in (s or {}).get("rows", [])
                    if norm(r.get("q")) == norm(f.get("q"))
                ]
                k = f.get("k", 1)
                if 0 < k <= len(same):
                    row = same[k - 1]
                    row.update(a=f["to"], fixed=True)
                    row["tag"] = tag_of(row)
    return {**(sheet or {}), "steps": steps}, out, n


def check_step(sheet: dict | None, key: str, *, now: str, keep: bool = False) -> dict:
    """The owner looked a step over (Continue), or switched to Keep going:
    the step never pauses again, and Claude is told once."""
    steps = _steps(sheet)
    s = _by_key(steps, key)
    if s is not None:
        s["checked"] = True
    check = {"step": key, "title": s["title"] if s else key, "at": now, "read": False}
    if keep:
        check["keep"] = True
    return {**(sheet or {}), "steps": steps, "check": check}
