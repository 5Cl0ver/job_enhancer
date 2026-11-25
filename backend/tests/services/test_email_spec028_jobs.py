"""Spec 028 step 2: which saved job an email is about. Anonymized shapes of
real mail that landed on the wrong job (invented names)."""

import uuid
from datetime import UTC, datetime, timedelta

from app.services.email_match import (
    COMPANY_ONLY,
    JOB_ID,
    MATCHED,
    NONE,
    REVIEW,
    TEMPLATE,
    TEMPLATE_COMPANY,
    TEMPLATE_TITLE,
    TITLE_ONLY,
    match_job,
    match_template,
    sender_is_saved_company,
)
from app.services.email_templates import TemplateRead, read_template
from app.services.job_links import _fits

NOW = datetime(2026, 11, 20, 12, tzinfo=UTC)


def job(company, title, *, url="", saved=NOW - timedelta(days=3)):
    return {
        "id": uuid.uuid4(),
        "job_listing_id": uuid.uuid4(),
        "company": company,
        "title": title,
        "apply_url": url,
        "external_id": "",
        "saved_at": saved,
    }


class TestTitleOnlyTemplates:
    def test_title_only_is_clear_not_sure(self):
        j = job(
            "Vellacor",
            "Data Analyst",
            url="https://www.ziprecruiter.com/c/Vellacor/Job/x",
        )
        t = TemplateRead("ziprecruiter", None, "Data Analyst", "applied")
        m = match_template([j], t, NOW)
        assert (m.status, m.evidence) == (MATCHED, TEMPLATE_TITLE)

    def test_title_only_never_picks_a_job_saved_from_another_site(self):
        # Same title, but saved from the company's own careers site.
        j = job(
            "Harbor Dept",
            "Data Analyst",
            url="https://harbor.wd5.myworkdayjobs.com/job/Data-Analyst_REQ-1234",
        )
        t = TemplateRead("ziprecruiter", None, "Data Analyst", "applied")
        m = match_template([j], t, NOW)
        assert m.status == REVIEW and m.evidence == TITLE_ONLY

    def test_title_only_never_picks_a_job_saved_months_away(self):
        j = job("Vellacor", "Data Analyst", saved=NOW - timedelta(days=90))
        t = TemplateRead("indeed", None, "Data Analyst", "applied")
        assert match_template([j], t, NOW).status == REVIEW

    def test_title_with_location_suffix_still_found(self):
        j = job(
            "Kestrel Comms",
            "Network Engineer - Level II - Fernvale, WA 98000 - Indeed.com",
            url="https://www.indeed.com/viewjob?jk=abc123def",
        )
        other = job(
            "Kestrel Comms",
            "Network Engineer (Voice) - Fernvale, WA",
            url="https://www.indeed.com/viewjob?jk=zzz999",
        )
        t = TemplateRead("indeed", None, "Network Engineer - Level II", "applied")
        m = match_template([j, other], t, NOW)
        assert m.status == MATCHED and m.job["id"] == j["id"]


