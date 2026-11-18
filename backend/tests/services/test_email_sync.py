"""Sync-engine tests against a fake IMAP server — no network, fictional mail."""

import pytest

from app.services import email_sync
from app.services.email_sync import (
    CONNECTION_LOST,
    RATE_LIMITED,
    TIME_BUDGET,
    FolderCursor,
    SyncOptions,
    sync_blocking,
)
from tests.fake_imap import NOW, FakeFolder, FakeIMAP, days_ago, make_raw


def _job(i: int) -> bytes:
    return make_raw(f"Application received #{i}", message_id=f"job{i}@x.example")


def _bulk(i: int) -> bytes:
    return make_raw(
        f"Weekly deals {i}",
        sender="Ferncastle <deals@ferncastle.example>",
        body="Sale ends tonight.",
        bulk=True,
    )


def _run(server, cursors=None, **opts):
    defaults = {"now": NOW, "time_budget_s": None, "junk_share": 0}
    defaults.update(opts)
    return sync_blocking(
        "imap.example",
        993,
        "me@example.com",
        "pw",
        cursors or {},
        SyncOptions(**defaults),
    )


@pytest.fixture
def patch_connect(monkeypatch):
    def install(server):
        monkeypatch.setattr(email_sync, "_connect", server.connect)
        return server

    return install


def _inbox(n_jobs=0, n_bulk=0, age=1.0) -> FakeFolder:
    f = FakeFolder("INBOX", uidvalidity=100)
    for i in range(n_jobs):
        f.add(_job(i), days_ago(age), email_id=f"E{i}")
    for i in range(n_bulk):
        f.add(_bulk(i), days_ago(age))
    return f


class TestFolders:
    def test_scans_inbox_and_the_junk_folder_by_flag(self, patch_connect):
        inbox = _inbox(n_jobs=1)
        spam = FakeFolder("Bulk Mail", flags=("\\Junk",), uidvalidity=7)
        spam.add(make_raw("Interview invitation"), days_ago(1))
        patch_connect(FakeIMAP([inbox, spam]))
        result = _run(None)
        assert {m.folder for m in result.messages} == {"INBOX", "Bulk Mail"}
        assert {r.folder_role for r in result.reports} == {"inbox", "junk"}
        spam_msg = next(m for m in result.messages if m.folder == "Bulk Mail")
        assert spam_msg.uidvalidity == 7

    def test_junk_found_by_name_when_no_flag(self, patch_connect):
        spam = FakeFolder("Spam")
        spam.add(make_raw("Interview invitation"), days_ago(1))
        patch_connect(FakeIMAP([_inbox(), spam, FakeFolder("Receipts")]))
        result = _run(None)
        assert [m.folder for m in result.messages] == ["Spam"]

    def test_personal_folders_are_not_scanned(self, patch_connect):
        other = FakeFolder("Family")
        other.add(make_raw("Interview invitation"), days_ago(1))
        server = patch_connect(FakeIMAP([_inbox(), other]))
        _run(None)
        assert all(c[0] != "fetch" or "Family" not in c[1] for c in server.commands)
        assert len(server.readonly_selects) == 1  # INBOX only


class TestReadOnlyAndHeadersFirst:
    def test_headers_first_bodies_only_for_possible_job_mail(self, patch_connect):
        server = patch_connect(FakeIMAP([_inbox(n_jobs=3, n_bulk=5)]))
        result = _run(server)
        (rep,) = result.reports
        assert rep.headers_read == 8
        assert rep.filtered_out == 5 and rep.kept == 3 and rep.bodies_fetched == 3
        assert len(result.messages) == 3
        bodies = [d for c, d in server.commands if c == "fetch" and "BODY.PEEK[]" in d]
        assert bodies and all("HEADER.FIELDS" not in d for d in bodies)
        # Read-only: every select was EXAMINE; FakeIMAP rejects any non-PEEK fetch.
        assert server.readonly_selects and all(server.readonly_selects)

    def test_never_uses_a_date_search(self, patch_connect):
        server = patch_connect(FakeIMAP([_inbox(n_jobs=2)]))
        _run(server)  # FakeIMAP raises on SINCE/BEFORE searches
        searches = [d for c, d in server.commands if c == "search"]
        assert searches and not any("SINCE" in d for d in searches)


