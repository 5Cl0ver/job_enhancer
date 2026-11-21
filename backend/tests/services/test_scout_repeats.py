"""Fewer repeats from one search: the titles it asks for take turns, the next
results page has a link, and a search that came back short says what to change.
Pure functions; no database."""

from urllib.parse import parse_qs, urlsplit

import pytest

from app.models.scout import ScoutRun
from app.services.scout_runs import page_url, run_tip, search_titles, start_urls

SIX = ["Title A", "Title B", "Title C", "Title D", "Title E", "Title F"]


def _criteria(source="linkedin", titles=SIX, **over):
    return {
        "source": source,
        "job_count": 5,
        "posted_within_days": 1,
        "location": "Springfield, IL",
        "remote": "any",
        "radius_miles": 25,
        "track": {"name": "IT Admin", "titles": titles},
        **over,
    }


NINE = SIX + ["Title G", "Title H", "Title I"]


class TestTitlesTakeTurns:
    def test_each_title_is_its_own_unquoted_search(self):
        urls = start_urls(_criteria(titles=SIX[:3]))
        assert [parse_qs(urlsplit(u).query)["keywords"] for u in urls] == [
            ["Title A"],
            ["Title B"],
            ["Title C"],
        ]

    def test_related_titles_are_searched_too_without_repeats(self):
        c = _criteria(titles=SIX[:2])
        c["track"]["related"] = ["Title C", "title a"]
        assert search_titles(c) == ["Title A", "Title B", "Title C"]

    def test_no_titles_asks_for_the_resume_type_name(self):
        assert search_titles(_criteria(titles=[])) == ["IT Admin"]

    def test_more_than_six_titles_take_turns_run_by_run(self):
        asked = [search_titles(_criteria(titles=NINE, round=n)) for n in range(3)]
        assert asked[0] == NINE[:6]
        assert asked[1] == NINE[6:] + NINE[:3]
        assert asked[2] == NINE[3:9]

    def test_the_searches_per_run_limit_is_the_users(self):
        assert len(search_titles(_criteria(limits={"links": 2}))) == 2

    def test_exact_titles_share_one_quoted_search(self):
        c = _criteria(round=1)
        c["track"]["exact"] = True
        (url,) = start_urls(c)
        keywords = parse_qs(urlsplit(url).query)["keywords"][0]
        assert keywords == '"Title E" OR "Title F" OR "Title A" OR "Title B"'


class TestNextPage:
    @pytest.mark.parametrize(
        ("source", "after_one", "after_two"),
        [
            ("linkedin", "&start=25", "&start=50"),
            ("indeed", "&start=10", "&start=20"),
            ("ziprecruiter", "&page=2", "&page=3"),
        ],
    )
    def test_each_board_pages_its_own_way(self, source, after_one, after_two):
        c = _criteria(source, titles=SIX[:2])
        first, second = start_urls(c)
        assert page_url(c, 0, 1) == first + after_one
        assert page_url(c, 1, 2) == second + after_two

    @pytest.mark.parametrize("source", ["google_jobs", "local_companies"])
    def test_no_numbered_pages_off_the_boards(self, source):
        assert page_url(_criteria(source), 0, 1) is None


def _run(status="done", stats=None, **over):
    return ScoutRun(criteria=_criteria(**over), stats=stats, status=status)


class TestTip:
    def test_none_while_running_or_when_it_found_enough(self):
        stats = {"rows": 20, "seen_before": 18, "pages": 1}
        assert run_tip(_run("running", stats), {}) is None
        assert run_tip(_run("done", stats), {"picked": 3, "saved": 2}) is None

    def test_none_when_nothing_was_read(self):
        assert run_tip(_run(stats=None), {}) is None

    def test_mostly_seen_before_says_to_wait_or_widen(self):
        tip = run_tip(_run(stats={"rows": 20, "seen_before": 12, "pages": 4}), {})
        assert "already seen" in tip and '"Last 3 days"' in tip

    def test_widest_window_only_says_to_wait(self):
        stats = {"rows": 20, "in_tracker": 15, "pages": 4}
        tip = run_tip(_run(stats=stats, posted_within_days=30), {})
        assert tip.endswith("Give it a day.")

    def test_titles_that_didnt_fit_point_to_the_resume_type(self):
        tip = run_tip(_run(stats={"rows": 20, "title_passed": 14, "pages": 4}), {})
        assert "resume type" in tip

    def test_ran_out_of_results_says_widen_or_bigger_radius(self):
        tip = run_tip(_run(stats={"rows": 6, "pages": 1}), {"picked": 1})
        assert tip == (
            'The search ran out of results. For more, widen "Posted" to '
            '"Last 3 days" or pick a bigger radius.'
        )

    def test_not_ran_out_when_stopped_or_from_before_pages_were_counted(self):
        stats = {"rows": 6, "pages": 1}
        assert run_tip(_run("stopped", stats), {"picked": 1}) is None
        assert run_tip(_run(stats={"rows": 6}), {"picked": 1}) is None

    def test_read_every_page_and_nothing_stands_out_no_tip(self):
        # 6 searches x 2 pages each, all read.
        assert run_tip(_run(stats={"rows": 100, "pages": 12}), {}) is None

    def test_searches_that_found_few_jobs_say_so(self):
        stats = {
            "rows": 8,
            "pages": 3,
            "_links": {"0": {"total": 6, "pages": 1}, "1": {"total": 2, "pages": 1}},
        }
        tip = run_tip(_run(stats=stats), {})
        assert tip.startswith("The searches themselves found only 8 jobs")

    def test_local_companies_have_their_own_line(self):
        stats = {"rows": 20, "seen_before": 18}
        assert run_tip(_run(stats=stats, source="local_companies"), {}) is None
