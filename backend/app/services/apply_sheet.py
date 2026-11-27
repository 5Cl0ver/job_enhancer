"""Apply with Claude: one growing sheet of every box (spec 033).

The run keeps ONE sheet of everything Claude and Job Catcher filled, grouped
by the application's steps, so the app's list keeps growing and never shows a
question twice:

    sheet = {"steps": [{key, title, n, done, checked, rows: [row]}],
             "current": step key, "check": {step, at, read, keep?}}
    row   = {q, a, src: "jc" | "claude", tag, by?, claude?, guess?,
             agreement?, only_you?, options?, free?, fixed?, aliases?}

- **Steps** come from Job Catcher's step label (Workday's progress bar) when it
  has one, else from the questions themselves: the same page seen again IS
  that step (a pop-up over it, a page done again: the same title with nothing
  new, or near-total overlap with matching answers), else the step still being
  filled, else a new step ("Page n" until Claude's ``page_done`` names it). A
  look-alike page (an emergency contact's name after the applicant's) is a
  new step, never merged.
- **Rows** are upserted by question (case and punctuation folded; a question
  asked twice on one step, like each job's "Job Title", is told apart by its
  order). Rows are never deleted: a pop-up that narrows Job Catcher's reading
  never drops the rest of the step.
- **Fixes** (the owner's changes) wait on the run until a checkpoint:
  ``waiting`` → ``sent`` → ``done`` (Job Catcher read the box holding exactly
  what they asked for), ``gone`` (Claude couldn't find the box) or
  ``declined`` (Claude chose not to make it, with ``why``; spec 038). The
  owner can make a gone or declined one themselves ("I did it myself").

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
# A box's answer as the page shows it: long Workday answers in full, line
# breaks kept (spec 039).
ANSWER_CHARS = 2000
MAX_WAITING = 30  # fixes waiting at once
MAX_FIXES_KEPT = 150  # every fix in a run, any state
# The same page seen again (a pop-up, a page done again): near-total overlap.
SAME_SHARE = 0.8
SAME_SHARED = 3
# Two wordings of one question (Claude's and Job Catcher's).
NEAR = 92
FIX_STATES = ("waiting", "sent", "done", "gone", "declined")
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


def answer_text(value: Any) -> str:
    """A box's answer, long text kept as written: spaces folded on each line,
    line breaks kept (at most one blank line in a row)."""
    s = re.sub(r"[ \t]+", " ", str(value or "").replace("\r\n", "\n"))
    s = re.sub(r" ?\n ?", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()[:ANSWER_CHARS]


def norm(q: Any) -> str:
    """A question's key: case, punctuation and "required" marks folded."""
    s = _REQUIRED.sub(" ", str(q or "")).casefold()
    return re.sub(r"[^\w]+", " ", s).strip()[:200]


def _fold(a: Any) -> str:
    """An answer folded the same way, but whole: a long answer changed past
    its first 200 characters is a change (spec 039)."""
    return re.sub(r"[^\w]+", " ", str(a or "").casefold()).strip()


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
    return {k for r in rows for k in _keys(r)}


def _keys(row: dict[str, Any]) -> set[str]:
    """A row's question, and the other wordings it was matched under."""
    return {k for k in (norm(row.get("q")), *map(norm, row.get("aliases") or [])) if k}