class TestCursorAndWindow:
    def test_first_run_backfills_only_the_45_day_window(self, patch_connect):
        inbox = FakeFolder("INBOX", uidvalidity=5)
        inbox.add(make_raw("Old application update"), days_ago(60))
        inbox.add(make_raw("Application received A"), days_ago(30))
        inbox.add(make_raw("Application received B"), days_ago(1))
        patch_connect(FakeIMAP([inbox]))
        result = _run(None)
        assert sorted(m.subject for m in result.messages) == [
            "Application received A",
            "Application received B",
        ]
        cur = result.cursors["INBOX"]
        assert cur.uidvalidity == 5 and cur.last_uid == inbox.msgs[-1].uid
        assert cur.backfill_low <= cur.backfill_floor == inbox.msgs[1].uid
        assert result.reports[0].status == "complete"

    def test_next_run_reads_only_new_mail(self, patch_connect):
        inbox = _inbox(n_jobs=2)
        server = patch_connect(FakeIMAP([inbox]))
        first = _run(server, recheck_days=0)
        inbox.add(make_raw("Interview invitation"), days_ago(0))
        second = _run(server, first.cursors, recheck_days=0)
        assert [m.subject for m in second.messages] == ["Interview invitation"]
        assert second.reports[0].new == 1 and second.reports[0].headers_read == 1

    def test_recheck_window_rereads_recent_headers(self, patch_connect):
        inbox = _inbox(n_jobs=2, age=0.5)
        server = patch_connect(FakeIMAP([inbox]))
        first = _run(server)
        known = {("INBOX", 100, m.uid) for m in first.messages}
        second = _run(
            server,
            first.cursors,
            known_locations={(f, uv, str(uid)) for f, uv, uid in known},
        )
        rep = second.reports[0]
        assert rep.rechecked == 2 and rep.already_known == 2
        assert rep.bodies_fetched == 0 and second.messages == []

    def test_uidvalidity_change_resets_and_known_ids_skip_bodies(self, patch_connect):
        inbox = _inbox(n_jobs=3)
        server = patch_connect(FakeIMAP([inbox]))
        first = _run(server)
        # Server renumbers the folder: new UIDVALIDITY, new UIDs, same EMAILIDs.
        inbox.uidvalidity = 200
        for m in inbox.msgs:
            m.uid += 1000
        second = _run(server, first.cursors, known_email_ids={"E0", "E1", "E2"})
        rep = second.reports[0]
        assert rep.uidvalidity_changed
        assert second.cursors["INBOX"].uidvalidity == 200
        assert rep.already_known == 3 and rep.bodies_fetched == 0

    def test_view_limited_flag(self, patch_connect):
        patch_connect(FakeIMAP([_inbox(n_jobs=6)]))
        assert _run(None, view_ceiling=5).reports[0].view_limited


class TestCapAndCarryOver:
    def test_body_cap_carries_over_and_never_skips(self, patch_connect):
        server = patch_connect(FakeIMAP([_inbox(n_jobs=25, n_bulk=10)]))
        seen: list[int] = []
        cursors: dict[str, FolderCursor] = {}
        carried = []
        for _ in range(4):
            result = _run(server, cursors, body_cap=10, header_batch=4, recheck_days=0)
            cursors = result.cursors
            seen += [int(m.uid) for m in result.messages]
            carried.append(result.carried_over)
            assert sum(r.bodies_fetched for r in result.reports) <= 10
        assert len(seen) == len(set(seen)) == 25  # every job email, exactly once
        assert carried[0] > 0 and carried[-1] == 0
        assert result.reports[0].status == "complete"

    def test_cap_counts_bodies_not_headers(self, patch_connect):
        server = patch_connect(FakeIMAP([_inbox(n_jobs=2, n_bulk=40)]))
        result = _run(server, body_cap=2, recheck_days=0)
        rep = result.reports[0]
        assert rep.headers_read == 42 and rep.bodies_fetched == 2
        assert result.carried_over == 0

    def test_spam_gets_a_share_of_the_cap(self, patch_connect):
        inbox = _inbox(n_jobs=20)
        spam = FakeFolder("Bulk", flags=("\\Junk",))
        for i in range(5):
            spam.add(make_raw(f"Interview invitation {i}"), days_ago(1))
        patch_connect(FakeIMAP([inbox, spam]))
        result = _run(None, body_cap=10, junk_share=3, recheck_days=0)
        by_folder = {r.folder_role: r.bodies_fetched for r in result.reports}
        assert by_folder == {"inbox": 7, "junk": 3}

    def test_time_budget_stops_and_carries_over(self, patch_connect):
        server = patch_connect(FakeIMAP([_inbox(n_jobs=30)]))
        ticks = iter(range(10_000))
        result = _run(
            server,
            time_budget_s=3,
            clock=lambda: next(ticks),
            header_batch=5,
            recheck_days=0,
        )
        rep = result.reports[0]
        assert rep.stopped_by == TIME_BUDGET and rep.status == "carried_over"
        assert result.carried_over > 0 and result.interrupted is None
        assert len(result.messages) + result.carried_over == 30


