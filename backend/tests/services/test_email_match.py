"""Matching an email to a saved job: ranked evidence, review when unclear.
All companies, people and domains are fictional."""

from datetime import UTC, datetime

from app.services.email_match import (
    COMPANY_DATE,
    COMPANY_ONLY,
    COMPANY_TITLE,
    CONFLICT,
    FUZZY_COMPANY,
    JOB_ID,
    JOB_URL,
    KNOWN_SENDER,
    MATCHED,
    NONE,
    REVIEW,
    SEVERAL_JOBS,
    SEVERAL_ROLES,
    TITLE_ONLY,
    match_job,
    sender_is_saved_company,
)

SAVED = datetime(2026, 9, 1, tzinfo=UTC)

JOBS = [
    {
        "id": "q-be",
        "company": "Quillfeather Labs",
        "title": "Backend Engineer",
        "apply_url": "https://boards.greenhouse.io/quillfeather/jobs/4412987",
        "saved_at": SAVED,
    },
    {
        "id": "q-fe",
        "company": "Quillfeather Labs",
        "title": "Frontend Engineer",
        "saved_at": SAVED,
    },
    {
        "id": "q-de",
        "company": "Quillfeather Labs",
        "title": "Senior Data Engineer",
        "saved_at": SAVED,
    },
    {
        "id": "o-da",
        "company": "Orbweaver Analytics",
        "title": "Data Analyst",
        "apply_url": "https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6",
        "saved_at": SAVED,
    },
    {
        "id": "k-ck",
        "company": "The Copper Kettle Group",
        "title": "Software Engineer",
        "saved_at": SAVED,
    },
    {
        "id": "v-ba",
        "company": "Vantorra Bank",
        "title": "Software Engineer II",
        "saved_at": SAVED,
    },
    {
        "id": "g-hd",
        "company": "Home Supply Co",
        "title": "Store Associate",
        "saved_at": SAVED,
    },
]


def m(**kw):
    return match_job(JOBS, **kw)


class TestRankedEvidence:
    def test_exact_job_url_wins(self):
        r = m(
            subject="Thanks for applying",
            from_addr="no-reply@us.greenhouse-mail.io",
            text="View the posting: https://boards.greenhouse.io/quillfeather/jobs/4412987",
        )
        assert (r.status, r.job["id"], r.evidence) == (MATCHED, "q-be", JOB_URL)

    def test_job_id_from_the_url(self):
        r = m(subject="Application received", text="Reference: a1b2c3d4e5f6")
        assert (r.status, r.job["id"], r.evidence) == (MATCHED, "o-da", JOB_ID)

    def test_known_personal_sender(self):
        r = m(
            subject="Quick follow-up",
            from_addr="Priya Okafor <priya.okafor@quillfeather.example>",
            text="Are you free Thursday?",
            known_senders={"priya.okafor@quillfeather.example": {"q-fe"}},
        )
        assert (r.status, r.job["id"], r.evidence) == (MATCHED, "q-fe", KNOWN_SENDER)

    def test_shared_inbox_is_never_a_known_sender(self):
        r = m(
            subject="Update",
            from_addr="careers@quillfeather.example",
            known_senders={"careers@quillfeather.example": {"q-fe"}},
        )
        assert r.status == REVIEW and r.evidence == SEVERAL_ROLES

    def test_reply_to_counts_as_sender(self):
        r = m(
            subject="Following up",
            from_addr="no-reply@us.greenhouse-mail.io",
            reply_to="priya.okafor@quillfeather.example",
            known_senders={"priya.okafor@quillfeather.example": {"q-de"}},
        )
        assert r.matched and r.job["id"] == "q-de"

    def test_company_and_title_from_body_and_display_name(self):
        r = m(
            subject="Your application",
            from_addr="Orbweaver Analytics <no-reply@us.greenhouse-mail.io>",
            text="We received your application for Data Analyst.",
        )
        assert (r.status, r.job["id"], r.evidence) == (MATCHED, "o-da", COMPANY_TITLE)

    def test_company_from_sender_domain(self):
        r = m(
            subject="Frontend Engineer interview",
            from_addr="talent@quillfeather.example",
        )
        assert r.matched and r.job["id"] == "q-fe"

    def test_company_plus_date_when_it_is_the_only_job_there(self):
        r = m(
            subject="Next steps",
            text="Thanks for your interest in Vantorra Bank.",
            date=datetime(2026, 9, 10, tzinfo=UTC),
        )
        assert (r.status, r.job["id"], r.evidence) == (MATCHED, "v-ba", COMPANY_DATE)

    def test_company_only_email_from_long_before_saving_is_review(self):
        r = m(
            subject="Next steps",
            text="Thanks for your interest in Vantorra Bank.",
            date=datetime(2025, 1, 1, tzinfo=UTC),
        )
        assert r.status == REVIEW and r.evidence == COMPANY_ONLY


class TestCommonWords:
    def test_one_shared_common_word_is_not_a_match(self):
        r = m(subject="Thanks for applying to the role", from_addr="x@yarrowby.example")
        assert r.status == NONE

    def test_suffixes_and_common_words_are_ignored(self):
        # "group" and "the" alone mean nothing; copper + kettle must both appear.
        assert m(subject="Our group update", text="the latest news").status == NONE
        r = m(subject="Copper Kettle: Software Engineer application")
        assert r.matched and r.job["id"] == "k-ck"

    def test_all_common_name_needs_the_whole_phrase(self):
        assert m(subject="Your home office setup at the depot").status == NONE
        r = m(subject="Thank you for applying to Home Supply Co — Store Associate")
        assert r.matched and r.job["id"] == "g-hd"

    def test_platform_domain_is_never_the_employer(self):
        assert not sender_is_saved_company(JOBS, "no-reply@myworkdayjobs.com")
        assert sender_is_saved_company(JOBS, "rowan@quillfeather.example")


class TestReview:
    def test_title_only_is_review(self):
        r = m(
            subject="Indeed Application: Data Analyst",
            from_addr="indeedapply@indeedemail.com",
        )
        assert r.status == REVIEW and r.evidence == TITLE_ONLY
        assert [c["id"] for c in r.candidates] == ["o-da"]

    def test_several_roles_at_one_company_without_a_title(self):
        r = m(subject="Update on your Quillfeather Labs application")
        assert r.status == REVIEW and r.evidence == SEVERAL_ROLES
        assert {c["id"] for c in r.candidates} == {"q-be", "q-fe", "q-de"}

    def test_named_role_at_a_multi_role_company(self):
        r = m(subject="Quillfeather Labs: Senior Data Engineer interview")
        assert r.matched and r.job["id"] == "q-de"  # not the shorter sub-title

    def test_two_named_roles_is_review(self):
        r = m(
            subject="Quillfeather Labs update",
            text="Your Backend Engineer and Frontend Engineer applications are in review.",
        )
        assert r.status == REVIEW and r.evidence == SEVERAL_JOBS

    def test_url_for_one_job_but_title_of_another_is_review(self):
        r = m(
            subject="Quillfeather Labs — Frontend Engineer",
            text="https://boards.greenhouse.io/quillfeather/jobs/4412987",
        )
        assert r.status == REVIEW and r.evidence == CONFLICT

    def test_near_miss_company_spelling_is_review(self):
        r = m(subject="Thanks for applying to Orbweavr Analytic")
        assert r.status == REVIEW and r.evidence == FUZZY_COMPANY

    def test_no_evidence_is_none(self):
        r = m(subject="Your order shipped", from_addr="orders@ferncastle.example")
        assert r.status == NONE and r.job is None and r.candidates == []
