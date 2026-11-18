"""Phase 6 labeling export: headers-only sync, seeded selection, resumable
body fetch. Fake IMAP server, fictional mail, temporary files only."""

import csv
import json
import random

import pytest

from app.services import email_sync
from app.services.email_sync import MessageRef, SyncOptions, fetch_refs, sync_blocking
from evals import email_label_export as lx
from evals.email_export import LIKELY_JOB, SAMPLE_OTHER
from tests.fake_imap import NOW, FakeFolder, FakeIMAP, days_ago, make_raw

JOBS = [{"id": "s-1", "company": "Brambleworks", "title": "Full Stack Developer"}]
BOX = lx.Mailbox("imap.example", 993, "me@example.com", "pw")


@pytest.fixture
def patch_connect(monkeypatch):
    def install(server):
        monkeypatch.setattr(email_sync, "_connect", server.connect)
        return server

    return install


@pytest.fixture(autouse=True)
def _fixed_now_and_tmp_ok(monkeypatch):
    # Pin "now" so the 45-day window is stable, and allow tmp paths (the real
    # script refuses anything git would track).
    real = SyncOptions.__init__

    def init(self, *a, **kw):
        kw.setdefault("now", NOW)
        real(self, *a, **kw)

    monkeypatch.setattr(SyncOptions, "__init__", init)
    monkeypatch.setattr(lx, "ensure_git_ignored", lambda *p: None)


def _mailbox(n_job=12, n_personal=6, n_bulk=30, n_spam=10):
    inbox = FakeFolder("INBOX", uidvalidity=100)
    for i in range(n_job):
        inbox.add(
            make_raw(f"Application received #{i}", body=f"Thanks for applying {i}."),
            days_ago(1 + i % 20),
            email_id=f"J{i}",
        )
    for i in range(n_personal):
        inbox.add(
            make_raw(
                f"Lunch {i}", sender="Maren Holt <maren@mailhost.example>", body="Hi!"
            ),
            days_ago(2),
        )
    for i in range(n_bulk):
        inbox.add(
            make_raw(
                f"Deals {i}",
                sender="Ferncastle <deals@ferncastle.example>",
                body="Sale.",
                bulk=True,
            ),
            days_ago(3),
        )
    spam = FakeFolder("Bulk", flags=("\\Junk",), uidvalidity=200)
    for i in range(n_spam):
        spam.add(
            make_raw(
                f"Win {i}", sender="Prize <win@prize.example>", body="Click", bulk=True
            ),
            days_ago(4),
        )
    spam.add(
        make_raw("Interview invitation", body="Schedule an interview."), days_ago(5)
    )
    return FakeIMAP([inbox, spam])


def _body_fetches(server):
    return [d for c, d in server.commands if c == "fetch" and "BODY.PEEK[]" in d]


