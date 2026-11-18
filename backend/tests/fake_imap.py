"""A fake IMAP server for sync-engine tests — no network, fictional mail only.

Speaks just enough imaplib-shaped protocol for ``app.services.email_sync``:
LIST with SPECIAL-USE flags, EXAMINE with UIDVALIDITY, UID SEARCH (ALL,
sequence ranges, UID sets), UID FETCH (INTERNALDATE, RFC822.SIZE, EMAILID,
header fields, full bodies). It can misbehave on purpose: silently truncate
``SEARCH ALL`` (like Yahoo's capped searches), add a ``[MESSAGELIMIT]`` code,
drop or delete UIDs mid-fetch, rate-limit, or drop the connection.

It also enforces the read-only rules: any non-readonly select, any fetch that
isn't ``BODY.PEEK`` (or plain metadata), and any mailbox-changing command
fails the test.
"""

from __future__ import annotations

import imaplib
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

MUTATING = {"store", "copy", "move", "expunge", "delete", "append", "create", "rename"}


def make_raw(
    subject: str,
    sender: str = "Brambleworks Careers <careers@brambleworks.example>",
    body: str = "Thank you for applying.",
    *,
    message_id: str | None = None,
    bulk: bool = False,
    extra_headers: str = "",
) -> bytes:
    head = f"From: {sender}\r\nSubject: {subject}\r\n"
    if message_id:
        head += f"Message-ID: <{message_id}>\r\n"
    if bulk:
        head += "List-Unsubscribe: <mailto:unsubscribe@news.example>\r\n"
    head += extra_headers
    head += "Content-Type: text/plain; charset=utf-8\r\n\r\n"
    return (head + body + "\r\n").encode()


@dataclass
class FakeMsg:
    uid: int
    raw: bytes
    internaldate: datetime
    email_id: str = ""


@dataclass
class FakeFolder:
    name: str
    flags: tuple[str, ...] = ()
    uidvalidity: int = 1
    msgs: list[FakeMsg] = field(default_factory=list)
    next_uid: int = 1

    def add(self, raw: bytes, when: datetime, email_id: str = "") -> FakeMsg:
        msg = FakeMsg(self.next_uid, raw, when, email_id)
        self.next_uid += 7  # UIDs ascend but are not contiguous
        self.msgs.append(msg)
        return msg

    def remove(self, uid: int) -> FakeMsg:
        msg = next(m for m in self.msgs if m.uid == uid)
        self.msgs.remove(msg)
        return msg


