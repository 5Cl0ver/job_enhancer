"""IMAP sync engine — finds every in-scope email with no silent gaps.

The only module that talks to a real mailbox. Read-only by construction:
folders are opened with ``EXAMINE`` (``select(readonly=True)``), every body
fetch is ``BODY.PEEK`` (never sets ``\\Seen``), and nothing is stored, copied,
moved or expunged.

Per account, one connection is opened and reused; folders are scanned one at a
time (the inbox, then the folder flagged ``\\Junk``). Per folder:

1. **List** every visible UID with ``UID SEARCH ALL``. The result is accepted
   only if its count equals ``EXISTS`` and the tagged reply carries no
   ``[MESSAGELIMIT …]`` code — an ``OK`` alone proves nothing (Yahoo silently
   caps date searches at 1000). Otherwise it pages by sequence number in spans
   below the limit; if that is still incomplete the folder is skipped this run
   and reported ``partial``. Date searches are never used.
2. **Cursor**: the folder's fully processed UID range ``[backfill_low,
   last_uid]``. New mail is above ``last_uid`` (processed oldest first). The
   first run backfills the window (default 45 days) downward from the newest
   message until ``backfill_floor``. A recent window (default 2 days) inside
   the range is re-checked once the backfill is done.
3. **Headers first**, in small batches, with
   ``BODY.PEEK[HEADER.FIELDS (…)]``, ``INTERNALDATE``, ``RFC822.SIZE`` and
   ``EMAILID`` (when ``OBJECTID`` is offered). The generous header filter
   (``email_prefilter``) decides which bodies to download; drops are counted.
4. **Bodies** only for kept emails, with ``BODY.PEEK[]``. The per-run body cap
   (default 500) counts these downloads only. When the cap or the time budget
   is reached the folder stops *before* the next email, so the cursor covers
   only what was processed and the rest carries over to the next run.

Every requested UID must come back from a fetch; a missing one is re-searched
and skipped only if it no longer exists. Rate limits (``[LIMIT]``,
``[UNAVAILABLE]``…), an unexpected ``BYE`` or a dropped connection stop the
scan; completed work is kept and the caller applies a backoff.

For the labeling export there are two extra, still read-only, modes: a
``headers_only`` sync that records a :class:`MessageRef` for every kept and
dropped email (no bodies), and :func:`fetch_refs`, which downloads bodies for a
chosen list of refs. Both keep their progress, so a dropped connection costs a
retry, not a restart.
"""

from __future__ import annotations

import asyncio
import contextlib
import imaplib
import logging
import random
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.models.email_folder_state import ROLE_INBOX, ROLE_JUNK
from app.services.email_imap import (
    ImapAuthError,
    _parse_message,
    parse_header_block,
)
from app.services.email_prefilter import HEADER_FIELDS, possible_job_email
from app.services.email_scan import SCAN_TEXT_LIMIT, EmailMessage

logger = logging.getLogger("app.email_sync")

BACKFILL_DAYS = 45
RECHECK_DAYS = 2
BODY_CAP = 500  # full body downloads per run
JUNK_SHARE = 100  # of the cap, kept for the spam folder
HEADER_BATCH = 50
BODY_BATCH = 10
TIME_BUDGET_S = 60.0  # the scan is an HTTP request; stop and carry over after
MAX_BODY_BYTES = 10 * 1024 * 1024
SEARCH_PAGE = 900  # below MESSAGELIMIT (1000), so one page can't be truncated
VIEW_CEILING = 10_000  # Yahoo's visible-folder ceiling (observed)
IMAP_TIMEOUT = 20  # seconds per socket operation
_JUNK_NAMES = {"bulk", "bulk mail", "spam", "junk", "junk e-mail", "junk email"}

# Interruption reasons
RATE_LIMITED = "rate_limited"
CONNECTION_LOST = "connection_lost"
COMMAND_FAILED = "command_failed"
TIME_BUDGET = "time_budget"
BACKOFF_REASONS = {RATE_LIMITED, CONNECTION_LOST}

