"""Fixes from the real-inbox accuracy audit — every case synthetic.

Shapes that went wrong on real mail (rebuilt here with invented text):
store promos and lotteries read as rejections, one common word of a saved
company's name matching unrelated mail, "recruiter" as a catch-all for spam,
conditional phrases read as outcomes, and real phrasings that were missed.
"""

from datetime import UTC, datetime

import pytest

from app.services.email_classify import (
    APPLIED,
    INTERVIEW,
    RECRUITER,
    REJECTED,
    UNKNOWN,
    classify,
)
from app.services.email_match import MATCHED, NONE, match_job

PROMO = "Petfolk Deals <deals@e.petfolk.example>"


class TestNotRejections:
    def test_store_promo_fine_print_is_not_a_rejection(self):
        body = (
            "Earn points on all your pet's faves. Shop now and apply your coupon at "
            "checkout. Product prices displayed in our emails may not match the "
            "final price on our website. Unsubscribe."
        )
        assert (
            classify("20% OFF sitewide ends soon", body, PROMO, bulk=True).event
            == UNKNOWN
        )

    def test_lottery_applications_not_selected_is_not_a_rejection(self):
        body = (
            "Fill out the team application online. Applications not postmarked "
            "October 7 will not be selected for the lottery."
        )
        v = classify(
            "Relay lottery applications live!", body, "Relay <office@relay.example>"
        )
        assert v.event != REJECTED

    def test_if_you_are_not_selected_is_a_confirmation(self):
        body = (
            "Thank you for your application. We have received your application for "
            "the Cloud Support Administrator role. If you are not selected for this "
            "position, keep an eye on our jobs page."
        )
        assert (
            classify("Thanks for applying", body, "Acme <no-reply@hire.lever.co>").event
            == APPLIED
        )

    def test_contact_you_if_needed_for_an_interview_is_a_confirmation(self):
        body = (
            "Thank you for applying with Brambleworks. Your application has been "
            "forwarded to our HR department and they will contact you if they need "
            "further information, or to schedule an interview."
        )
        v = classify(
            "Thank you for applying", body, "HR <hello@send.applicants.example>"
        )
        assert v.event == APPLIED

    @pytest.mark.parametrize(
        "body",
        [
            "Unfortunately, you have not been selected to move forward.",
            "After review, your application was not selected at this time.",
            "We have decided you are not the right fit for this role.",
        ],
    )
    def test_real_rejections_still_count(self, body):
        assert (
            classify("Your application", body, "Talent <talent@acme.example>").event
            == REJECTED
        )


class TestPromoWording:
    @pytest.mark.parametrize(
        "subject,body",
        [
            (
                "Refer friends and earn points",
                "You are not eligible for this bonus if you already have the card.",
            ),
            (
                "Save on your phone plan",
                "Customers who switched in the last year are not eligible for this offer.",
            ),
            (
                "New league starts soon",
                "If the B level is not a good fit for you, try our open gyms instead.",
            ),
        ],
    )
    def test_offer_and_hobby_fine_print_is_not_a_rejection(self, subject, body):
        v = classify(subject, body, "Offers <offers@bank.example>", bulk=True)
        assert v.event != REJECTED


class TestRealPhrasings:
    def test_accepting_an_interview_invitation_is_an_interview(self):
        body = (
            "Thank you for accepting our invitation to interview. Please park in the "
            "visitor lot and check in at the front desk."
        )
        v = classify(
            "In-person interview: Platform Engineer",
            body,
            "Maren Holt <maren@acme.example>",
        )
        assert v.event == INTERVIEW

    def test_not_considered_ineligible_is_a_rejection(self):
        body = (
            "This is a record of the results of your application. Ineligible for the "
            "following position: you were not considered because you did not complete "
            "the required assessment."
        )
        v = classify(
            "Notice of Results", body, "Staffing Office <office@staffing.example>"
        )
        assert v.event == REJECTED


class TestRecruiterIsNotACatchAll:
    @pytest.mark.parametrize(
        "sender,subject,body",
        [
            (
                '"Aspire Card" <offers@warmbloom.example>',
                "Your Application Invitation",
                "Your application invitation for a new card is waiting.",
            ),
            (
                "Rewards <rewards@sandwich.example>",
                "Save 30% now",
                "Apply your rewards and save. Careers at our stores are also open.",
            ),
        ],
    )
    def test_promo_from_a_person_like_sender_is_not_a_recruiter(
        self, sender, subject, body
    ):
        assert classify(subject, body, sender).event != RECRUITER

    def test_a_recruiter_still_counts(self):
        body = (
            "Hi! I'm a recruiter at Vellacor and came across your background. Would "
            "you be open to a quick chat about a role on our team?"
        )
        v = classify(
            "Opportunity at Vellacor", body, "Maren Holt <maren@vellacor.example>"
        )
        assert v.event == RECRUITER


