"""Known email-pipeline bugs, pinned as strict expected failures.

Each test asserts the CORRECT behavior and is marked ``xfail(strict=True)``:
today it fails (CI stays green); once a fix lands it passes, strict mode turns
that into a failure, and the fix must delete the marker. All data is fictional.
"""

import pytest

from app.models.detected_event import DetectedEvent
from app.services import email_sync
from app.services.email_classify import (
    INTERVIEW,
    REJECTED,
    UNKNOWN,
    classify_email,
    company_from_sender,
    stage_for_event,
)
from app.services.email_imap import _parse_message
from app.services.email_match import match_job
from app.services.email_scan import EmailMessage
from app.services.email_sync import SyncOptions
from evals.email_pipeline import predict_message
from tests.fake_imap import NOW, FakeFolder, FakeIMAP, days_ago, make_raw


def known_bug(reason: str):
    return pytest.mark.xfail(strict=True, reason=f"known bug: {reason}")


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #
class TestClassification:
    def test_move_forward_with_your_application_is_good_news(self):
        assert (
            classify_email(
                "Update on your Brambleworks application",
                "We have decided to move forward with your application and would "
                "like to schedule an interview next week.",
                "priya.okafor@brambleworks.example",
            )
            == INTERVIEW
        )

    def test_unfortunately_in_sales_mail_is_unknown(self):
        assert (
            classify_email(
                "Last chance: 30% off ends tonight",
                "Unfortunately, our autumn sale ends at midnight. Shop now.",
                "deals@ferncastle.example",
            )
            == UNKNOWN
        )

    def test_unfortunately_while_rescheduling_is_interview(self):
        assert (
            classify_email(
                "Rescheduling our interview",
                "Unfortunately, I need to move our interview on Tuesday. Would "
                "Thursday at 2pm work instead?",
                "marcus.hartwell@tidelock.example",
            )
            == INTERVIEW
        )

    @pytest.mark.parametrize(
        "body",
        [
            "After careful review, we are moving forward with other applicants.",
            "After a lot of thought, we have chosen another candidate.",
            "We've determined your background is not a fit for the role.",
            "The Data Analyst position has been closed.",
        ],
        ids=["other-applicants", "another-candidate", "not-a-fit", "closed"],
    )
    def test_missed_rejection_phrases(self, body):
        assert (
            classify_email("Your application", body, "elena.moreau@orbweaver.example")
            == REJECTED
        )

    def test_newsletter_interview_is_unknown(self):
        assert (
            classify_email(
                "This week: an interview with the CTO of Glimmerforge",
                "In this issue: our interview with a CTO on scaling teams. "
                "Unsubscribe | Manage preferences",
                "newsletter@buildlog.example",
            )
            == UNKNOWN
        )

    def test_offer_event(self):
        assert (
            classify_email(
                "Offer of employment - Python Developer",
                "We are delighted to offer you the Python Developer position. "
                "Your offer letter is attached.",
                "noor.sato@pebblestone.example",
            )
            == "offer"
        )
        assert stage_for_event("offer") == "Offer"

    def test_assessment_event(self):
        assert (
            classify_email(
                "Next step: take-home assignment",
                "The next step is a short take-home assignment. Please complete "
                "it within five days.",
                "aiko.lindqvist@lumenhollow.example",
            )
            == "assessment"
        )
        assert stage_for_event("assessment") == "Take-Home Assignment"


# --------------------------------------------------------------------------- #
# Matching (through the scorecard's pipeline adapter)
# --------------------------------------------------------------------------- #
JOBS = [
    {"id": "J01", "company": "Quillfeather Labs", "title": "Backend Engineer"},
    {"id": "J02", "company": "Quillfeather Labs", "title": "Frontend Engineer"},
    {"id": "J06", "company": "The Copper Kettle Group", "title": "Software Engineer"},
    {"id": "J08", "company": "Orbweaver Analytics", "title": "Data Analyst"},
    {"id": "J12", "company": "Lumenhollow", "title": "QA Automation Engineer"},
]


def _job(from_addr: str, subject: str, body: str = "") -> str | None:
    msg = EmailMessage(uid="1", from_addr=from_addr, subject=subject, body=body)
    return predict_message(msg, JOBS).job_id


class TestMatching:
    def test_company_in_body_matches(self):
        assert (
            _job(
                "no-reply@us.greenhouse-mail.io",
                "Thank you for applying",
                "Thanks for your interest in Orbweaver Analytics! We received your "
                "application for Data Analyst.",
            )
            == "J08"
        )

    def test_company_in_display_name_matches(self):
        assert (
            _job(
                "Orbweaver Analytics <no-reply@us.greenhouse-mail.io>",
                "Thank you for applying",
            )
            == "J08"
        )

    def test_shared_common_word_is_not_a_match(self):
        assert (
            _job(
                "updates@yarrowby.example",
                "Thanks for applying to the role",
            )
            is None
        )

    def test_unique_title_alone_asks_for_review(self):
        """Was: a matching title alone produced nothing. A title with no company
        is now offered for review (never an automatic match)."""
        msg = EmailMessage(
            uid="1",
            from_addr="indeedapply@indeedemail.com",
            subject="Indeed Application: QA Automation Engineer",
            body="",
        )
        m = match_job(JOBS, subject=msg.subject, from_addr=msg.from_addr)
        assert m.status == "review" and m.evidence == "title_only"
        assert [c["id"] for c in m.candidates] == ["J12"]
        assert predict_message(msg, JOBS).job_id is None  # no card move

    def test_picks_the_named_role_at_a_multi_role_company(self):
        assert (
            _job(
                "careers@quillfeather.example",
                "Application received: Frontend Engineer",
            )
            == "J02"
        )

    @pytest.mark.parametrize(
        "addr",
        [
            "no-reply@us.greenhouse-mail.io",
            "no-reply@myworkdayjobs.com",
            "indeedapply@indeedemail.com",
            "noreply@workablemail.com",
            "no-reply@taleo.net",
        ],
    )
    def test_platform_sender_is_not_a_company(self, addr):
        assert company_from_sender(addr) == ""