_LIMIT_TEXT = re.compile(
    rb"\[(?:LIMIT|UNAVAILABLE|THROTTLED|INUSE|OVERQUOTA)\]|rate limit|too many",
    re.I,
)


class SyncInterrupted(Exception):
    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


class _StopFolder(Exception):
    """Stop this folder (carry the rest over) but keep scanning others."""

    def __init__(self, reason: str) -> None:
        self.reason = reason


class TaggedIMAP(imaplib.IMAP4_SSL):
    """IMAP4_SSL that keeps the last tagged completion text. ``imaplib``
    discards it, but that's where ``[MESSAGELIMIT …]`` codes arrive."""

    last_tagged: bytes = b""

    def _get_tagged_response(self, tag, expect_bye=False):
        result = super()._get_tagged_response(tag, expect_bye)
        if result is not None:
            _typ, data = result
            self.last_tagged = (data[0] or b"") if data else b""
        return result


def _connect(host: str, port: int):
    return TaggedIMAP(host, port, timeout=IMAP_TIMEOUT)


# --------------------------------------------------------------------------- #
# State and results
# --------------------------------------------------------------------------- #
@dataclass
class FolderCursor:
    """In-memory mirror of ``EmailFolderState``: processed range [low, last]."""

    folder: str
    role: str
    uidvalidity: int | None = None
    last_uid: int = 0
    backfill_low: int = 1
    backfill_floor: int = 1


@dataclass
class FolderReport:
    folder_role: str
    status: str = ""  # complete | carried_over | partial | interrupted
    stopped_by: str = ""  # body_cap | time_budget | fetch_incomplete
    visible: int = 0
    new: int = 0  # above the cursor at the start of the run
    headers_read: int = 0
    filtered_out: int = 0
    kept: int = 0
    already_known: int = 0
    bodies_fetched: int = 0
    oversize: int = 0
    out_of_window: int = 0
    vanished: int = 0
    rechecked: int = 0
    carried_over: int = 0  # in scope but not processed yet
    partial: list[str] = field(default_factory=list)
    view_limited: bool = False
    uidvalidity_changed: bool = False
    filter_reasons: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


@dataclass
class SyncOptions:
    backfill_days: int = BACKFILL_DAYS
    recheck_days: int = RECHECK_DAYS
    body_cap: int | None = BODY_CAP  # None = no cap (export)
    junk_share: int = JUNK_SHARE
    header_batch: int = HEADER_BATCH
    body_batch: int = BODY_BATCH
    time_budget_s: float | None = TIME_BUDGET_S  # None = no limit (export)
    max_body_bytes: int = MAX_BODY_BYTES
    view_ceiling: int = VIEW_CEILING
    saved_companies: frozenset[str] = frozenset()
    known_locations: set[tuple[str, int, str]] = field(default_factory=set)
    known_email_ids: set[str] = field(default_factory=set)
    sample_filtered: int = 0  # export: bodies for a random sample of drops
    seed: int = 0
    # Export: record a MessageRef per email and download no bodies at all.
    headers_only: bool = False
    now: datetime | None = None
    clock: Callable[[], float] = time.monotonic


@dataclass(frozen=True)
class MessageRef:
    """Where one email lives and what the header filter said — no content."""

    folder: str
    role: str
    uidvalidity: int
    uid: int
    email_id: str = ""
    reason: str = ""  # the header filter's keep or drop reason
    kept: bool = False
    size: int | None = None

    @property
    def key(self) -> str:
        return f"{self.folder}|{self.uidvalidity}|{self.uid}"


@dataclass
class SyncResult:
    messages: list[EmailMessage] = field(default_factory=list)  # kept, read
    sampled_other: list[tuple[EmailMessage, str]] = field(default_factory=list)
    keep_reasons: dict[tuple[str, str], str] = field(default_factory=dict)
    # headers_only: every email the run looked at, kept or dropped.
    refs: list[MessageRef] = field(default_factory=list)
    cursors: dict[str, FolderCursor] = field(default_factory=dict)
    reports: list[FolderReport] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    interrupted: str | None = None

    @property
    def carried_over(self) -> int:
        return sum(r.carried_over for r in self.reports)


