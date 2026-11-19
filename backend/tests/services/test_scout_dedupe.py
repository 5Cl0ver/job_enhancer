"""Claude Scout dedupe keys and posting-link checks (pure)."""

import pytest

from app.services.scout_dedupe import (
    MAX_KEY,
    company_key,
    posting_link,
    posting_problem,
    title_key,
    url_key,
)


class TestKeys:
    @pytest.mark.parametrize(
        "a, b",
        [("Brambleworks, Inc.", "brambleworks"), ("The Vellacor Co", "Vellacor")],
    )
    def test_company_suffixes_dont_matter(self, a, b):
        assert company_key(a) == company_key(b)

    def test_seniority_still_matters(self):
        assert title_key("Senior IT Administrator") != title_key("IT Administrator")
        assert title_key("IT  Administrator!") == title_key("it administrator")


class TestUrlKey:
    @pytest.mark.parametrize(
        "url",
        [
            "https://www.linkedin.com/jobs/view/4012345678/?trk=public_jobs&refId=x",
            "https://linkedin.com/jobs/view/it-administrator-at-brambleworks-4012345678",
            "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=it",
        ],
    )
    def test_one_linkedin_job_one_key(self, url):
        assert url_key(url) == "linkedin.com/jobs/view/4012345678"

    def test_indeed_pane_and_page_match(self):
        a = url_key("https://www.indeed.com/viewjob?jk=ABC123&from=serp")
        b = url_key("https://www.indeed.com/jobs?q=it&l=x&vjk=abc123")
        assert a == b == "indeed.com/viewjob?jk=abc123"

    def test_greenhouse_links_match(self):
        assert url_key(
            "https://boards.greenhouse.io/brambleworks/jobs/555?gh_src=li"
        ) == (url_key("https://brambleworks.example/careers?gh_jid=555"))

    def test_tracking_params_are_dropped(self):
        assert url_key("https://jobs.vellacor.example/role/9?utm_source=x&id=9") == (
            "jobs.vellacor.example/role/9?id=9"
        )

    def test_not_a_web_link(self):
        assert url_key("mailto:jobs@vellacor.example") is None

    def test_long_links_fit_the_column_and_stay_distinct(self):
        base = "https://vellacor.example/careers/" + "x" * 900
        a, b = url_key(base + "?id=1"), url_key(base + "?id=2")
        assert len(a) <= MAX_KEY and len(b) <= MAX_KEY
        assert a != b
        assert url_key(base + "?id=1") == a


class TestPostingProblem:
    @pytest.mark.parametrize(
        "url",
        [
            "https://www.linkedin.com/jobs/search/?keywords=it+admin",
            "https://www.linkedin.com/jobs/collections/recommended/",
            "https://www.indeed.com/jobs?q=it+admin&l=Springfield",
            "https://www.ziprecruiter.com/jobs-search?search=it",
            "https://www.ziprecruiter.com/jobs-search?search=it&lvk=abc123",
            "https://vellacor.example/careers",
            "https://vellacor.example/",
        ],
    )
    def test_search_and_home_pages_are_rejected(self, url):
        assert posting_problem(url)

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.linkedin.com/jobs/view/4012345678/",
            "https://www.linkedin.com/jobs/search/?currentJobId=4012345678",
            "https://www.indeed.com/viewjob?jk=abc123",
            "https://www.ziprecruiter.com/c/Vellacor/Job/IT-Admin/-in-Springfield?jid=9f",
            "https://jobs.lever.co/vellacor/0b1c2d3e",
            "https://vellacor.example/careers/it-administrator-42",
        ],
    )
    def test_posting_pages_pass(self, url):
        assert posting_problem(url) is None

    def test_saved_link_is_the_job_page(self):
        assert (
            posting_link(
                "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=it"
            )
            == "https://www.linkedin.com/jobs/view/4012345678"
        )
        assert posting_link("https://jobs.lever.co/vellacor/0b1c") == (
            "https://jobs.lever.co/vellacor/0b1c"
        )
