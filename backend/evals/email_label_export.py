"""Phase 6 labeling export — resumable, read-only, seeded.

Builds a hand-labeling sheet from a real mailbox in three resumable steps,
saving progress to a state file next to the export after every batch:

1. **Headers** — ``headers_only`` syncs of inbox + spam over the window, with
   the folder cursors saved in the state file. A dropped connection or rate
   limit retries from the saved cursors until every folder is complete.
2. **Select** — a seeded sample: ``n_likely`` emails the header filter kept
   (stratified by keep reason, every reason represented) and ``n_other`` it
   dropped. Saved in the state file, so a resumed run fetches the same rows.
3. **Bodies** — only the selected emails (``BODY.PEEK``), each written to the
   CSV as it arrives. A retry skips rows already written.

Real mail only ever lands in a git-ignored path (``ensure_git_ignored``). The
summary carries counts only — by keep reason, folder, and MIME structure (for
blank emails); no subjects, senders or text.
"""

from __future__ import annotations

import csv
import email
import email.policy
import json
import os
import random
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.services import email_sync
from app.services.email_imap import ImapAuthError, _parse_message
from app.services.email_sync import (
    FolderCursor,
    MessageRef,
    SyncInterrupted,
    SyncOptions,
)
from evals.email_export import (
    EXPORT_COLUMNS,
    LIKELY_JOB,
    SAMPLE_OTHER,
    _cell,
    _row_id,
    ensure_git_ignored,
    job_keys,
)
from evals.email_pipeline import excerpt, predict_message

STATE_VERSION = 1
DEFAULT_SEED = 1337
N_LIKELY, N_OTHER = 350, 150
MIN_PER_REASON = 20  # each keep reason gets at least this many (or all it has)
TEXT_LIMIT = 6000  # characters of cleaned text shown on the labeling page

# The label sheet: the Phase 1 columns, then what the labeling page needs.
LABEL_COLUMNS = [*EXPORT_COLUMNS, "role", "mime_shape", "body_blank", "match", "text"]


class ExportFailed(Exception):
    """The export could not finish (login failed, or out of retries)."""


# --------------------------------------------------------------------------- #
# MIME structure — content types only, never content
# --------------------------------------------------------------------------- #
def mime_shape(raw: bytes) -> str:
    """The message's MIME tree as content types, e.g.
    ``multipart/alternative(text/plain,text/html)``. Attachments show as their
    type; nothing from headers or bodies other than ``Content-Type``."""
    try:
        msg = email.message_from_bytes(raw, policy=email.policy.compat32)
    except Exception:  # noqa: BLE001 — unparsable is itself a shape
        return "unparsable"

    def walk(part, depth: int = 0) -> str:
        ctype = (part.get_content_type() or "unknown").lower()
        if part.is_multipart() and depth < 6:
            kids = part.get_payload() or []
            return f"{ctype}({','.join(walk(k, depth + 1) for k in kids)})"
        return ctype

    return walk(msg)


# --------------------------------------------------------------------------- #
# State
# --------------------------------------------------------------------------- #
@dataclass
class ExportState:
    seed: int
    days: int
    n_likely: int
    n_other: int
    cursors: dict[str, dict] = field(default_factory=dict)
    headers_done: bool = False
    refs: dict[str, dict] = field(default_factory=dict)  # key -> MessageRef
    selection: list[list[str]] = field(default_factory=list)  # [key, group]
    done: dict[str, str] = field(default_factory=dict)  # key -> "" | issue
    retries: int = 0
    interruptions: dict[str, int] = field(default_factory=dict)
    version: int = STATE_VERSION

    @classmethod
    def load(cls, path: Path) -> ExportState | None:
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != STATE_VERSION:
            raise ExportFailed(f"{path.name} is from another export version")
        return cls(**data)

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(asdict(self)), encoding="utf-8")
        os.replace(tmp, path)  # atomic: a crash leaves the old or the new state

    def ref(self, key: str) -> MessageRef:
        return MessageRef(**self.refs[key])

    def cursor_objs(self) -> dict[str, FolderCursor]:
        return {k: FolderCursor(**v) for k, v in self.cursors.items()}