# --------------------------------------------------------------------------- #
# Protocol helpers
# --------------------------------------------------------------------------- #
def _quote(name: str) -> str:
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


class _Client:
    """Wraps one connection: checks every reply and classifies failures."""

    def __init__(self, conn) -> None:
        self.conn = conn

    @property
    def tagged(self) -> bytes:
        return getattr(self.conn, "last_tagged", b"") or b""

    def tagged_partial(self) -> bool:
        return b"MESSAGELIMIT" in self.tagged.upper()

    def call(self, what: str, fn, *args):
        try:
            typ, data = fn(*args)
        except imaplib.IMAP4.abort as exc:  # BYE / dropped connection
            raise SyncInterrupted(CONNECTION_LOST, what) from exc
        except imaplib.IMAP4.error as exc:
            if _LIMIT_TEXT.search(str(exc).encode()):
                raise SyncInterrupted(RATE_LIMITED, what) from exc
            raise SyncInterrupted(COMMAND_FAILED, what) from exc
        except OSError as exc:  # includes socket timeouts
            raise SyncInterrupted(CONNECTION_LOST, what) from exc
        if typ != "OK":
            text = b" ".join(d for d in (data or []) if isinstance(d, bytes))
            if _LIMIT_TEXT.search(text + b" " + self.tagged):
                raise SyncInterrupted(RATE_LIMITED, what)
            raise SyncInterrupted(COMMAND_FAILED, what)
        return data or []


_LIST_LINE = re.compile(rb'^\((?P<flags>[^)]*)\) (?:"[^"]*"|NIL) (?P<name>.*)$')


def discover_folders(client: _Client) -> list[tuple[str, str]]:
    """[(folder name, role)]: the inbox, then the ``\\Junk`` folder (by
    SPECIAL-USE flag; by standard name only if no folder carries the flag)."""
    rows = client.call("LIST", client.conn.list, '""', "*")
    parsed: list[tuple[set[str], str]] = []
    for row in rows:
        line, literal = (row[0], row[1]) if isinstance(row, tuple) else (row, None)
        if not isinstance(line, bytes):
            continue
        m = _LIST_LINE.match(line.strip())
        if not m:
            continue
        flags = {f.lower() for f in m.group("flags").decode().split()}
        raw_name = literal if literal is not None else m.group("name")
        name = raw_name.decode(errors="replace").strip()
        if name.startswith('"') and name.endswith('"'):
            name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        parsed.append((flags, name))
    folders = [("INBOX", ROLE_INBOX)]
    junk = next((n for fl, n in parsed if "\\junk" in fl), None)
    if junk is None:
        junk = next(
            (
                n
                for fl, n in parsed
                if n.lower() in _JUNK_NAMES and "\\noselect" not in fl
            ),
            None,
        )
    if junk and junk.upper() != "INBOX":
        folders.append((junk, ROLE_JUNK))
    return folders


def _response_int(conn, code: str) -> int | None:
    with contextlib.suppress(Exception):
        _, data = conn.response(code)
        if data and data[0]:
            return int(data[0])
    return None


_FETCH_UID = re.compile(rb"\bUID (\d+)")
_FETCH_DATE = re.compile(rb'INTERNALDATE "([^"]+)"')
_FETCH_SIZE = re.compile(rb"RFC822\.SIZE (\d+)")
_FETCH_EMAILID = re.compile(rb"EMAILID \(([^)\s]+)\)")


@dataclass
class _Fetched:
    uid: int
    internaldate: datetime | None = None
    size: int | None = None
    email_id: str = ""
    literal: bytes | None = None