class TestCompanyOnlyTemplates:
    def test_company_only_is_clear_not_sure(self):
        j = job("Copper Kettle, Inc", "IT Specialist")
        t = TemplateRead("jazzhr", "Copper Kettle, Inc", None, "interview")
        m = match_template([j], t, NOW)
        assert (m.status, m.evidence) == (MATCHED, TEMPLATE_COMPANY)

    def test_company_only_from_long_before_the_save_asks(self):
        j = job("Copper Kettle", "IT Specialist", saved=NOW)
        t = TemplateRead("jazzhr", "Copper Kettle", None, "interview")
        m = match_template([j], t, NOW - timedelta(days=120))
        assert (m.status, m.evidence) == (REVIEW, COMPANY_ONLY)

    def test_company_only_naming_another_role_is_not_this_job(self):
        j = job("Copper Kettle", "IT Specialist")
        t = TemplateRead("jazzhr", "Copper Kettle", None, None)
        m = match_template(
            [j], t, NOW, text="Thank you for applying for the Payroll Clerk position."
        )
        assert m.status == NONE

    def test_company_and_title_still_sure(self):
        j = job("Copper Kettle", "IT Specialist")
        t = TemplateRead("lever", "Copper Kettle", "IT Specialist", None)
        assert match_template([j], t, NOW).evidence == TEMPLATE

    def test_a_person_as_the_sender_name_lets_the_body_decide(self):
        # The hiring system put the recruiter's name where the company goes.
        j = job("Copper Kettle Construction, Inc", "IT Specialist")
        t = read_template(
            "Let's chat!",
            "Jo Rivers <recruiting+123-abc@applytojob.com>",
            "Thank you for your interest in employment with Copper Kettle Construction.",
        )
        assert t.company == "Jo Rivers" and t.company_from == "sender"
        assert match_template([j], t, NOW) is None
        m = match_job(
            [j],
            subject="Let's chat!",
            from_addr="Jo Rivers <recruiting+123-abc@applytojob.com>",
            text="Thank you for your interest in employment with Copper Kettle Construction.",
            date=NOW,
        )
        assert m.status == MATCHED and m.job["id"] == j["id"]

    def test_requisition_number_in_the_saved_link(self):
        j = job(
            "Harbor Dept",
            "Data Analyst",
            url="https://harbor.wd5.myworkdayjobs.com/en-US/Site/job/City/Data-Analyst_REQ-104422",
        )
        t = read_template(
            "Application Status for REQ-104422 Data Analyst (Open)",
            "Workday <harbor@myworkday.com>",
            "Your application has been received.",
        )
        m = match_template([j], t, NOW)
        assert (m.status, m.evidence) == (MATCHED, JOB_ID)


class TestCompanyNamesThatOverMatch:
    def test_a_number_name_is_not_in_every_price(self):
        j = job("The 45", "System Administrator")
        m = match_job(
            [j],
            subject="Free sandwich ($45+ purchase)",
            from_addr="rewards@deli.example",
            text="Your offer is available with any $45 purchase.",
            date=NOW,
        )
        assert m.status == NONE

    def test_a_number_name_written_out_still_matches(self):
        j = job("The 45", "System Administrator")
        m = match_job(
            [j],
            subject="Update on Your Application | The 45",
            from_addr="The 45 via HireTrack <the.45@msg.hiretrack.example>",
            text="Thank you for your interest in the System Administrator position with The 45.",
            date=NOW,
        )
        assert m.status == MATCHED and m.job["id"] == j["id"]

    def test_one_kind_of_business_word_is_not_the_company(self):
        j = job("Brightwave Talent Link, Inc", "Endpoint Engineer")
        m = match_job(
            [j],
            subject="Endpoint Engineer openings",
            from_addr="news@boards.example",
            text="Click the link below to see the Endpoint Engineer role.",
            date=NOW,
        )
        assert m.status != MATCHED

    def test_national_association_needs_more_than_association(self):
        j = job("Harbor Bank National Association", "Endpoint Engineer")
        m = match_job(
            [j],
            subject="Join our association",
            from_addr="hello@club.example",
            text="Our association has a new Endpoint Engineer guide.",
            date=NOW,
        )
        assert m.status != MATCHED

    def test_domain_of_first_words_names_the_bank(self):
        j = job("Harbor Bank National Association", "Endpoint Engineer")
        assert sender_is_saved_company([j], "careers@harborbank.example")

    def test_company_code_prefix(self):
        j = job("C4410 Vellacor Group", "AI Product Manager")
        t = TemplateRead("workday", "Vellacor", "AI Product Manager", "rejected")
        m = match_template([j], t, NOW)
        assert m.status == MATCHED and m.job["id"] == j["id"]

    def test_agency_alias_and_careers_site(self):
        j = job(
            "Acme Dental (via Northgate Staffing)",
            "Support Specialist",
            url="https://www.northgatestaff.example",
        )
        t = TemplateRead(
            "indeed", "Northgate Staffing", "Support Specialist", "recruiter"
        )
        assert match_template([j], t, NOW).job["id"] == j["id"]
        # A recruiter writing from the agency's own domain, the job's site.
        m = match_job(
            [j],
            subject="Re: Support Specialist",
            from_addr="Jo Rivers <jo@northgatestaff.example>",
            text="You have been submitted to the client.",
            date=NOW,
        )
        assert m.status == MATCHED and m.job["id"] == j["id"]

    def test_a_bare_site_link_is_not_a_job_id(self):
        j = job("Acme Dental", "Support Specialist", url="https://www.go4acme.example")
        other = job("Other Co", "Support Specialist")
        m = match_job(
            [j, other],
            subject="Hello",
            from_addr="someone@elsewhere.example",
            text="Write to me at someone@go4acme.example about the Support Specialist role.",
            date=NOW,
        )
        assert m.evidence != JOB_ID


