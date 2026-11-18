"""Important updates about jobs the user hasn't saved, and recruiter messages.

All synthetic. Interviews, assessments, offers and rejections for jobs that
aren't saved are kept ("Not in your saved jobs") and never move a card;
recruiter messages are kept as contacts; job alerts, digests and reminders
still aren't kept.
"""

import pytest

from app.api.v1.email import category_of
from app.services.email_job_names import company_name, job_names, role_name
from app.services.email_scan import EmailMessage, detect_events
from tests.services.test_email_scan import _make_account, _make_saved_job


class TestJobNames:
    @pytest.mark.parametrize(
        "subject,sender,expected",
        [
            (
                "Your application to Brambleworks",
                "no-reply@ats.example",
                "Brambleworks",
            ),
            (
                "Interview with Tidelock Systems",
                "x@mailhost.example",
                "Tidelock Systems",
            ),
            ("Update", "Vellacor Careers <careers@vellacor.example>", "Vellacor"),
            (
                "Update",
                "Lumenhollow Hiring Team <jobs@lumenhollow.example>",
                "Lumenhollow",
            ),
            (
                "Update",
                "Orbweaver via Greenhouse <no-reply@greenhouse.io>",
                "Orbweaver",
            ),
            ("Update", "noreply@saltmarsh.example", "Saltmarsh"),
            # Cutting "Recruiting" from the sender name must not leave ".io".
            ("Update", "Recruiting.io <hello@quillworks.example>", "Quillworks"),
        ],
    )
    def test_company(self, subject, sender, expected):
        assert company_name(subject, sender) == expected

    def test_personal_name_is_never_a_company(self):
        assert company_name("Quick question", "Priya Okafor <priya@gmail.com>") is None

    @pytest.mark.parametrize(
        "subject,text,expected",
        [
            ("Interview: Platform Engineer", "", "Platform Engineer"),
            (
                "Update",
                "Thank you for your application for the Data Analyst position.",
                "Data Analyst",
            ),
            (
                "Update",
                "We appreciate your interest in the QA Automation Engineer role at "
                "Lumenhollow.",
                "QA Automation Engineer",
            ),
        ],
    )
    def test_role(self, subject, text, expected):
        assert role_name(subject, text) == expected

    def test_company_is_not_mistaken_for_a_role(self):
        company, role = job_names(
            "Your application to Brambleworks",
            "no-reply@ats.example",
            "Thank you for applying to Brambleworks. We'll be in touch.",
        )
        assert (company, role) == ("Brambleworks", None)


def _msg(uid, subject, body, sender="Vellacor Careers <careers@vellacor.example>"):
    return EmailMessage(
        uid=uid,
        from_addr=sender,
        subject=subject,
        body=body,
        newest_text=body,
        folder="INBOX",
        uidvalidity=1,
    )


@pytest.mark.asyncio
class TestScanKeepsUnsavedUpdates:
    async def _acct(self, db, user):
        await _make_saved_job(db, user, "Brambleworks", "Full Stack Developer")
        return await _make_account(db, user)

    @pytest.mark.parametrize(
        "kind,body",
        [
            ("interview", "We'd like to schedule an interview with you next week."),
            ("assessment", "Please complete the coding assessment within five days."),
            ("offer", "We are delighted to offer you the position."),
            (
                "rejected",
                "Unfortunately we will not be moving forward with your application.",
            ),
        ],
    )
    async def test_important_update_for_unsaved_job_is_kept(
        self, db_session, test_user, kind, body
    ):
        acct = await self._acct(db_session, test_user)
        r = await detect_events(
            db_session,
            acct,
            [_msg("1", "Your Data Engineer application at Vellacor", body)],
        )
        assert r.created == [] and r.review == []  # never a card move, never a question
        (u,) = r.unsaved
        assert u.event_type == kind and u.status == "unsaved"
        assert u.saved_job_id is None and category_of(u) == "unsaved"
        assert u.job_company == "Vellacor"

    async def test_reminder_for_unsaved_job_is_not_kept(self, db_session, test_user):
        acct = await self._acct(db_session, test_user)
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "2",
                    "Reminder: your interview tomorrow",
                    "This is a reminder of your interview tomorrow at 10am.",
                )
            ],
        )
        assert r.unsaved == [] and r.created == []

    async def test_job_alert_is_still_not_kept(self, db_session, test_user):
        acct = await self._acct(db_session, test_user)
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "3",
                    "Jobs recommended for you",
                    "Based on your profile: Data Engineer at Vellacor. Easy Apply.",
                    sender="Jobs <jobs-noreply@linkedin.com>",
                )
            ],
        )
        assert r.unsaved == r.created == r.contacts == r.hidden == []

    async def test_recruiter_message_is_kept_as_a_contact(self, db_session, test_user):
        acct = await self._acct(db_session, test_user)
        r = await detect_events(
            db_session,
            acct,
            [
                _msg(
                    "4",
                    "Opportunity at Vellacor",
                    "Hi! I'm a recruiter at Vellacor and came across your background. "
                    "Would you be open to a quick chat about a role on our team?",
                    sender="Maren Holt <maren@vellacor.example>",
                )
            ],
        )
        assert r.created == [] and r.unsaved == []
        (c,) = r.contacts
        assert c.status == "contact" and c.target_stage is None
        assert category_of(c) == "contact" and c.job_company == "Vellacor"

    async def test_rescan_does_not_repeat_kept_items(self, db_session, test_user):
        acct = await self._acct(db_session, test_user)
        msgs = [
            _msg(
                "5",
                "Your application to Vellacor",
                "Unfortunately we will not be moving forward with your application.",
            )
        ]
        first = await detect_events(db_session, acct, msgs)
        again = await detect_events(db_session, acct, msgs)
        assert len(first.unsaved) == 1 and again.unsaved == []