def _parse_fetch(data) -> dict[int, _Fetched]:
    """imaplib FETCH reply → {uid: _Fetched}. Attributes may sit before or after
    the literal (servers differ), so the following plain bytes are included."""
    out: dict[int, _Fetched] = {}
    items = list(data or [])
    i = 0
    while i < len(items):
        item = items[i]
        literal = None
        if isinstance(item, tuple) and len(item) >= 2:
            meta, literal = item[0], item[1]
            if i + 1 < len(items) and isinstance(items[i + 1], bytes):
                meta = meta + b" " + items[i + 1]
                i += 1
        elif isinstance(item, bytes) and item.strip() not in (b")", b""):
            meta = item
        else:
            i += 1
            continue
        i += 1
        m = _FETCH_UID.search(meta)
        if not m:
            continue
        rec = _Fetched(uid=int(m.group(1)), literal=literal)
        if d := _FETCH_DATE.search(meta):
            with contextlib.suppress(ValueError):
                rec.internaldate = datetime.strptime(
                    d.group(1).decode(), "%d-%b-%Y %H:%M:%S %z"
                )
        if s := _FETCH_SIZE.search(meta):
            rec.size = int(s.group(1))
        if e := _FETCH_EMAILID.search(meta):
            rec.email_id = e.group(1).decode(errors="replace")
        out[rec.uid] = rec
    return out


def _uid_set(uids: list[int]) -> str:
    return ",".join(str(u) for u in uids)


def _parse_search(data) -> list[int]:
    out: list[int] = []
    for chunk in data or []:
        if isinstance(chunk, bytes):
            out.extend(int(x) for x in chunk.split() if x.isdigit())
    return out