# --------------------------------------------------------------------------- #
# Reading messages
# --------------------------------------------------------------------------- #
_HTML_ONLY = (
    b"From: Lumenhollow Careers <no-reply@lumenhollow.example>\r\n"
    b"Subject: Your application\r\n"
    b'Content-Type: multipart/mixed; boundary="M"\r\n'
    b"\r\n"
    b"--M\r\n"
    b"Content-Type: text/html; charset=utf-8\r\n"
    b"\r\n"
    b"<html><body><p>We regret to inform you we won&#8217;t be moving "
    b"forward.</p></body></html>\r\n"
    b"--M\r\n"
    b"Content-Type: application/pdf\r\n"
    b'Content-Disposition: attachment; filename="a.pdf"\r\n'
    b"Content-Transfer-Encoding: base64\r\n"
    b"\r\n"
    b"JVBERi0xLjQK\r\n"
    b"--M--\r\n"
)


def _bad_charset() -> bytes:
    return (
        b"From: talent@saltmarsh.example\r\n"
        b"Subject: Application update\r\n"
        b'Content-Type: text/plain; charset="x-unknown"\r\n'
        b"\r\n"
        b"We regret to inform you the position has been filled.\r\n"
    )


def _plain(subject: str) -> bytes:
    return (
        f"From: careers@brambleworks.example\r\nSubject: {subject}\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n\r\nThanks for applying.\r\n"
    ).encode()


class TestReading:
    def test_html_only_multipart_has_text_body(self):
        msg = _parse_message("1", _HTML_ONLY)
        assert "regret to inform you" in msg.body
        assert "<p>" not in msg.body

    def test_unknown_charset_falls_back(self):
        msg = _parse_message("1", _bad_charset())
        assert "position has been filled" in msg.body


# --------------------------------------------------------------------------- #
# Fetching — the sync engine against a fake IMAP server, no network
# --------------------------------------------------------------------------- #
def _sync(monkeypatch, server, cursors=None, **opts):
    monkeypatch.setattr(email_sync, "_connect", server.connect)
    options = {"now": NOW, "time_budget_s": None, "junk_share": 0, "recheck_days": 0}
    options.update(opts)
    return email_sync.sync_blocking(
        "imap.example",
        993,
        "me@example.com",
        "pw",
        cursors or {},
        SyncOptions(**options),
    )


def _folder(name, subjects, flags=()):
    f = FakeFolder(name, flags=flags)
    for subj in subjects:
        f.add(make_raw(subj), days_ago(1))
    return f


class TestFetching:
    def test_fetch_is_read_only(self, monkeypatch):
        """Guard: never select read-write, never fetch without PEEK, never
        modify mail (FakeIMAP fails the test on any of these)."""
        server = FakeIMAP(
            [
                _folder("INBOX", ["Application received"]),
                _folder("Bulk", ["Hi"], ("\\Junk",)),
            ]
        )
        _sync(monkeypatch, server)
        assert server.readonly_selects and all(server.readonly_selects)

    def test_scans_the_junk_folder(self, monkeypatch):
        server = FakeIMAP(
            [
                _folder("INBOX", ["Newsletter"]),
                _folder("Bulk", ["Thanks for applying"], ("\\Junk",)),
            ]
        )
        subjects = {m.subject for m in _sync(monkeypatch, server).messages}
        assert "Thanks for applying" in subjects

    def test_does_not_silently_drop_past_the_cap(self, monkeypatch):
        server = FakeIMAP([_folder("INBOX", [f"Application {i}" for i in range(300)])])
        first = _sync(monkeypatch, server, body_cap=250)
        assert len(first.messages) == 250 and first.carried_over == 50
        second = _sync(monkeypatch, server, first.cursors, body_cap=250)
        got = {m.uid for m in first.messages} | {m.uid for m in second.messages}
        assert len(got) == 300 and second.carried_over == 0

    def test_one_bad_message_does_not_fail_the_scan(self, monkeypatch):
        inbox = FakeFolder("INBOX")
        inbox.add(make_raw("Application ok 1"), days_ago(1))
        inbox.add(_bad_charset(), days_ago(1))
        inbox.add(make_raw("Application ok 2"), days_ago(1))
        subjects = {m.subject for m in _sync(monkeypatch, FakeIMAP([inbox])).messages}
        assert {"Application ok 1", "Application ok 2"} <= subjects


class TestDuplicateKey:
    def test_dedupe_key_includes_folder_and_uidvalidity(self):
        (uq,) = [
            c
            for c in DetectedEvent.__table__.constraints
            if c.name == "uq_detected_event_location"
        ]
        cols = {c.name for c in uq.columns}
        assert {"email_account_id", "message_uid"} <= cols
        assert {"folder", "uidvalidity"} <= cols
