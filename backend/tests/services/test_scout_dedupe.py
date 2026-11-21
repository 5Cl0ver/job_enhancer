"""Claude Scout dedupe keys and posting-link checks (pure)."""

import pytest

from app.services.scout_dedupe import (
    MAX_KEY,
    company_key,
    is_job_site,
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

    def test_workday_links_match_with_or_without_the_language(self):
        base = "https://vellacor.wd1.myworkdayjobs.com/External/job/Springfield-IL/IT-Admin_R-1042"
        landed = (
            "https://vellacor.wd1.myworkdayjobs.com/en-US/External/job/Springfield-IL/"
            "IT-Admin_R-1042/apply?source=LinkedIn"
        )
        assert url_key(base) == url_key(landed)
        assert url_key(base) != url_key(base.replace("1042", "1043"))

    def test_oleeo_links_match_by_their_job_id(self):
        a = "https://quillstone.tal.net/vx/lang-en-GB/mobile-0/appcentre-ext/brand-2/candidate/so/pm/1/pl/1/opp/2214-Help-Desk-Analyst/en-GB"
        b = "https://quillstone.tal.net/vx/candidate/so/pm/1/pl/1/opp/2214-Help-Desk-Analyst/en-GB"
        assert url_key(a) == url_key(b) == "quillstone.tal.net/opp/2214"

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


class TestJobSites:
    @pytest.mark.parametrize(
        "url",
        [
            "https://www.indeed.com/cmp/Vellacor",
            "https://uk.indeed.co.uk/viewjob?jk=1",
            "https://www.glassdoor.com/Overview/Vellacor.htm",
            "https://www.yelp.com/biz/brambleworks",
            "https://www.google.ca/maps/place/Brambleworks",
            "linkedin.com/company/vellacor",
        ],
    )
    def test_boards_directories_and_review_sites(self, url):
        assert is_job_site(url)

    @pytest.mark.parametrize(
        "url",
        [
            "https://brambleworks.example/careers",
            "https://vellacor.wd5.myworkdayjobs.com/External",
            "https://boards.greenhouse.io/quillstone/jobs/123",
            "https://notindeed.example/jobs",
        ],
    )
    def test_a_companys_own_pages_and_hiring_systems(self, url):
        assert not is_job_site(url)


def test_a_google_page_is_never_the_posting():
    assert "Apply on" in posting_problem("https://www.google.com/search?q=x&udm=8")
    assert "Apply on" in posting_problem("https://jobs.google.com/abc")


def test_googles_own_jobs_are_postings():
    url = "https://www.google.com/about/careers/applications/jobs/results/123-it-admin"
    assert posting_problem(url) is None
    assert not is_job_site(url)
    assert posting_problem("https://careers.google.com/jobs/results/123/") is None