def _jobs():
    saved = datetime(2026, 9, 1, tzinfo=UTC)
    return [
        {
            "id": "snap",
            "company": "Snapline Inc.",
            "title": "Software Engineer, Full Stack",
            "saved_at": saved,
        },
        {
            "id": "twenty",
            "company": "The Ten",
            "title": "System Administrator",
            "saved_at": saved,
        },
        {
            "id": "hs",
            "company": "Healthcare Support",
            "title": "Full Stack Developer",
            "saved_at": saved,
        },
        {
            "id": "zip",
            "company": "ZipRecruiter",
            "title": "Systems Engineer",
            "saved_at": saved,
        },
        {
            "id": "kestrel",
            "company": "Kestrel",
            "title": "Data Analyst",
            "saved_at": saved,
        },
    ]


def _match(subject, text, sender="Talent <talent@ats-relay.example>"):
    return match_job(
        _jobs(),
        subject=subject,
        from_addr=sender,
        text=text,
        date=datetime(2026, 10, 1, tzinfo=UTC),
    )


class TestCompanyMustReallyBeNamed:
    @pytest.mark.parametrize(
        "subject,text",
        [
            ("Welcome to the new desktop", "Organize your apps with Snap Layouts."),
            (
                "Fall deals",
                "Get 20% off when you buy two. We will not be moving forward with old stock.",
            ),
            (
                "Indeed Application: IT Support Specialist",
                "Your application has been submitted.",
            ),
        ],
    )
    def test_one_common_word_is_not_the_company(self, subject, text):
        m = _match(subject, text)
        assert m.status == NONE or (m.job or {}).get("id") not in {
            "snap",
            "twenty",
            "hs",
        }

    def test_job_site_named_company_never_matches_by_name(self):
        m = _match(
            'Your "Asset Manager" application is complete',
            "ZipRecruiter sent your application.",
            sender="Phil @ ZipRecruiter <phil@ziprecruiter.com>",
        )
        assert (m.job or {}).get("id") != "zip"

    @pytest.mark.parametrize(
        "subject,text,sender",
        [
            (
                "An update from Kestrel",
                "Unfortunately we will not move forward.",
                "Talent <talent@ats-relay.example>",
            ),
            (
                "Update",
                "Thank you for your interest in Kestrel. We will not move forward.",
                "Maren <maren@mailhost.example>",
            ),
            ("Update", "We will not move forward.", "Maren <maren@kestrel.example>"),
        ],
    )
    def test_company_named_in_subject_context_or_domain_still_matches(
        self, subject, text, sender
    ):
        m = _match(subject, text, sender)
        assert (m.status, m.job["id"]) == (MATCHED, "kestrel")

    def test_loose_words_from_two_companies_are_not_a_question(self):
        jobs = [
            {
                "id": "am",
                "company": "Applied Biotech",
                "title": "Application Developer",
            },
            {
                "id": "ft",
                "company": "Summit Federal Credit Union",
                "title": "System Administrator",
            },
        ]
        m = match_job(
            jobs,
            subject="Start your preapproval",
            from_addr="Bank <offers@bank.example>",
            text="First, compare rates. Medical and tech workers get applied discounts. "
            "We will not move forward without your consent.",
        )
        # Never matched, never "which of these jobs?" (a look-alike spelling at
        # most, which the scan files under "Not in your saved jobs").
        assert m.status != MATCHED
        assert m.evidence not in ("several_roles", "several_jobs")

    def test_one_word_company_loose_in_text_does_not_match(self):
        m = _match("Update", "The kestrel is a small falcon. We will not move forward.")
        assert (m.job or {}).get("id") != "kestrel"


class TestAccountMailIsNotAContact:
    @pytest.mark.parametrize(
        "subject, sender",
        [
            ("Your verification code: 123456", "Team <support@jobsite.example>"),
            ("Here's your security code", "Login <login@us.greenhouse-jobs.com>"),
            ("Monthly Statement for Unit 4", "Billing <ebill@vellacor.example>"),
            (
                "Roxy sent you printing information about a return",
                "return@shop.example",
            ),
        ],
    )
    def test_not_a_recruiter(self, subject, sender):
        r = classify(subject, "Enter this code to continue.", sender, job_sender=True)
        assert r.event != "recruiter"
