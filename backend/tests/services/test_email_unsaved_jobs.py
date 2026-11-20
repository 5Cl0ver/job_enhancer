"""Important updates about jobs the user hasn't saved, and recruiter messages.

All synthetic. Interviews, assessments, offers and rejections for jobs that
aren't saved are kept ("Not in your saved jobs") and never move a card;
recruiter messages are kept as contacts; job alerts, digests and reminders
still aren't kept.
"""

import pytest

from app.api.v1.email import category_of
from app.services.email_job_names import (
    clean_role,
    company_name,
    is_sender_person,
    job_names,
    role_doubtful,
    role_name,
)
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


class TestNamesThatAreNotNames:
    """The first real email-made job had a sentence for a title and the
    recruiter's own name for the company. Invented names, same shapes."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            (
                "next phase of our recruitment process in the Productivity "
                "Platform Engineer",
                "Productivity Platform Engineer",
            ),
            (
                "the next step of the hiring process for the Data Analyst",
                "Data Analyst",
            ),
            ("the position of Support Engineer", "Support Engineer"),
            ("QA Automation Engineer role at Lumenhollow", "QA Automation Engineer"),
            (
                "Senior Site Reliability Engineer (Remote)",
                "Senior Site Reliability Engineer (Remote)",
            ),
            ("Account Executive - US", "Account Executive - US"),
            ("Sales Manager, US Remote", "Sales Manager, US Remote"),
            ("iOS Engineer", "iOS Engineer"),
            ("eCommerce Manager", "eCommerce Manager"),
            ("Process Engineer", "Process Engineer"),
            ("Product Owner Role Based Access", "Product Owner Role Based Access"),
            # Still a sentence once the lead-in is gone: no title at all.
            ("we would like to invite you to an interview", None),
            ("thank you for your interest", None),
            (
                "Platform Engineer for our new office in the north of the city near the river",
                None,
            ),
        ],
    )
    def test_role(self, raw, expected):
        assert clean_role(raw) == expected

    def test_a_hiring_systems_long_title_is_kept(self):
        long = "Senior Software Engineer, Backend Platform Infrastructure Team - Remote"
        assert clean_role(long) is None  # read freely out of a body: too long
        assert clean_role(long, strict=False) == long  # a template's own field

    def test_an_employer_sending_through_a_hiring_system_keeps_its_name(self):
        company, role = job_names(
            "Your application to Wells Fargo",
            "Wells Fargo <wellsfargo@myworkday.com>",
            "Thank you for your application for the Data Analyst position.",
        )
        assert (company, role) == ("Wells Fargo", "Data Analyst")

    def test_the_senders_name_is_not_the_role_either(self):
        company, role = job_names(
            "Your application to Sarah Chen",
            "Sarah Chen <sarah.chen@brightwave.example>",
            "Thanks for applying for the Platform Engineer role.",
        )
        assert (company, role) == ("Brightwave", "Platform Engineer")

    def test_a_company_writing_from_its_own_domain_is_not_a_person(self):
        company, role = job_names(
            "Your application to Morgan Stanley",
            "Morgan Stanley <morgan@morganstanley.example>",
            "Thanks for applying for the Data Analyst position.",
        )
        assert (company, role) == ("Morgan Stanley", "Data Analyst")

    def test_a_subject_that_names_the_sender_is_not_the_company(self):
        sender = "Nancy Karnas <nancy.karnas@vellacor.example>"
        company, role = job_names(
            "Interview with Nancy Karnas",
            sender,
            "We'd like to move you to the next phase of our recruitment process "
            "for the Platform Engineer role.",
        )
        assert company == "Vellacor"
        assert role == "Platform Engineer"

    @pytest.mark.parametrize(
        "name,sender,person",
        [
            ("Nancy Karnas", "Nancy Karnas <nancy.karnas@vellacor.example>", True),
            ("Nancy Karnas", "Nancy Karnas <nkarnas@vellacor.example>", True),
            ("Nancy Karnas", "Nancy Karnas <nancy@vellacor.example>", True),
            # The employer's mailbox at a hiring system, or a run-together name.
            ("Wells Fargo", "Wells Fargo <wellsfargo@myworkday.com>", False),
            ("Wells Fargo", "Wells Fargo <wells.fargo@myworkday.com>", False),
            ("Nancy Karnas", "Nancy Karnas <nancykarnas@vellacor.example>", False),
            # A company's two-word name, sent from a team mailbox.
            ("Tidelock Systems", "Tidelock Systems <jobs@tidelock.example>", False),
            ("Tidelock Systems", "x@mailhost.example", False),
            ("Vellacor", "Vellacor <hr@vellacor.example>", False),
            ("Nancy Karnas", "Vellacor Careers <careers@vellacor.example>", False),
        ],
    )
    def test_who_is_a_person(self, name, sender, person):
        assert is_sender_person(name, sender) is person

    @pytest.mark.parametrize(
        "title,doubtful",
        [
            ("Platform Engineer", False),
            ("IT Systems Administrator II", False),
            ("next phase of our recruitment process", True),
            ("We are hiring", True),
            ("iOS Engineer", False),
            ("Account Executive - US", False),
            ("", True),
        ],
    )
    def test_doubtful_titles(self, title, doubtful):
        assert role_doubtful(title) is doubtful