# --------------------------------------------------------------------------- #
# The per-folder sync
# --------------------------------------------------------------------------- #
class _FolderSync:
    def __init__(
        self,
        client: _Client,
        cursor: FolderCursor | None,
        folder: str,
        role: str,
        opts: SyncOptions,
        body_budget: int | None,
        deadline: float | None,
        objectid: bool,
        result: SyncResult,
        filtered: list[tuple[str, int, int | None]],
    ) -> None:
        self.c = client
        self.folder = folder
        self.role = role
        self.opts = opts
        self.body_budget = body_budget
        self.deadline = deadline
        self.objectid = objectid
        self.result = result
        self.filtered = filtered
        self.report = FolderReport(folder_role=role)
        self.cursor = cursor or FolderCursor(folder=folder, role=role)
        self.uidvalidity: int | None = None
        self.now = opts.now or datetime.now(UTC)

    # -- budget ------------------------------------------------------------ #
    def _check_time(self) -> None:
        if self.deadline is not None and self.opts.clock() >= self.deadline:
            raise _StopFolder(TIME_BUDGET)

    def _take_body(self) -> bool:
        if self.body_budget is None:
            return True
        if self.body_budget <= 0:
            return False
        self.body_budget -= 1
        return True

    # -- listing ----------------------------------------------------------- #
    def _list_uids(self, exists: int) -> list[int] | None:
        conn = self.c.conn
        uids = _parse_search(self.c.call("SEARCH ALL", conn.uid, "search", None, "ALL"))
        if len(uids) == exists and not self.c.tagged_partial():
            return sorted(set(uids))
        self.report.partial.append("search_all_incomplete")
        got: set[int] = set()
        complete = True
        for start in range(1, exists + 1, SEARCH_PAGE):
            end = min(exists, start + SEARCH_PAGE - 1)
            page = _parse_search(
                self.c.call("SEARCH page", conn.uid, "search", None, f"{start}:{end}")
            )
            if len(page) != end - start + 1 or self.c.tagged_partial():
                complete = False
            got.update(page)
        if not complete or len(got) != exists:
            self.report.partial.append("search_pages_incomplete")
            return None
        return sorted(got)

    def _internaldate(self, uid: int) -> datetime | None:
        data = self.c.call(
            "FETCH date", self.c.conn.uid, "fetch", str(uid), "(UID INTERNALDATE)"
        )
        rec = _parse_fetch(data).get(uid)
        return rec.internaldate if rec else None

    def _first_index_since(self, uids: list[int], since: datetime) -> int:
        """Binary search for the first UID whose INTERNALDATE >= since.
        Dates follow arrival order closely (not strictly), so the backfill also
        checks each message's own date."""
        lo, hi = 0, len(uids)
        while lo < hi:
            mid = (lo + hi) // 2
            d = self._internaldate(uids[mid])
            if d is None or d >= since:
                hi = mid
            else:
                lo = mid + 1
        return lo

    # -- fetching ---------------------------------------------------------- #
    def _verify(self, requested: list[int], got: dict[int, _Fetched], what: str):
        missing = [u for u in requested if u not in got]
        if not missing:
            return set()
        still = set(
            _parse_search(
                self.c.call(
                    "SEARCH missing",
                    self.c.conn.uid,
                    "search",
                    None,
                    "UID",
                    _uid_set(missing),
                )
            )
        )
        if still & set(missing):
            self.report.partial.append(f"{what}_missing")
            raise _StopFolder("fetch_incomplete")
        self.report.vanished += len(missing)
        return set(missing)  # deleted between listing and fetching

    def _fetch_headers(self, uids: list[int]) -> tuple[dict[int, _Fetched], set]:
        fields = " ".join(HEADER_FIELDS)
        extra = " EMAILID" if self.objectid else ""
        items = (
            f"(UID INTERNALDATE RFC822.SIZE{extra} BODY.PEEK[HEADER.FIELDS ({fields})])"
        )
        data = self.c.call(
            "FETCH headers", self.c.conn.uid, "fetch", _uid_set(uids), items
        )
        got = _parse_fetch(data)
        gone = self._verify(uids, got, "headers")
        self.report.headers_read += len(got)
        return got, gone

    def _fetch_bodies(self, uids: list[int]) -> dict[int, _Fetched]:
        out: dict[int, _Fetched] = {}
        for i in range(0, len(uids), self.opts.body_batch):
            batch = uids[i : i + self.opts.body_batch]
            data = self.c.call(
                "FETCH bodies",
                self.c.conn.uid,
                "fetch",
                _uid_set(batch),
                "(UID BODY.PEEK[])",
            )
            got = _parse_fetch(data)
            self._verify(batch, got, "bodies")
            out.update(got)
        self.report.bodies_fetched += len(out)
        return out

    def _message(self, uid: int, raw: bytes, email_id: str) -> EmailMessage:
        msg = _parse_message(str(uid), raw)
        # Keep only the top of the text: a pass can hold hundreds of emails.
        msg.body = msg.body[:SCAN_TEXT_LIMIT]
        msg.newest_text = msg.newest_text[:SCAN_TEXT_LIMIT]
        msg.folder = self.folder
        msg.uidvalidity = self.uidvalidity
        msg.email_id = email_id
        return msg

    # -- processing -------------------------------------------------------- #
    def _process(self, uids: list[int], direction: str, window_start: datetime):
        """Process UIDs in order; advance the cursor over the done prefix of
        each batch. Stops (raising _StopFolder) at the body cap / time budget."""
        for i in range(0, len(uids), self.opts.header_batch):
            self._check_time()
            chunk = uids[i : i + self.opts.header_batch]
            heads, gone = self._fetch_headers(chunk)
            done: list[int] = []
            want_body: list[int] = []
            header_only: list[EmailMessage] = []
            stop: str | None = None
            for uid in chunk:
                if uid in gone:
                    done.append(uid)
                    continue
                rec = heads[uid]
                if (
                    direction == "backfill"
                    and rec.internaldate
                    and rec.internaldate < window_start
                ):
                    self.report.out_of_window += 1
                    done.append(uid)
                    continue
                if (
                    self.folder,
                    self.uidvalidity,
                    str(uid),
                ) in self.opts.known_locations or (
                    rec.email_id and rec.email_id in self.opts.known_email_ids
                ):
                    self.report.already_known += 1
                    done.append(uid)
                    continue
                keep, reason = possible_job_email(
                    parse_header_block(rec.literal or b""), self.opts.saved_companies
                )
                self.report.filter_reasons[reason] = (
                    self.report.filter_reasons.get(reason, 0) + 1
                )
                if self.opts.headers_only:
                    self.result.refs.append(
                        MessageRef(
                            folder=self.folder,
                            role=self.role,
                            uidvalidity=self.uidvalidity,
                            uid=uid,
                            email_id=rec.email_id,
                            reason=reason,
                            kept=keep,
                            size=rec.size,
                        )
                    )
                    if keep:
                        self.report.kept += 1
                    else:
                        self.report.filtered_out += 1
                    done.append(uid)
                    continue
                if keep:
                    self.result.keep_reasons[(self.folder, str(uid))] = reason
                else:
                    self.report.filtered_out += 1
                    self.filtered.append((self.folder, uid, self.uidvalidity))
                    done.append(uid)
                    continue
                if rec.size and rec.size > self.opts.max_body_bytes:
                    self.report.oversize += 1
                    self.report.kept += 1
                    m = self._message(uid, rec.literal or b"", rec.email_id)
                    m.read_issues = tuple(sorted({*m.read_issues, "oversize"}))
                    header_only.append(m)
                    done.append(uid)
                    continue
                if not self._take_body():
                    stop = "body_cap"
                    break
                want_body.append(uid)
                done.append(uid)
            bodies = self._fetch_bodies(want_body) if want_body else {}
            for uid in want_body:
                rec = bodies.get(uid)
                if rec is None:  # vanished between header and body fetch
                    continue
                self.report.kept += 1
                self.result.messages.append(
                    self._message(uid, rec.literal or b"", heads[uid].email_id)
                )
            self.result.messages.extend(header_only)
            if direction == "recheck":
                self.report.rechecked += len(done)
            if done:
                if direction == "forward":
                    self.cursor.last_uid = max(self.cursor.last_uid, done[-1])
                elif direction == "backfill":
                    self.cursor.backfill_low = min(self.cursor.backfill_low, done[-1])
            if stop:
                raise _StopFolder(stop)

    def run(self) -> FolderCursor:
        conn = self.c.conn
        data = self.c.call("EXAMINE", conn.select, _quote(self.folder), True)
        exists = int(data[0]) if data and data[0] and data[0].isdigit() else 0
        self.uidvalidity = _response_int(conn, "UIDVALIDITY")
        self.report.visible = exists
        self.report.view_limited = exists >= self.opts.view_ceiling
        if self.uidvalidity is None:
            self.report.partial.append("no_uidvalidity")
            self.report.status = "partial"
            return self.cursor  # can't key anything safely
        if (
            self.cursor.uidvalidity is not None
            and self.cursor.uidvalidity != self.uidvalidity
        ):
            self.report.uidvalidity_changed = True
            self.cursor = FolderCursor(folder=self.folder, role=self.role)

        uids = self._list_uids(exists)
        if uids is None:
            self.report.status = "partial"  # never advance on an incomplete list
            return self.cursor

        window_start = self.now - timedelta(days=self.opts.backfill_days)
        if self.cursor.uidvalidity is None:  # first run for this folder
            top = uids[-1] if uids else 0
            floor_idx = self._first_index_since(uids, window_start) if uids else 0
            self.cursor = FolderCursor(
                folder=self.folder,
                role=self.role,
                uidvalidity=self.uidvalidity,
                last_uid=top,
                backfill_low=top + 1,
                backfill_floor=uids[floor_idx] if floor_idx < len(uids) else top + 1,
            )

        cur = self.cursor
        forward = [u for u in uids if u > cur.last_uid]
        backfill = [
            u for u in reversed(uids) if cur.backfill_floor <= u < cur.backfill_low
        ]
        self.report.new = len(forward)
        try:
            self._process(forward, "forward", window_start)
            self._process(backfill, "backfill", window_start)
            if not backfill and self.opts.recheck_days:
                processed = [u for u in uids if cur.backfill_low <= u <= cur.last_uid]
                since = self.now - timedelta(days=self.opts.recheck_days)
                start = self._first_index_since(processed, since) if processed else 0
                self._process(processed[start:], "recheck", window_start)
            self.report.status = "complete"
        except _StopFolder as stop:
            self.report.stopped_by = stop.reason
            self.report.status = (
                "partial" if stop.reason == "fetch_incomplete" else "carried_over"
            )
        finally:
            cur = self.cursor
            self.report.carried_over = sum(1 for u in uids if u > cur.last_uid) + sum(
                1 for u in uids if cur.backfill_floor <= u < cur.backfill_low
            )
            if self.report.status == "complete" and self.report.carried_over:
                self.report.status = "carried_over"
        return self.cursor


