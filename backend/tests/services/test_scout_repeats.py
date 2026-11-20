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


class TestTitlesTakeTurns:
    def test_four_or_fewer_titles_are_all_asked_for_every_run(self):
        for n in range(3):
            assert search_titles(_criteria(titles=SIX[:4], round=n)) == SIX[:4]

    def test_no_titles_asks_for_the_resume_type_name(self):
        assert search_titles(_criteria(titles=[])) == ["IT Admin"]

    def test_more_than_four_titles_take_turns_run_by_run(self):
        asked = [search_titles(_criteria(round=n)) for n in range(3)]
        assert asked[0] == SIX[:4]
        assert asked[1] == ["Title E", "Title F", "Title A", "Title B"]
        assert asked[2] == ["Title C", "Title D", "Title E", "Title F"]

    def test_runs_queued_before_rounds_start_at_the_first(self):
        assert search_titles(_criteria()) == SIX[:4]

    def test_the_search_url_uses_this_runs_titles(self):
        (url,) = start_urls(_criteria(round=1))
        keywords = parse_qs(urlsplit(url).query)["keywords"][0]
        assert '"Title E"' in keywords and '"Title C"' not in keywords


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
        c = _criteria(source)
        (start,) = start_urls(c)
        assert page_url(c, 1) == start + after_one
        assert page_url(c, 2) == start + after_two

    @pytest.mark.parametrize("source", ["google_jobs", "local_companies"])
    def test_no_numbered_pages_off_the_boards(self, source):
        assert page_url(_criteria(source), 1) is None


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
        assert run_tip(_run(stats={"rows": 100, "pages": 4}), {}) is None

    def test_local_companies_have_their_own_line(self):
        stats = {"rows": 20, "seen_before": 18}
        assert run_tip(_run(stats=stats, source="local_companies"), {}) is None