def state_path_for(csv_path: Path) -> Path:
    return csv_path.with_name(f"{csv_path.stem}.state.json")


# --------------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------------- #
def _allocate(counts: dict[str, int], n: int, floor: int) -> dict[str, int]:
    """Split ``n`` across reasons: each gets min(count, floor) first, the rest
    goes proportionally to what is left (largest remainder)."""
    if sum(counts.values()) <= n:
        return dict(counts)
    take = {r: min(c, floor) for r, c in counts.items()}
    left = n - sum(take.values())
    if left < 0:  # more reasons than room for the floor: plain proportional
        take = dict.fromkeys(counts, 0)
        left = n
    spare = {r: counts[r] - take[r] for r in counts}
    total = sum(spare.values())
    if total and left:
        shares = {r: left * spare[r] / total for r in counts}
        for r in counts:
            take[r] += int(shares[r])
        rest = n - sum(take.values())
        for r in sorted(counts, key=lambda r: (-(shares[r] % 1), r))[:rest]:
            take[r] += 1
    return {r: min(take[r], counts[r]) for r in counts}


def select_rows(
    refs: list[MessageRef],
    seed: int,
    n_likely: int = N_LIKELY,
    n_other: int = N_OTHER,
    floor: int = MIN_PER_REASON,
) -> list[tuple[str, str]]:
    """Seeded ``(key, group)`` picks. The same refs and seed always give the
    same rows, whatever order the refs arrive in."""
    rng = random.Random(seed)
    kept = sorted((r for r in refs if r.kept), key=lambda r: r.key)
    other = sorted((r for r in refs if not r.kept), key=lambda r: r.key)
    by_reason: dict[str, list[MessageRef]] = {}
    for r in kept:
        by_reason.setdefault(r.reason, []).append(r)
    quota = _allocate({k: len(v) for k, v in by_reason.items()}, n_likely, floor)
    picks: list[tuple[str, str]] = []
    for reason in sorted(by_reason):
        for r in rng.sample(by_reason[reason], quota[reason]):
            picks.append((r.key, LIKELY_JOB))
    for r in rng.sample(other, min(n_other, len(other))):
        picks.append((r.key, SAMPLE_OTHER))
    return picks


# --------------------------------------------------------------------------- #
# Rows
# --------------------------------------------------------------------------- #
def label_row(msg, group: str, ref: MessageRef, shape: str, jobs, keys) -> list:
    p = predict_message(msg, jobs)
    blank = not (msg.body or "").strip()
    text = " ".join((msg.body or "").split())[:TEXT_LIMIT]
    return [
        _row_id(msg),
        group,
        _cell(msg.folder),
        msg.uidvalidity if msg.uidvalidity is not None else "",
        msg.uid,
        msg.date.isoformat() if msg.date else "",
        _cell(msg.from_addr),
        _cell(msg.subject),
        _cell(excerpt(msg.body)),
        ref.reason,
        " ".join(msg.read_issues),
        p.event,
        keys.get(str(p.job_id), "") if p.job_id else "",
        "",
        "",
        "",
        ref.role,
        shape,
        "yes" if blank else "",
        f"{p.match_status}:{p.match_evidence}" if p.match_evidence else p.match_status,
        _cell(text),
    ]


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
@dataclass
class Mailbox:
    host: str
    port: int
    address: str
    password: str


def _wait(attempt: int, reason: str) -> float:
    base = 30.0 if reason == email_sync.RATE_LIMITED else 5.0
    return min(300.0, base * (2 ** min(attempt, 5)))