# --------------------------------------------------------------------------- #
# Entry points
# --------------------------------------------------------------------------- #
def _sample_bodies(
    client: _Client,
    filtered: list[tuple[str, int, int | None]],
    opts: SyncOptions,
    result: SyncResult,
) -> None:
    """Export only: download bodies for a seeded random sample of drops."""
    if not filtered or opts.sample_filtered <= 0:
        return
    picks = random.Random(opts.seed).sample(
        filtered, min(opts.sample_filtered, len(filtered))
    )
    by_folder: dict[str, list[tuple[int, int | None]]] = {}
    for folder, uid, uv in picks:
        by_folder.setdefault(folder, []).append((uid, uv))
    for folder, items in by_folder.items():
        client.call("EXAMINE", client.conn.select, _quote(folder), True)
        uids = sorted(u for u, _ in items)
        uv_of = dict(items)
        for i in range(0, len(uids), opts.body_batch):
            batch = uids[i : i + opts.body_batch]
            data = client.call(
                "FETCH sample",
                client.conn.uid,
                "fetch",
                _uid_set(batch),
                "(UID BODY.PEEK[])",
            )
            for uid, rec in _parse_fetch(data).items():
                msg = _parse_message(str(uid), rec.literal or b"")
                msg.folder, msg.uidvalidity = folder, uv_of.get(uid)
                result.sampled_other.append((msg, "bulk_no_job_signal"))