def _answers_of(rows: list[dict[str, Any]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for r in rows:
        for k in _keys(r):
            out.setdefault(k, norm(r.get("a")))
    return out


def _compare(step: dict, rows: list[dict]) -> tuple[int, int, int]:
    """(shared questions, the same answer, a different answer), counting only
    answers filled on both sides."""
    mine, theirs = _answers_of(step["rows"]), _answers_of(rows)
    shared = set(mine) & set(theirs)
    both = [q for q in shared if mine[q] and theirs[q]]
    equal = sum(1 for q in both if mine[q] == theirs[q])
    return len(shared), equal, len(both) - equal


def _agrees(step: dict, rows: list[dict]) -> bool:
    """The answers say it's the same page: none different, or one (the box
    the owner fixed) with another the same."""
    _shared, equal, differ = _compare(step, rows)
    return differ == 0 or (differ <= 1 and equal >= 1)


def _same_page(step: dict, rows: list[dict]) -> bool:
    """Near-total overlap (a page seen again, never a look-alike page): at
    least 80% and 3 of its questions already in the step, and the answers
    agreeing."""
    qs = _questions(rows)
    shared = len(qs & _questions(step["rows"]))
    if shared < SAME_SHARED or shared / len(qs) < SAME_SHARE:
        return False
    return _agrees(step, rows)


def _redone(step: dict, rows: list[dict]) -> bool:
    """A finished page done again under another title: nothing new on it, at
    least 3 of its questions, and at least one answer still the same (an
    emergency contact's page shares the labels, never the answers)."""
    qs = _questions(rows)
    if len(qs) < SAME_SHARED or not qs <= _questions(step["rows"]):
        return False
    _shared, equal, _differ = _compare(step, rows)
    return equal >= 1


def _subset(step: dict, rows: list[dict]) -> bool:
    """Every one of these questions is already in the step (a pop-up over it,
    or Job Catcher reading less of it)."""
    qs = _questions(rows)
    return bool(qs) and qs <= _questions(step["rows"])


def _by_key(steps: list[dict], key: str) -> dict | None:
    return next((s for s in steps if s["key"] == key), None)


def _named(steps: list[dict], key: str) -> dict | None:
    """The latest step under this name ("my experience", "my experience#2")."""
    return next(
        (
            s
            for s in reversed(steps)
            if s["key"] == key or s["key"].startswith(f"{key}#")
        ),
        None,
    )


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


_DIGITS = re.compile(r"\d+")
_HINT = re.compile(r"\([^)]*\)|\[[^\]]*\]")
# Words that make a second box out of the same question.
_TWIN = {
    "confirm",
    "confirmation",
    "re",
    "reenter",
    "retype",
    "verify",
    "again",
    "repeat",
}
# Words that carry no meaning of their own in a question.
_STOP = {
    "a",
    "an",
    "and",
    "any",
    "are",
    "at",
    "be",
    "been",
    "can",
    "choose",
    "did",
    "do",
    "does",
    "enter",
    "for",
    "had",
    "has",
    "have",
    "how",
    "i",
    "if",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "our",
    "please",
    "provide",
    "select",
    "that",
    "the",
    "this",
    "to",
    "us",
    "was",
    "we",
    "what",
    "which",
    "will",
    "with",
    "would",
    "you",
    "your",
}


def _words(q: str) -> list[str]:
    """A label's meaningful words, case and plurals folded; hints in
    brackets ("(USD)", "(0-10)") left out."""
    out = []
    for w in norm(_HINT.sub(" ", q)).split():
        if w in _STOP:
            continue
        out.append(
            w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
        )
    return out


# Words that only say what kind of answer it is ("Disability status").
_SOFT = {"statu", "type", "info", "information", "detail"}
# Words too common to tell a box by on their own ("Name" in "First Name").
_GENERIC = {
    "name",
    "number",
    "date",
    "address",
    "email",
    "phone",
    "city",
    "state",
    "country",
    "title",
    "company",
    "school",
    "degree",
    "start",
    "end",
    "from",
    "to",
    "yes",
    "no",
}


def _core(q: str) -> set[str]:
    return {w for w in _words(q) if w not in _SOFT}


def _apart(a: str, b: str) -> bool:
    """Boxes that differ by a number or by a confirm / re-enter word."""
    ha, hb = norm(_HINT.sub(" ", a)), norm(_HINT.sub(" ", b))
    da, db = _DIGITS.findall(ha), _DIGITS.findall(hb)
    if da and db and da != db:
        return True
    return (set(norm(a).split()) & _TWIN) != (set(norm(b).split()) & _TWIN)


def _one_word(rows: list[dict], q: str, r: dict) -> bool:
    """A one-word label ("Disability status" / "Do you have a disability?"):
    the same box only when that word isn't a common one and only this row of
    the step has it."""
    ca, cb = _core(q), _core(str(r.get("q") or ""))
    small, big = (ca, cb) if len(ca) <= len(cb) else (cb, ca)
    if len(small) != 1 or not small <= big or _apart(q, str(r.get("q") or "")):
        return False
    (word,) = small
    if word in _GENERIC:
        return False
    holders = [x for x in rows if word in _core(str(x.get("q") or ""))]
    return holders == [r]


def _near(a: str, b: str) -> float:
    """How surely two labels on one step are one question (0 when they
    can't be). The shorter one's meaningful words (two or more) all in the
    longer one: Claude shortening the page's label ("Phone type" for "Phone
    Device Type", "LinkedIn URL" for "LinkedIn Profile URL"). Never boxes that
    differ by a number ("Address line 1" / "2") or by a confirm / re-enter /
    verify word ("Email" / "Confirm email")."""
    ha, hb = norm(_HINT.sub(" ", a)), norm(_HINT.sub(" ", b))
    da, db = _DIGITS.findall(ha), _DIGITS.findall(hb)
    if da and db and da != db:
        return 0.0
    wa, wb = set(norm(a).split()), set(norm(b).split())
    if (wa & _TWIN) != (wb & _TWIN):
        return 0.0
    ma, mb = set(_words(a)), set(_words(b))
    small, big = (ma, mb) if len(ma) <= len(mb) else (mb, ma)
    if ma == mb and ma:
        return 100.0  # the same words ("What is your gender?" / "Gender")
    if len(small) >= 2 and small <= big:
        return 95.0 + 5.0 * len(small) / len(big)
    return fuzz.token_sort_ratio(ha, hb)


def _match(rows: list[dict], q: str, k: int, src: str, used: set[int]) -> dict | None:
    """The row this question is: the k-th with the same question, else (once,
    across Job Catcher's and Claude's wording) the best near-identical one,
    a row of the other's not yet claimed first."""
    nq = norm(q)
    same = [r for r in rows if nq in _keys(r)]
    if len(same) >= k:
        return same[k - 1]
    if k != 1:
        return None
    best, score = None, (False, 0.0)
    for r in rows:
        if id(r) in used or r.get("src") == src:
            continue
        s = _near(q, str(r.get("q") or ""))
        if s < NEAR:
            continue
        rank = (not r.get("aliases"), s)  # unclaimed first, then the best
        if rank > score:
            best, score = r, rank
    if best is None:
        ones = [
            r
            for r in rows
            if id(r) not in used and r.get("src") != src and _one_word(rows, q, r)
        ]
        if len(ones) == 1:
            best = ones[0]
    return best


def _apply(row: dict, item: dict, src: str) -> None:
    a = str(item.get("a") or "")
    if norm(item["q"]) not in _keys(row):
        # Another wording of the same box: kept, so the row (and the fixes
        # on it) keep their question.
        row["aliases"] = [*(row.get("aliases") or []), str(item["q"])][-4:]
    if src == "jc":
        # Job Catcher read the page: what's really in the box.
        row.update(a=a, src="jc")
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
    """Job Catcher's reading of the page on screen. Never deletes a row.

    With its step label, that step (a pop-up over a revisited step included).
    Else: the step being filled, when it already holds every one of these
    questions (a pop-up, a narrower reading); the step just finished, the
    same way, but only when the answers agree; the same page seen again
    (near-total overlap, answers agreeing); the step still being filled; else
    a new one. A look-alike page (an emergency contact's name after the
    applicant's) never writes over a finished step."""
    steps = _steps(sheet)
    if not rows:
        return _done(sheet, steps, (sheet or {}).get("current")), None
    key = norm(label)
    open_ = steps[-1] if steps and not steps[-1]["done"] else None
    if key:
        step = _named(steps, key) or _new_step(steps, key, _text(label, 120))
    else:
        step = None
        current = _by_key(steps, (sheet or {}).get("current") or "")
        if open_ is not None and _subset(open_, rows):
            step = open_
        if (
            step is None
            and current is not None
            and current is not open_
            and _subset(current, rows)
            and _agrees(current, rows)
        ):
            step = current
        if step is None:
            step = next((s for s in reversed(steps) if _same_page(s, rows)), None)
        if step is None:
            step = open_
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
    step it is. Job Catcher's label for the page on screen; else the same
    page done again (the same title with nothing new on it; under another
    title, nothing new and an answer still the same, or a near-total
    overlap with the answers agreeing); else the step being filled; else a
    new step named by Claude."""
    steps = _steps(sheet)
    title = _text(title, 120)
    key = norm(label)
    qs = _questions(rows)
    step = None
    if key:
        step = _named(steps, key) or _new_step(steps, key, _text(label, 120))
    if step is None and title:
        # Done again after a fix: the same title, and nothing new on it.
        step = next(
            (
                s
                for s in reversed(steps)
                if norm(s["title"]) == norm(title)
                and (qs <= _questions(s["rows"]) if qs else not s["rows"])
            ),
            None,
        )
    if step is None and qs:
        step = next(
            (
                s
                for s in reversed(steps)
                if s["done"]
                and (
                    _redone(s, rows)
                    # A look-alike with something new: never into a step the
                    # owner checked under another name.
                    or (
                        _same_page(s, rows)
                        and not (s.get("checked") and norm(s["title"]) != norm(title))
                    )
                )
            ),
            None,
        )
    again = step is not None
    if step is None and steps and not steps[-1]["done"]:
        open_ = steps[-1]
        # The step being filled, unless the owner already checked it.
        if not open_.get("checked"):
            step = open_
    if step is None:
        step = _new_step(steps, norm(title) or f"page-{len(steps) + 1}", title)
    if title and step["key"].startswith("page-") and not step["done"] and not again:
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
    """Agreements, "only you", guesses and empty boxes, every one of them
    (the sheet already holds one row per step, question and order), most
    important first."""
    out = [
        {"step": s["key"], "title": s["title"], **r}
        for s in _steps(sheet)
        for r in s["rows"]
        if tag_of(r) in CHECK_TAGS
    ]
    return sorted(out, key=lambda x: CHECK_TAGS.index(tag_of(x) or "empty"))


def to_look_at(sheet: dict | None, key: str, fixes: Any = None) -> bool:
    """Page by page (spec 038): whether a finished step has anything for the
    owner to look at: an answer Claude wrote (an essay, a typed answer it
    composed), a guess, an "only you" box, an agreement, an empty box the
    form marks required, or a fix of theirs still waiting. A step with none
    of these doesn't stop."""
    if waiting(fixes, key):
        return True
    step = step_of(sheet, key)
    for r in (step or {}).get("rows") or []:
        tag = tag_of(r)
        if r.get("claude") or tag in ("agreement", "only_you", "guess"):
            return True
        if tag == "empty" and _REQUIRED.search(str(r.get("q") or "")):
            return True
    return False


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
        "now": answer_text(row.get("a")),
        "to": to or None,
        "ask": ask or None,
        "status": "waiting",
        "at": now,
    }
    if to and not ask and _same(row.get("a"), to):
        # The box already holds it: nothing for Claude to do.
        fix.update(status="done", done_at=now, already=True)
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
    """A fix as Claude gets it. Only `to` / `ask` are the owner's words; the
    box's label, its value and the step's name are the web page's text
    (`box_on_page`, `now_on_page`, `step_on_page`), kept apart, to find the
    box only (as in spec 030). `id` is for ``mark_fixes``."""
    s = step_of(sheet, fix.get("step"))
    row = find_row(sheet, fix.get("step"), fix.get("q"), fix.get("k", 1))
    out: dict[str, Any] = {
        "id": fix["id"],
        "step_on_page": s["title"] if s else "",
        "box_on_page": fix.get("q"),
        "now_on_page": answer_text((row or {}).get("a", fix.get("now"))),
    }
    if fix.get("to"):
        out["to"] = fix["to"]
    if fix.get("ask"):
        out["ask"] = fix["ask"]
    return out


def _same(a: Any, to: Any) -> bool:
    """The box holds exactly what the owner asked for (case and punctuation
    aside): "Not Hispanic or Latino" is never "Hispanic or Latino"."""
    na, nt = _fold(a), _fold(to)
    return bool(na) and na == nt


def _fix_row(steps: list[dict], f: dict) -> dict | None:
    s = _by_key(steps, f.get("step"))
    same = [r for r in (s or {}).get("rows", []) if norm(f.get("q")) in _keys(r)]
    k = f.get("k", 1)
    return same[k - 1] if 0 < k <= len(same) else None


def settle(sheet: dict | None, fixes: Any, now: str) -> tuple[dict, list[dict]]:
    """A fix Claude has is done once Job Catcher reads its box holding what
    the owner asked for (and no longer what it held before): the row is
    marked "You changed it"."""
    out = _fix_list(fixes)
    steps = _steps(sheet)
    changed = False
    for f in out:
        if f.get("status") != "sent" or not f.get("to"):
            continue
        row = _fix_row(steps, f)
        if (
            row is not None
            and _same(row.get("a"), f["to"])
            and _fold(row.get("a")) != _fold(f.get("now"))
        ):
            f.update(status="done", done_at=now)
            f.pop("claude_done", None)
            row["fixed"] = True
            row["tag"] = tag_of(row)
            changed = True
    if not changed:
        return sheet or {"steps": []}, out
    return {**(sheet or {}), "steps": steps}, out


def mark(
    sheet: dict | None,
    fixes: Any,
    *,
    done: set[str],
    gone: set[str],
    now: str,
    declined: dict[str, str] | None = None,
) -> tuple[dict, list[dict], int]:
    """Claude says which fixes it made, which boxes it couldn't find, and
    which it chose not to make (``declined``: id → why). A change stays
    "Claude says done" until Job Catcher reads the box holding it
    (``settle``); the answer itself is never taken from Claude's word."""
    out = _fix_list(fixes)
    declined = declined or {}
    n = 0
    for f in out:
        if f.get("status") not in ("waiting", "sent"):
            continue
        if f.get("id") in gone:
            f.update(status="gone", done_at=now)
            n += 1
        elif f.get("id") in declined:
            f.update(status="declined", done_at=now, why=declined[f["id"]] or None)
            n += 1
        elif f.get("id") in done:
            n += 1
            if f.get("to"):
                f.update(status="sent", claude_done=now)
            else:
                f.update(status="done", done_at=now)  # a question, answered
    sheet, out = settle(sheet, out, now)
    return sheet, out, n


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