def _rows(path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


class TestMimeShape:
    def test_plain_alternative_and_attachment(self):
        assert lx.mime_shape(make_raw("x")) == "text/plain"
        alt = (
            b"Content-Type: multipart/alternative; boundary=b\r\n\r\n"
            b"--b\r\nContent-Type: text/plain\r\n\r\nhi\r\n"
            b"--b\r\nContent-Type: text/html\r\n\r\n<p>hi</p>\r\n--b--\r\n"
        )
        assert lx.mime_shape(alt) == "multipart/alternative(text/plain,text/html)"
        mixed = (
            b"Content-Type: multipart/mixed; boundary=m\r\n\r\n"
            b"--m\r\nContent-Type: text/html\r\n\r\n<p>hi</p>\r\n"
            b"--m\r\nContent-Type: application/pdf\r\n\r\nJVBERi0=\r\n--m--\r\n"
        )
        assert lx.mime_shape(mixed) == "multipart/mixed(text/html,application/pdf)"


class TestHeadersOnlySync:
    def test_records_every_email_and_downloads_no_bodies(self, patch_connect):
        server = patch_connect(_mailbox())
        res = sync_blocking(
            "h", 993, "a", "p", {}, SyncOptions(headers_only=True, time_budget_s=None)
        )
        assert _body_fetches(server) == []
        assert res.messages == [] and res.sampled_other == []
        assert len(res.refs) == 12 + 6 + 30 + 11
        assert {r.role for r in res.refs} == {"inbox", "junk"}
        kept = [r for r in res.refs if r.kept]
        assert len(kept) == 12 + 6 + 1 and all(r.reason for r in res.refs)
        assert sum(rep.kept for rep in res.reports) == len(kept)

    def test_fetch_refs_reports_each_and_flags_a_rebuilt_folder(self, patch_connect):
        server = patch_connect(_mailbox(n_job=3, n_personal=0, n_bulk=0, n_spam=0))
        uids = [m.uid for m in server.folders["INBOX"].msgs]
        refs = [MessageRef("INBOX", "inbox", 100, u, kept=True) for u in uids]
        refs.append(MessageRef("INBOX", "inbox", 99, 5, kept=True))  # old UIDVALIDITY
        refs.append(MessageRef("INBOX", "inbox", 100, 99999, kept=True))  # gone
        seen = []
        fetch_refs(
            "h",
            993,
            "a",
            "p",
            refs,
            lambda r, raw, why: seen.append((r.uid, raw is not None, why)),
        )
        assert sorted(seen) == sorted(
            [(u, True, "") for u in uids]
            + [(5, False, "uidvalidity_changed"), (99999, False, "vanished")]
        )


class TestSelection:
    def _refs(self):
        refs = []
        for i in range(500):
            refs.append(
                MessageRef("INBOX", "inbox", 1, i, reason="job_words", kept=True)
            )
        for i in range(500, 510):
            refs.append(
                MessageRef("INBOX", "inbox", 1, i, reason="platform", kept=True)
            )
        for i in range(600, 1600):
            refs.append(MessageRef("Bulk", "junk", 2, i, reason="bulk", kept=False))
        return refs

    def test_seeded_sizes_and_every_reason_represented(self):
        picks = lx.select_rows(self._refs(), seed=7)
        groups = [g for _, g in picks]
        assert groups.count(LIKELY_JOB) == 350 and groups.count(SAMPLE_OTHER) == 150
        keys = {k for k, _ in picks}
        assert len(keys) == 500
        platform = {f"INBOX|1|{i}" for i in range(500, 510)}
        assert platform <= keys  # the rare reason is fully represented (floor)

    def test_same_seed_same_rows_regardless_of_order(self):
        refs = self._refs()
        shuffled = refs[:]
        random.Random(1).shuffle(shuffled)
        assert lx.select_rows(refs, 7) == lx.select_rows(shuffled, 7)
        assert lx.select_rows(refs, 7) != lx.select_rows(refs, 8)

    def test_small_mailbox_takes_everything(self):
        refs = self._refs()[:20] + self._refs()[-5:]
        picks = lx.select_rows(refs, 7)
        assert len(picks) == 25


class TestRunExport:
    def test_end_to_end_counts_and_only_selected_bodies(self, patch_connect, tmp_path):
        server = patch_connect(_mailbox())
        out = tmp_path / "labels.csv"
        s = lx.run_export(
            BOX,
            JOBS,
            frozenset({"brambleworks"}),
            out,
            n_likely=10,
            n_other=8,
            log=lambda m: None,
        )
        rows = _rows(out)
        assert len(rows) == 18 == s["rows_written"]
        assert sum(r["group"] == LIKELY_JOB for r in rows) == 10
        assert sum(len(d.split()[0].split(",")) for d in _body_fetches(server)) == 18
        assert set(s["mailbox_by_folder"]) == {
            "inbox/kept",
            "inbox/dropped",
            "junk/kept",
            "junk/dropped",
        }
        assert sum(s["rows_by_mime_shape"].values()) == 18
        assert all(r["role"] in ("inbox", "junk") and r["text"] for r in rows)
        summary = json.loads((tmp_path / "labels.summary.json").read_text())
        assert summary["rows_written"] == 18

    def test_finishes_across_dropped_connections(self, patch_connect, tmp_path):
        server = patch_connect(_mailbox())
        server.fail_on, server.fail_mode = ("fetch_headers", 2), "abort"
        drops = iter([("fetch", 30), ("fetch", 45)])

        def sleep(_):  # each retry, arm the next drop (header retry or bodies)
            nxt = next(drops, None)
            if nxt:
                n = server._counts.get(nxt[0], 0)
                server.fail_on = (nxt[0], n + (3 if nxt[1] == 30 else 2))

        out = tmp_path / "labels.csv"
        s = lx.run_export(
            BOX,
            JOBS,
            frozenset(),
            out,
            n_likely=12,
            n_other=10,
            sleep=sleep,
            log=lambda m: None,
        )
        assert s["retries"] == 3 and s["interruptions"] == {"connection_lost": 3}
        rows = _rows(out)
        assert len(rows) == 22
        assert len({(r["folder"], r["uid"]) for r in rows}) == 22  # no duplicates

    def test_resumes_after_a_crash_without_repeating_rows(
        self, patch_connect, tmp_path
    ):
        server = patch_connect(_mailbox())
        out = tmp_path / "labels.csv"

        class Crash(Exception):
            pass

        def crash(_):
            raise Crash

        # Let the header phase finish, then drop during bodies and "crash".
        state_path = lx.state_path_for(out)
        server.fail_mode = "abort"
        orig = email_sync.fetch_refs

        def flaky(*a, **kw):
            n = server._counts.get("fetch", 0)
            server.fail_on = ("fetch", n + 2)  # second body batch drops
            return orig(*a, **kw)

        email_sync.fetch_refs = flaky  # restored in finally
        try:
            with pytest.raises(Crash):
                lx.run_export(
                    BOX,
                    JOBS,
                    frozenset(),
                    out,
                    n_likely=15,
                    n_other=10,
                    sleep=crash,
                    log=lambda m: None,
                )
        finally:
            email_sync.fetch_refs = orig
        partial = _rows(out)
        assert 0 < len(partial) < 25
        state = lx.ExportState.load(state_path)
        assert state.headers_done and len(state.selection) == 25
        # Simulate a half-written last line from the crash.
        with out.open("a", encoding="utf-8") as f:
            f.write('abc123,likely_job,"INBOX')
        server.fail_on = None
        s = lx.run_export(
            BOX, JOBS, frozenset(), out, n_likely=15, n_other=10, log=lambda m: None
        )
        rows = _rows(out)
        assert len(rows) == 25 == s["rows_written"]
        assert len({(r["folder"], r["uid"]) for r in rows}) == 25
        assert [r["id"] for r in rows[: len(partial)]] == [r["id"] for r in partial]

    def test_refuses_to_resume_with_other_settings(self, patch_connect, tmp_path):
        patch_connect(_mailbox())
        out = tmp_path / "labels.csv"
        lx.run_export(
            BOX, JOBS, frozenset(), out, n_likely=5, n_other=5, log=lambda m: None
        )
        with pytest.raises(lx.ExportFailed):
            lx.run_export(
                BOX, JOBS, frozenset(), out, n_likely=6, n_other=5, log=lambda m: None
            )

    def test_gives_up_after_max_retries(self, patch_connect, tmp_path):
        server = patch_connect(_mailbox())
        server.fail_mode = "abort"

        def sleep(_):
            server.fail_on = ("select", server._counts.get("select", 0) + 1)

        server.fail_on = ("select", 1)
        with pytest.raises(lx.ExportFailed):
            lx.run_export(
                BOX,
                JOBS,
                frozenset(),
                tmp_path / "l.csv",
                max_retries=2,
                sleep=sleep,
                log=lambda m: None,
            )


def test_rebuild_rereads_the_same_rows(patch_connect, tmp_path):
    server = patch_connect(_mailbox())
    out = tmp_path / "labels.csv"
    kw = {"n_likely": 6, "n_other": 4, "log": lambda m: None}
    lx.run_export(BOX, JOBS, frozenset(), out, **kw)
    first = [r["id"] for r in _rows(out)]
    # New mail arrives; a rebuild must not change which rows are in the sheet.
    server.folders["INBOX"].add(_mailbox().folders["INBOX"].msgs[0].raw, days_ago(0))
    s = lx.run_export(BOX, JOBS, frozenset(), out, rebuild=True, **kw)
    assert sorted(r["id"] for r in _rows(out)) == sorted(first)
    assert s["rows_written"] == 10


def test_rebuild_needs_a_selection(tmp_path):
    with pytest.raises(lx.ExportFailed):
        lx.run_export(
            BOX, JOBS, frozenset(), tmp_path / "x.csv", rebuild=True, log=lambda m: None
        )
