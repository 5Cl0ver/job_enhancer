"""Exact readers for hiring-system templates — synthetic emails, invented
companies, in the shapes Indeed / LinkedIn / ZipRecruiter / Workday / iCIMS /
Greenhouse / Lever / Ashby send."""

import pytest

from app.services.email_match import MATCHED, NONE, TEMPLATE, match_template
from app.services.email_templates import (
    APPLIED,
    IGNORE,
    INTERVIEW,
    RECRUITER,
    REJECTED,
    read_template,
)


class TestIndeed:
    def test_application_update_names_company_and_title(self):
        t = read_template(
            "An update on your application from Vellacor",
            '"Vellacor" <noreply@indeed.com>',
            "Thank you for applying to the Data Engineer position at Vellacor. "
            "Unfortunately, Vellacor has moved to the next step in their hiring process.",
        )
        assert (t.source, t.company, t.title, t.event) == (
            "indeed",
            "Vellacor",
            "Data Engineer",
            None,
        )

    def test_application_receipt(self):
        t = read_template(
            "Indeed Application: Platform Engineer",
            '"Indeed Apply" <indeedapply@indeed.com>',
            "Application submitted Platform Engineer Tidelock Systems - Portland, OR "
            "The following items were sent to Tidelock Systems.",
        )
        assert (t.title, t.company, t.event) == (
            "Platform Engineer",
            "Tidelock Systems",
            APPLIED,
        )

    def test_interview_invite(self):
        t = read_template(
            "Good News! Lumenhollow invited you to a video interview",
            '"Lumenhollow via Indeed" <no-reply@indeed.com>',
            "Claim your 30-minute video interview spot for the QA Engineer job.",
        )
        assert (t.company, t.title, t.event) == (
            "Lumenhollow",
            "QA Engineer",
            INTERVIEW,
        )

    def test_invited_to_apply_is_a_recruiter(self):
        t = read_template(
            "Saltmarsh Logistics has invited you to apply",
            '"Indeed" <no-reply@indeed.com>',
            "A recruiter thinks you could be a good candidate.",
        )
        assert (t.company, t.event) == ("Saltmarsh Logistics", RECRUITER)


class TestLinkedIn:
    def test_application_sent(self):
        t = read_template(
            "Alex, your application was sent to Brambleworks",
            "LinkedIn <jobs-noreply@linkedin.com>",
            "Your application was sent to Brambleworks Full Stack Developer Brambleworks Remote",
        )
        assert (t.company, t.event) == ("Brambleworks", APPLIED)

    def test_rejection_is_read_from_its_template_name(self):
        t = read_template(
            "Your application to Data Analyst at Orbweaver Analytics",
            "LinkedIn <jobs-noreply@linkedin.com>",
            "Your update from Orbweaver Analytics https://www.linkedin.com/help?"
            "lipi=urn:li:page:email_email_jobs_application_rejected_01",
        )
        assert (t.company, t.title, t.event) == (
            "Orbweaver Analytics",
            "Data Analyst",
            REJECTED,
        )


class TestZipRecruiter:
    def test_application_complete(self):
        t = read_template(
            'Your "Systems Engineer" application is complete',
            '"Phil @ ZipRecruiter" <phil@ziprecruiter.com>',
            "",
        )
        assert (t.title, t.event) == ("Systems Engineer", APPLIED)

    @pytest.mark.parametrize(
        "subject",
        [
            "Kestrel's Support Analyst opening for you!",
            "Kestrel wants your application",
            "Kestrel would like you to complete your application",
        ],
    )
    def test_promotions_are_ignored(self, subject):
        t = read_template(subject, '"Phil @ ZipRecruiter" <phil@ziprecruiter.com>', "")
        assert t.event == IGNORE