def sync_blocking(
    host: str,
    port: int,
    address: str,
    password: str,
    cursors: dict[str, FolderCursor],
    opts: SyncOptions | None = None,
) -> SyncResult:
    """One read-only sync over one connection. Raises ImapAuthError on a bad
    login; connect failures raise SyncInterrupted(CONNECTION_LOST). Every other
    stop is recorded in ``result.interrupted`` with completed work kept."""
    opts = opts or SyncOptions()
    result = SyncResult()
    start = opts.clock()
    deadline = start + opts.time_budget_s if opts.time_budget_s else None
    try:
        conn = _connect(host, port)
    except OSError as exc:
        raise SyncInterrupted(CONNECTION_LOST, "connect") from exc
    client = _Client(conn)
    try:
        try:
            conn.login(address, password)
        except imaplib.IMAP4.abort as exc:
            raise SyncInterrupted(CONNECTION_LOST, "login") from exc
        except imaplib.IMAP4.error as exc:
            if _LIMIT_TEXT.search(str(exc).encode()):
                raise SyncInterrupted(RATE_LIMITED, "login") from exc
            raise ImapAuthError(str(exc)) from exc
        caps = client.call("CAPABILITY", conn.capability)
        result.capabilities = caps[0].decode().split() if caps and caps[0] else []
        logger.info("imap capabilities: %s", " ".join(result.capabilities))
        objectid = "OBJECTID" in {c.upper() for c in result.capabilities}

        folders = discover_folders(client)
        has_junk = any(role == ROLE_JUNK for _, role in folders)
        cap = opts.body_cap
        budgets = {
            ROLE_INBOX: None
            if cap is None
            else max(0, cap - (opts.junk_share if has_junk else 0)),
        }
        filtered: list[tuple[str, int, int | None]] = []
        leftover = 0
        for name, role in folders:
            if cap is None:
                budget = None
            elif role == ROLE_INBOX:
                budget = budgets[ROLE_INBOX]
            else:
                budget = min(cap, opts.junk_share + leftover)
            # Inbox may use 75% of the time budget so spam always gets a turn.
            if deadline is not None and role == ROLE_INBOX and has_junk:
                folder_deadline = start + 0.75 * opts.time_budget_s
            else:
                folder_deadline = deadline
            fs = _FolderSync(
                client,
                cursors.get(name),
                name,
                role,
                opts,
                budget,
                folder_deadline,
                objectid,
                result,
                filtered,
            )
            try:
                result.cursors[name] = fs.run()
            except SyncInterrupted:
                result.cursors[name] = fs.cursor  # completed batches are kept
                fs.report.status = "interrupted"
                result.reports.append(fs.report)
                raise
            result.reports.append(fs.report)
            if role == ROLE_INBOX and budget is not None:
                leftover = fs.body_budget or 0
        if not opts.headers_only:
            _sample_bodies(client, filtered, opts, result)
    except SyncInterrupted as exc:
        result.interrupted = exc.reason
        logger.warning("email sync interrupted: %s", exc.reason)
    finally:
        with contextlib.suppress(Exception):
            conn.logout()
    return result


