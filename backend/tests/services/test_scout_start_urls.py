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

    @pytest.mark.parametrize(
        ("source", "param"),
        [("linkedin", "distance"), ("indeed", "radius"), ("ziprecruiter", "radius")],
    )
    def test_a_place_with_no_radius_set_searches_25_miles(self, source, param):
        assert _query(source, radius_miles=None)[param] == ["25"]

    @pytest.mark.parametrize(
        ("source", "miles", "asked"),
        [
            ("linkedin", 40, "50"),
            ("linkedin", 30, "50"),
            ("linkedin", 10, "10"),
            ("ziprecruiter", 40, "50"),
            ("indeed", 40, "50"),
            ("indeed", 30, "35"),
            ("indeed", 20, "25"),
            ("indeed", 15, "15"),
            ("linkedin", 100, "100"),
        ],
    )
    def test_any_radius_rounds_up_to_what_the_board_offers(self, source, miles, asked):
        param = "distance" if source == "linkedin" else "radius"
        assert _query(source, radius_miles=miles)[param] == [asked]

    @pytest.mark.parametrize("source", ["linkedin", "indeed", "ziprecruiter"])
    def test_a_radius_means_nothing_without_a_place_or_for_remote_jobs(self, source):
        for over in ({"location": None}, {"remote": "remote_only"}):
            q = _query(source, **over)
            assert "distance" not in q and "radius" not in q

    def test_searches_saved_before_radius_existed_still_work(self):
        criteria = _criteria("linkedin")
        del criteria["radius_miles"]
        q = parse_qs(urlsplit(start_urls(criteria)[0]).query)
        assert q["distance"] == ["25"]