def _with_retries(step, state: ExportState, save, max_retries: int, sleep, log):
    """Run ``step`` until it returns True; retry dropped connections."""
    attempt = 0
    while True:
        try:
            if step():
                return
            attempt = 0  # progress made, but not finished: go again
            continue
        except SyncInterrupted as exc:
            reason = exc.reason
        except ImapAuthError as exc:
            raise ExportFailed("login failed — check the app password") from exc
        except OSError:
            reason = email_sync.CONNECTION_LOST
        state.retries += 1
        state.interruptions[reason] = state.interruptions.get(reason, 0) + 1
        save()
        if attempt >= max_retries:
            raise ExportFailed(f"gave up after {attempt} retries ({reason})")
        delay = _wait(attempt, reason)
        log(f"  interrupted ({reason}); retry {attempt + 1} in {delay:.0f}s")
        sleep(delay)
        attempt += 1


def run_export(
    box: Mailbox,
    jobs: list[dict],
    saved_companies: frozenset[str],
    out: Path,
    *,
    seed: int = DEFAULT_SEED,
    days: int = 45,
    n_likely: int = N_LIKELY,
    n_other: int = N_OTHER,
    max_retries: int = 8,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
    rebuild: bool = False,
) -> dict:
    """Run (or resume) the export into ``out``; return the count summary.

    ``rebuild`` re-reads the SAME selected rows (after a reader fix): the saved
    selection is kept, the written rows are discarded and fetched again."""
    state_path = state_path_for(out)
    ensure_git_ignored(out, state_path)
    state = ExportState.load(state_path)
    if state is None:
        state = ExportState(seed=seed, days=days, n_likely=n_likely, n_other=n_other)
        if out.exists():
            out.unlink()  # a sheet without its state can't be resumed safely
    elif (state.seed, state.days, state.n_likely, state.n_other) != (
        seed,
        days,
        n_likely,
        n_other,
    ):
        raise ExportFailed(
            "an export with other settings is in progress here; "
            "use its settings or a new file name"
        )
    if rebuild:
        if not state.selection:
            raise ExportFailed("nothing to rebuild: no saved selection here")
        state.done = {}
        if out.exists():
            out.unlink()
        state.save(state_path)

    def save() -> None:
        state.save(state_path)

    # 1. Headers, until every folder is complete.
    def header_pass() -> bool:
        opts = SyncOptions(
            backfill_days=state.days,
            recheck_days=0,
            body_cap=None,
            time_budget_s=None,
            saved_companies=saved_companies,
            headers_only=True,
        )
        res = email_sync.sync_blocking(
            box.host, box.port, box.address, box.password, state.cursor_objs(), opts
        )
        for name, cur in res.cursors.items():
            old = state.cursors.get(name)
            if old and old.get("uidvalidity") not in (None, cur.uidvalidity):
                # Folder rebuilt: its old refs point at nothing now.
                state.refs = {
                    k: v for k, v in state.refs.items() if v["folder"] != name
                }
            state.cursors[name] = asdict(cur)
        for r in res.refs:
            state.refs[r.key] = asdict(r)
        save()
        if res.interrupted:
            raise SyncInterrupted(res.interrupted, "headers")
        if any(r.status == "partial" for r in res.reports):
            raise SyncInterrupted(email_sync.COMMAND_FAILED, "incomplete listing")
        if not all(r.status == "complete" for r in res.reports):
            # Shouldn't happen without a cap or time budget; retry, bounded.
            raise SyncInterrupted(email_sync.COMMAND_FAILED, "not complete")
        state.headers_done = True
        save()
        return True

    if not state.headers_done:
        log("step 1/3: reading headers (inbox + spam)…")
        _with_retries(header_pass, state, save, max_retries, sleep, log)

    # 2. Seeded selection, made once.
    if not state.selection:
        refs = [state.ref(k) for k in state.refs]
        state.selection = [list(p) for p in select_rows(refs, seed, n_likely, n_other)]
        save()

    # 3. Bodies for the selection, written as they arrive.
    keys = job_keys(jobs)
    group_of = dict((k, g) for k, g in state.selection)
    _reconcile(out, state)
    save()
    new_file = not out.exists()
    with out.open("a", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(LABEL_COLUMNS)
            f.flush()

        def on_message(ref: MessageRef, raw: bytes | None, issue: str) -> None:
            if raw is not None:
                msg = _parse_message(str(ref.uid), raw)
                msg.folder, msg.uidvalidity, msg.email_id = (
                    ref.folder,
                    ref.uidvalidity,
                    ref.email_id,
                )
                if issue:
                    msg.read_issues = tuple(sorted({*msg.read_issues, issue}))
                w.writerow(
                    label_row(msg, group_of[ref.key], ref, mime_shape(raw), jobs, keys)
                )
                f.flush()
            state.done[ref.key] = issue
            if len(state.done) % 10 == 0:
                save()

        def body_pass() -> bool:
            todo = [state.ref(k) for k, _ in state.selection if k not in state.done]
            if todo:
                try:
                    email_sync.fetch_refs(
                        box.host,
                        box.port,
                        box.address,
                        box.password,
                        todo,
                        on_message,
                    )
                finally:
                    save()
            return True

        log(f"step 3/3: fetching {len(state.selection)} selected emails…")
        _with_retries(body_pass, state, save, max_retries, sleep, log)

    summary = summarize(state, out)
    out.with_name(f"{out.stem}.summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    return summary


def _row_key(row: dict) -> str:
    folder = row["folder"].removeprefix("'")
    return f"{folder}|{row['uidvalidity']}|{row['uid']}"


def _reconcile(out: Path, state: ExportState) -> None:
    """Make the sheet and the state agree before writing more: keep each
    complete row once, drop a half-written last line (a crash mid-write), and
    mark every row on disk as done so a resume never writes it twice."""
    if not out.exists():
        return
    with out.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if not rows or rows[0] != LABEL_COLUMNS:
        out.unlink()
        state.done = {k: v for k, v in state.done.items() if v and v != "oversize"}
        return
    seen: set[str] = set()
    good: list[list[str]] = []
    for row in rows[1:]:
        if len(row) != len(LABEL_COLUMNS):
            continue
        key = _row_key(dict(zip(LABEL_COLUMNS, row, strict=True)))
        if key in seen:
            continue
        seen.add(key)
        good.append(row)
    # Written rows are done; a "done" without a row (and no reason) is not.
    state.done = {
        k: v for k, v in state.done.items() if k in seen or (v and v != "oversize")
    }
    for k in seen:
        state.done.setdefault(k, "")
    if len(good) != len(rows) - 1:
        with out.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(LABEL_COLUMNS)
            w.writerows(good)


def summarize(state: ExportState, out: Path) -> dict:
    """Counts only — no email content."""
    refs = [state.ref(k) for k in state.refs]
    pop = Counter((r.role, "kept" if r.kept else "dropped", r.reason) for r in refs)
    by_folder = Counter((r.role, "kept" if r.kept else "dropped") for r in refs)
    sel = Counter()
    for k, g in state.selection:
        r = state.ref(k)
        sel[(g, r.role, r.reason)] += 1
    shapes_all: Counter = Counter()
    shapes_blank: Counter = Counter()
    rows = 0
    if out.exists():
        with out.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                rows += 1
                shapes_all[row["mime_shape"]] += 1
                if row["body_blank"] == "yes":
                    shapes_blank[row["mime_shape"]] += 1
    return {
        "rows_written": rows,
        "selected": len(state.selection),
        "not_written": dict(
            Counter(v for v in state.done.values() if v and v != "oversize")
        ),
        "mailbox_by_folder": {f"{a}/{b}": n for (a, b), n in sorted(by_folder.items())},
        "mailbox_by_reason": {
            f"{a}/{b}/{c}": n for (a, b, c), n in sorted(pop.items())
        },
        "selected_by_group_folder_reason": {
            f"{a}/{b}/{c}": n for (a, b, c), n in sorted(sel.items())
        },
        "blank_by_mime_shape": dict(shapes_blank.most_common()),
        "rows_by_mime_shape": dict(shapes_all.most_common()),
        "retries": state.retries,
        "interruptions": state.interruptions,
        "seed": state.seed,
        "days": state.days,
    }