class TestPartialResults:
    def test_silently_truncated_search_all_falls_back_to_pages(self, patch_connect):
        server = FakeIMAP([_inbox(n_jobs=8)])
        server.search_all_cap = 5  # plain OK, like Yahoo's capped searches
        patch_connect(server)
        result = _run(server)
        rep = result.reports[0]
        assert "search_all_incomplete" in rep.partial
        assert len(result.messages) == 8 and rep.status == "complete"

    def test_messagelimit_code_is_never_trusted(self, patch_connect):
        server = FakeIMAP([_inbox(n_jobs=3)])
        server.search_all_code = True
        patch_connect(server)
        result = _run(server)
        assert "search_all_incomplete" in result.reports[0].partial
        assert any(":" in d for c, d in server.commands if c == "search")

    def test_incomplete_listing_skips_folder_and_keeps_cursor(self, patch_connect):
        server = FakeIMAP([_inbox(n_jobs=8)])
        server.search_all_cap = 5
        server.search_pages_cap = 2
        patch_connect(server)
        cursors = {"INBOX": FolderCursor("INBOX", "inbox", 100, 3, 1, 1)}
        result = _run(server, cursors)
        rep = result.reports[0]
        assert rep.status == "partial" and "search_pages_incomplete" in rep.partial
        assert result.messages == []
        assert result.cursors["INBOX"] == cursors["INBOX"]

    def test_missing_fetch_result_carries_over(self, patch_connect):
        inbox = _inbox(n_jobs=4)
        server = FakeIMAP([inbox])
        server.drop_once = {inbox.msgs[1].uid}  # still exists, just not returned
        patch_connect(server)
        first = _run(server, header_batch=10, recheck_days=0)
        assert "headers_missing" in first.reports[0].partial
        assert first.reports[0].status == "partial" and first.messages == []
        second = _run(server, first.cursors, header_batch=10, recheck_days=0)
        assert len(second.messages) == 4

    def test_vanished_message_is_counted_not_fatal(self, patch_connect):
        inbox = _inbox(n_jobs=3)
        server = FakeIMAP([inbox])
        server.delete_on_fetch = {inbox.msgs[0].uid}
        patch_connect(server)
        result = _run(server, recheck_days=0)
        assert result.reports[0].vanished == 1 and len(result.messages) == 2


class TestLimitsAndConnection:
    def test_rate_limit_keeps_completed_batches(self, patch_connect):
        server = FakeIMAP([_inbox(n_jobs=20)])
        server.fail_on = ("fetch_headers", 3)  # 3rd batch refused with [LIMIT]
        patch_connect(server)
        result = _run(server, header_batch=5, body_batch=5, recheck_days=0)
        assert result.interrupted == RATE_LIMITED
        assert result.reports[0].status == "interrupted"
        done = {int(m.uid) for m in result.messages}
        cur = result.cursors["INBOX"]
        # Cursor covers exactly what was returned; the rest carries over.
        covered = {
            m.uid for m in server.folders["INBOX"].msgs if m.uid >= cur.backfill_low
        }
        assert done == covered and len(done) == 10  # two batches of five

    def test_dropped_connection_is_interrupted(self, patch_connect):
        server = FakeIMAP([_inbox(n_jobs=3)])
        server.fail_on, server.fail_mode = ("fetch", 2), "abort"
        patch_connect(server)
        assert _run(server).interrupted == CONNECTION_LOST

    def test_socket_timeout_is_interrupted(self, patch_connect):
        server = FakeIMAP([_inbox(n_jobs=3)])
        server.fail_on, server.fail_mode = ("search", 1), "oserror"
        patch_connect(server)
        assert _run(server).interrupted == CONNECTION_LOST

    def test_one_connection_folders_in_sequence(self, patch_connect, monkeypatch):
        server = FakeIMAP([_inbox(n_jobs=1), FakeFolder("Bulk", flags=("\\Junk",))])
        calls = []

        def connect(host, port):
            calls.append(1)
            return server

        monkeypatch.setattr(email_sync, "_connect", connect)
        _run(server)
        assert len(calls) == 1 and len(server.readonly_selects) == 2


class TestMisc:
    def test_oversize_message_is_read_from_headers_only(self, patch_connect):
        server = patch_connect(FakeIMAP([_inbox(n_jobs=1)]))
        result = _run(server, max_body_bytes=10)
        rep = result.reports[0]
        assert rep.oversize == 1 and rep.bodies_fetched == 0
        assert "oversize" in result.messages[0].read_issues

    def test_export_sample_of_filtered_mail(self, patch_connect):
        server = patch_connect(FakeIMAP([_inbox(n_jobs=1, n_bulk=6)]))
        result = _run(server, body_cap=None, sample_filtered=2, seed=3)
        assert len(result.sampled_other) == 2
        assert all(m.body == "Sale ends tonight." for m, _ in result.sampled_other)
        again = _run(server, body_cap=None, sample_filtered=2, seed=3)
        assert [m.uid for m, _ in again.sampled_other] == [
            m.uid for m, _ in result.sampled_other
        ]
