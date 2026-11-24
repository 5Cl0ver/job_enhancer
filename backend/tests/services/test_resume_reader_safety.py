"""The built-in reader can't be made slow or to return bad values (spec 020
security review). Every pattern runs on short, capped lines."""

import time

import pytest

from app.services.resume_reader import read

NASTY = [
    "(" + "1" * 16_000,  # an unclosed bracket of digits
    "(" + " " * 50_000 + "2016",  # spaces then a year
    "a-" * 40_000,  # a link pattern's worst case
    "EDUCATION\n" + "University " + "(" * 30_000 + "2019",
    "EXPERIENCE\n" + "Engineer | Acme | " + "Jan 2020 - " * 10_000,
    "SKILLS\n" + "x, " * 60_000,
    "linkedin.com/in/" + "a" * 100_000,
    "EXPERIENCE\n" + ("Title, " * 20_000) + "Salem, OR 2019 - 2020",
    "\n".join(["Engineer | Acme | 2019 - 2020"] * 20_000),
]


@pytest.mark.parametrize("text", NASTY, ids=range(len(NASTY)))
def test_hostile_text_is_read_fast(text):
    start = time.perf_counter()
    read(text)
    assert time.perf_counter() - start < 1.0


def test_years_out_of_range_are_dropped():
    # Impossible years make no date range, so no job is made from that line.
    assert (
        read("EXPERIENCE\nAnalyst | Kelso Labs | Jan 1066 - Dec 9999\n")["work"] == []
    )
    edu = read("EDUCATION\nLakeview College, B.A. Economics, 3010\n")["education"][0]
    assert edu["end_year"] is None


def test_values_fit_what_the_app_accepts():
    long_title = "Engineer " * 30  # 270 characters: over the 200 a title may hold
    out = read(f"EXPERIENCE\n{long_title}| Kelso Labs | 2019 - 2020\n- " + "x" * 5000)
    job = out["work"][0]
    assert len(job["title"]) <= 200 and len(job["description"]) <= 2000
    links = read("linkedin.com/in/" + "a" * 300)["websites"]
    assert all(len(link) <= 300 for link in links)