class TestPlacementByCompanyAlone:
    def _ev(self, title="", days_before_save=30):
        return {
            "id": "e",
            "company": "Vellacor",
            "title": title,
            "subject": "Next steps",
            "addr": "jo@gmail.com",
            "labels": [],
            "date": NOW - timedelta(days=days_before_save),
            "target": "Interview",
        }

    def test_old_email_by_company_alone_is_not_placed(self):
        assert not _fits(self._ev(), job("Vellacor", "Analyst", saved=NOW))

    def test_recent_email_by_company_alone_is_placed(self):
        assert _fits(
            self._ev(days_before_save=3), job("Vellacor", "Analyst", saved=NOW)
        )

    def test_old_email_naming_the_role_is_still_placed(self):
        assert _fits(self._ev(title="Analyst"), job("Vellacor", "Analyst", saved=NOW))


class TestReviewFixes:
    """Spec 028 review: the new company and job-id clues must not reach jobs
    at other companies, nor drop real names."""

    def test_a_job_board_link_is_not_the_companys_site(self):
        j = job(
            "Maple Ridge Health",
            "IT Analyst",
            url="https://www.jobhubnw.example/jobs/view/12345678",
        )
        assert not sender_is_saved_company([j], "alerts@jobhubnw.example")

    def test_a_site_that_carries_the_name_still_counts(self):
        j = job(
            "Bramble Fen Staffing",
            "IT Analyst",
            url="https://www.bfstaffing.example/job/it-analyst",
        )
        assert sender_is_saved_company([j], "jo@bfstaffing.example")

    def test_found_via_a_job_board_is_not_a_second_name(self):
        j = job("Fernhill Dental (via Indeed)", "Office Manager")
        t = TemplateRead("indeed", "Indeed", "Office Manager", "applied")
        m = match_template([j], t, NOW)
        assert m.job is None or m.evidence != TEMPLATE

    def test_a_digit_inside_a_name_is_not_a_company_code(self):
        j = job("Quill9, Inc.", "Front End Developer")
        t = TemplateRead("workday", "Quill9", "Front End Developer", "applied")
        m = match_template([j], t, NOW)
        assert (m.status, m.evidence) == (MATCHED, TEMPLATE)

    def test_a_short_requisition_number_from_another_company(self):
        j = job(
            "Kestrel Optics",
            "Support Engineer",
            url="https://kestrel.wd1.myworkdayjobs.com/en-US/ext/job/City/Support-Engineer_R10442",
        )
        m = match_job(
            [j],
            subject="Your application for R10442",
            from_addr="harborlane@myworkday.example",
            text="Thank you for applying to Harbor Lane Bank for R10442 Teller.",
            date=NOW,
        )
        assert m.evidence != JOB_ID
        m = match_job(
            [j],
            subject="Your application for R10442",
            from_addr="kestrel@myworkday.example",
            text="Thank you for applying to Kestrel Optics for R10442 Support Engineer.",
            date=NOW,
        )
        assert (m.status, m.evidence) == (MATCHED, JOB_ID)

    def test_template_requisition_number_must_agree_on_the_company(self):
        kestrel = job(
            "Kestrel Optics",
            "Support Engineer",
            url="https://kestrel.wd1.myworkdayjobs.com/en-US/ext/job/City/Support-Engineer_R10442",
        )
        harbor = job(
            "Harbor Lane Bank",
            "Teller",
            url="https://harborlane.wd5.myworkdayjobs.com/en-US/ext/job/Salem/Teller_REQ-10442",
        )
        t = TemplateRead("workday", "Harbor Lane Bank", "Teller II", None, "R10442")
        m = match_template([kestrel, harbor], t, NOW)
        assert m.job is not None and m.job["id"] == harbor["id"]

    def test_a_broken_saved_link_does_not_stop_the_scan(self):
        j = job("Kestrel Optics", "Support Engineer", url="https://[broken/job/1")
        m = match_job(
            [j],
            subject="Kestrel Optics - Support Engineer",
            from_addr="careers@kestreloptics.example",
            text="Thanks for applying to Kestrel Optics.",
            date=NOW,
        )
        assert m.status == MATCHED
