"""The search page Scout hands Claude: "within N miles" on each job board."""

from urllib.parse import parse_qs, urlsplit

import pytest

from app.services.scout_runs import start_urls


def _criteria(source, **over):
    return {
        "source": source,
        "posted_within_days": 7,
        "location": "Springfield, IL",
        "remote": "any",
        "radius_miles": 25,
        "track": {"name": "IT Admin", "titles": ["IT Systems Administrator"]},
        **over,
    }


def _query(source, **over):
    (url,) = start_urls(_criteria(source, **over))
    return parse_qs(urlsplit(url).query)


class TestRadius:
    @pytest.mark.parametrize(
        ("source", "param"),
        [("linkedin", "distance"), ("indeed", "radius"), ("ziprecruiter", "radius")],
    )
    def test_each_board_gets_the_radius_under_its_own_name(self, source, param):
        assert _query(source)[param] == ["25"]

    @pytest.mark.parametrize("source", ["linkedin", "indeed", "ziprecruiter"])
    def test_no_radius_set_leaves_it_to_the_board(self, source):
        q = _query(source, radius_miles=None)
        assert "distance" not in q and "radius" not in q

    @pytest.mark.parametrize("source", ["linkedin", "indeed", "ziprecruiter"])
    def test_a_radius_means_nothing_without_a_place_or_for_remote_jobs(self, source):
        for over in ({"location": None}, {"remote": "remote_only"}):
            q = _query(source, **over)
            assert "distance" not in q and "radius" not in q

    def test_searches_saved_before_radius_existed_still_work(self):
        criteria = _criteria("linkedin")
        del criteria["radius_miles"]
        assert "distance" not in parse_qs(urlsplit(start_urls(criteria)[0]).query)