class FakeIMAP:
    def __init__(
        self,
        folders: list[FakeFolder],
        capabilities: tuple[str, ...] = (
            "IMAP4rev1",
            "SPECIAL-USE",
            "OBJECTID",
            "MESSAGELIMIT=1000",
        ),
    ) -> None:
        self.folders = {f.name: f for f in folders}
        self.capabilities = capabilities
        self.current: FakeFolder | None = None
        self.last_tagged = b""
        self.commands: list[tuple[str, str]] = []  # (command, detail)
        self.readonly_selects: list[bool] = []
        self.untagged: dict[str, list[bytes]] = {}
        # Misbehaviour switches
        self.search_all_cap: int | None = None  # silently return only newest N
        self.search_all_code = False  # add a [MESSAGELIMIT] code to SEARCH ALL
        self.search_pages_cap: int | None = None  # truncate paged searches too
        self.drop_once: set[int] = set()  # omit from next header fetch, still exists
        self.delete_on_fetch: set[int] = set()  # vanish when fetched
        self.fail_on: tuple[str, int] | None = None  # (command, nth) → fail
        self.fail_mode = "limit"  # limit | abort | oserror
        self._counts: dict[str, int] = {}

    # -- connection -------------------------------------------------------- #
    def connect(self, host, port):
        return self

    def login(self, user, password):
        return "OK", [b"LOGIN completed"]

    def logout(self):
        return "BYE", [b""]

    def capability(self):
        self._tick("capability")
        return "OK", [" ".join(self.capabilities).encode()]

    def response(self, code):
        return code, self.untagged.pop(code, [None])

    def __getattr__(self, name):
        if name.lower() in MUTATING:
            raise AssertionError(f"mailbox-changing command issued: {name}")
        raise AttributeError(name)

    def _tick(self, command: str) -> None:
        n = self._counts[command] = self._counts.get(command, 0) + 1
        if self.fail_on and self.fail_on == (command, n):
            if self.fail_mode == "abort":
                raise imaplib.IMAP4.abort("socket error: EOF")
            if self.fail_mode == "oserror":
                raise TimeoutError("timed out")
            raise imaplib.IMAP4.error("NO [LIMIT] Rate limit hit")

    # -- mailbox ----------------------------------------------------------- #
    def list(self, directory='""', pattern="*"):
        self._tick("list")
        rows = []
        for f in self.folders.values():
            flags = " ".join(("\\HasNoChildren", *f.flags))
            rows.append(f'({flags}) "/" "{f.name}"'.encode())
        return "OK", rows

    def select(self, mailbox="INBOX", readonly=False):
        self._tick("select")
        self.readonly_selects.append(readonly)
        if not readonly:
            raise AssertionError("mailbox selected read-write")
        name = mailbox.strip('"')
        self.current = self.folders[name]
        self.untagged["UIDVALIDITY"] = [str(self.current.uidvalidity).encode()]
        self.untagged["UIDNEXT"] = [str(self.current.next_uid).encode()]
        self.last_tagged = b"[READ-ONLY] EXAMINE completed"
        return "OK", [str(len(self.current.msgs)).encode()]

    def uid(self, command, *args):
        command = command.lower()
        if command in MUTATING:
            raise AssertionError(f"mailbox-changing command issued: {command}")
        self._tick(command)
        if command == "fetch" and "HEADER.FIELDS" in str(args[-1]):
            self._tick("fetch_headers")  # lets tests target header batches
        detail = " ".join(str(a) for a in args if a is not None)
        self.commands.append((command, detail))
        if command == "search":
            return self._search(args)
        if command == "fetch":
            return self._fetch(*args)
        raise AssertionError(f"unexpected UID command {command}")

    # -- SEARCH ------------------------------------------------------------ #
    def _search(self, args):
        crit = [a for a in args if a is not None]
        msgs = self.current.msgs
        self.last_tagged = b"UID SEARCH completed"
        if crit == ["ALL"]:
            uids = [m.uid for m in msgs]
            if self.search_all_cap is not None:
                uids = uids[-self.search_all_cap :]  # newest N, plain OK
            if self.search_all_code:
                self.last_tagged = b"[MESSAGELIMIT 1000 23221] UID SEARCH completed"
        elif crit[0] == "UID":
            wanted = {int(x) for x in crit[1].split(",")}
            uids = [m.uid for m in msgs if m.uid in wanted]
        elif re.fullmatch(r"\d+:\d+", crit[0]):
            a, b = (int(x) for x in crit[0].split(":"))
            uids = [m.uid for m in msgs[a - 1 : b]]
            if self.search_pages_cap is not None:
                uids = uids[: self.search_pages_cap]
        else:
            raise AssertionError(f"date or other search used: {crit}")
        return "OK", [" ".join(str(u) for u in uids).encode()]

    # -- FETCH ------------------------------------------------------------- #
    def _fetch(self, uidset: str, items: str):
        if re.search(r"BODY\[", items) or re.search(r"\bRFC822(?![.\w])", items):
            raise AssertionError(f"non-PEEK fetch would mark mail read: {items}")
        wanted = [int(x) for x in uidset.split(",")]
        out: list = []
        for seq, m in enumerate(self.current.msgs, 1):
            if m.uid not in wanted:
                continue
            if m.uid in self.drop_once and "HEADER.FIELDS" in items:
                self.drop_once.discard(m.uid)
                continue
            if m.uid in self.delete_on_fetch:
                continue
            attrs = [f"UID {m.uid}"]
            if "INTERNALDATE" in items:
                attrs.append(
                    f'INTERNALDATE "{m.internaldate.strftime("%d-%b-%Y %H:%M:%S %z")}"'
                )
            if "RFC822.SIZE" in items:
                attrs.append(f"RFC822.SIZE {len(m.raw)}")
            if "EMAILID" in items and m.email_id:
                attrs.append(f"EMAILID ({m.email_id})")
            literal = None
            if "HEADER.FIELDS" in items:
                literal = m.raw.split(b"\r\n\r\n", 1)[0] + b"\r\n\r\n"
                attrs.append(f"BODY[HEADER.FIELDS (FROM SUBJECT)] {{{len(literal)}}}")
            elif "BODY.PEEK[]" in items:
                literal = m.raw
                attrs.append(f"BODY[] {{{len(literal)}}}")
            meta = f"{seq} (" + " ".join(attrs)
            if literal is None:
                out.append((meta + ")").encode())
            else:
                out.append((meta.encode(), literal))
                out.append(b")")
        # Deleted-on-fetch messages are gone afterwards.
        for uid in list(self.delete_on_fetch):
            if uid in wanted:
                self.current.remove(uid)
                self.delete_on_fetch.discard(uid)
        self.last_tagged = b"UID FETCH completed"
        return "OK", out


NOW = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


def days_ago(n: float) -> datetime:
    return NOW - timedelta(days=n)