def fetch_refs(
    host: str,
    port: int,
    address: str,
    password: str,
    refs: list[MessageRef],
    on_message: Callable[[MessageRef, bytes | None, str], None],
    *,
    body_batch: int = BODY_BATCH,
    max_body_bytes: int = MAX_BODY_BYTES,
) -> None:
    """Export only: download the bodies of ``refs`` (read-only, BODY.PEEK).

    Calls ``on_message(ref, raw, issue)`` once per ref as it completes, so the
    caller can save progress: ``raw`` is the message (headers only for an
    oversize one), or None when it is gone — ``issue`` then says why
    (``vanished`` or ``uidvalidity_changed``). A ref with no UIDVALIDITY (a row
    saved before folders were tracked) is read at the folder's current one; the
    caller must check it is the same email. Raises :class:`SyncInterrupted`
    on a dropped connection or rate limit; refs already reported are done.
    """
    try:
        conn = _connect(host, port)
    except OSError as exc:
        raise SyncInterrupted(CONNECTION_LOST, "connect") from exc
    client = _Client(conn)
    try:
        try:
            conn.login(address, password)
        except imaplib.IMAP4.abort as exc:
            raise SyncInterrupted(CONNECTION_LOST, "login") from exc
        except imaplib.IMAP4.error as exc:
            if _LIMIT_TEXT.search(str(exc).encode()):
                raise SyncInterrupted(RATE_LIMITED, "login") from exc
            raise ImapAuthError(str(exc)) from exc
        by_folder: dict[str, list[MessageRef]] = {}
        for r in refs:
            by_folder.setdefault(r.folder, []).append(r)
        for folder, items in by_folder.items():
            client.call("EXAMINE", conn.select, _quote(folder), True)
            uv = _response_int(conn, "UIDVALIDITY")
            stale = [r for r in items if r.uidvalidity not in (uv, None)]
            for r in stale:  # the folder was rebuilt: these UIDs mean nothing now
                on_message(r, None, "uidvalidity_changed")
            items = sorted(
                (r for r in items if r.uidvalidity in (uv, None)), key=lambda r: r.uid
            )
            big = [r for r in items if r.size and r.size > max_body_bytes]
            small = [r for r in items if r not in big]
            for what, part, group in (
                ("FETCH bodies", "BODY.PEEK[]", small),
                ("FETCH oversize headers", "BODY.PEEK[HEADER]", big),
            ):
                for i in range(0, len(group), body_batch):
                    batch = group[i : i + body_batch]
                    data = client.call(
                        what,
                        conn.uid,
                        "fetch",
                        _uid_set([r.uid for r in batch]),
                        f"(UID {part})",
                    )
                    got = _parse_fetch(data)
                    for r in batch:
                        rec = got.get(r.uid)
                        if rec is None:
                            on_message(r, None, "vanished")
                        else:
                            issue = "oversize" if group is big else ""
                            on_message(r, rec.literal or b"", issue)
    finally:
        with contextlib.suppress(Exception):
            conn.logout()


async def sync_mailbox(
    host: str,
    port: int,
    address: str,
    password: str,
    cursors: dict[str, FolderCursor],
    opts: SyncOptions | None = None,
) -> SyncResult:
    """Async wrapper — imaplib is synchronous, so run it in a worker thread."""
    return await asyncio.to_thread(
        sync_blocking, host, port, address, password, cursors, opts
    )