class TestHiringSystems:
    @pytest.mark.parametrize(
        "sender,subject,company,title",
        [
            (
                "Copperline Corp <copperline@myworkday.com>",
                "Thank you for your interest in Business Analyst - R512093 at Copperline Corp, Inc.",
                "Copperline Corp, Inc",
                "Business Analyst",
            ),
            (
                "Greenhouse <no-reply@us.greenhouse-mail.io>",
                "Regarding your application with CaptivePoint",
                "CaptivePoint",
                None,
            ),
            (
                "Atmoshift <no-reply@hire.lever.co>",
                "Thank you for your application to Atmoshift",
                "Atmoshift",
                None,
            ),
            (
                "Renewly Hiring Team <no-reply@ashbyhq.com>",
                "Thank You for Your Application",
                "Renewly",
                None,
            ),
            (
                "Career Development <brightmed+email+x1@talent.icims.com>",
                "Brightmed",
                "brightmed",
                None,
            ),
        ],
    )
    def test_company_from_subject_sender_or_mailbox(
        self, sender, subject, company, title
    ):
        t = read_template(subject, sender, "")
        assert t.company == company
        if title:
            assert t.title == title

    def test_not_a_template(self):
        assert read_template("Hi", "Maren <maren@acme.example>", "Lunch?") is None


JOBS = [
    {"id": "a", "company": "Vellacor", "title": "Data Engineer"},
    {"id": "b", "company": "Quillfeather Labs", "title": "Backend Engineer"},
    {"id": "c", "company": "Quillfeather Labs", "title": "Frontend Engineer"},
]


class TestMatchingTemplates:
    def _read(self, company=None, title=None):
        from app.services.email_templates import TemplateRead

        return TemplateRead("indeed", company, title)

    def test_company_and_title_match_exactly(self):
        m = match_template(JOBS, self._read("Vellacor", "Data Engineer"))
        assert (m.status, m.job["id"], m.evidence) == (MATCHED, "a", TEMPLATE)

    def test_suffix_and_title_variants(self):
        m = match_template(
            JOBS, self._read("Quillfeather Labs, Inc.", "Frontend Engineer II")
        )
        assert (m.status, m.job["id"]) == (MATCHED, "c")

    def test_unsaved_company_is_not_about_a_saved_job(self):
        assert (
            match_template(JOBS, self._read("Brambleworks", "Data Engineer")).status
            == NONE
        )

    def test_other_role_at_the_only_saved_job_company(self):
        assert (
            match_template(JOBS, self._read("Vellacor", "Sales Manager")).status == NONE
        )

    def test_several_roles_without_title_falls_back(self):
        assert match_template(JOBS, self._read("Quillfeather Labs")) is None


class TestAuditRegressions:
    """Shapes from the real-inbox audit, rewritten with invented names."""

    def test_position_at_company_subject(self):
        t = read_template(
            "Update on the Software Engineer I Position at Brambleworks",
            "no-reply@us.greenhouse-mail.io",
            "",
        )
        assert (t.company, t.title) == ("Brambleworks", "Software Engineer I")

    def test_role_at_company_subject(self):
        t = read_template(
            "AVP, Platform & Data PM At Vellacor",
            "workday vellacor <vellacor@myworkday.com>",
            "",
        )
        assert (t.company, t.title) == ("Vellacor", "AVP, Platform & Data PM")

    def test_interview_at_company_is_not_a_title(self):
        t = read_template(
            "Interview scheduled at Vellacor",
            "vellacor@myworkday.com",
            "",
        )
        assert (t.company, t.title) == ("Vellacor", None)

    def test_title_wrapped_across_lines(self):
        t = read_template(
            "Thanks",
            "no-reply@ashbyhq.com",
            "Thank you for your interest in the Platform\nReliability Engineer\nposition.",
        )
        assert t.title == "Platform Reliability Engineer"

    def test_other_role_at_a_saved_company_moves_nothing(self):
        jobs = [
            {"id": "a", "company": "Vellacor Group", "title": "Integration Specialist"}
        ]
        t = read_template(
            "AVP, Platform & Data PM At Vellacor", "vellacor@myworkday.com", ""
        )
        assert match_template(jobs, t).status == NONE

    def test_title_only_needs_the_exact_level(self):
        from app.services.email_templates import TemplateRead

        jobs = [
            {"id": "a", "company": "Quillfeather Labs", "title": "Software Engineer II"}
        ]
        m = match_template(
            jobs, TemplateRead("greenhouse", None, "Software Engineer I")
        )
        assert m.status == NONE

    def test_link_read_from_html_is_not_a_title(self):
        t = read_template(
            "An update on your application from Brambleworks",
            '"Brambleworks" <noreply@indeed.com>',
            '<a href="https://engage.example/f/a/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA">',
        )
        assert t.company == "Brambleworks"
        assert t.title is None or "http" not in t.title
