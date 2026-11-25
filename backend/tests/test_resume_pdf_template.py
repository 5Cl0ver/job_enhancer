"""The résumé PDF template (spec 025 part A): the master's look, read back with
pdfplumber — colors, the skills table, dates on the right, page numbers, the
older layout, and text a tracking system can read in order."""

import io

import pdfplumber
import pytest

from app.services.resume_pdf import (
    BAR,
    BLUE,
    BOX,
    MARGIN_X,
    NAVY,
    _parse,
    render_pdf,
)

PAGE_W = 612  # US Letter, in points
RIGHT = PAGE_W - MARGIN_X

JOB = """# Jane Dev
> Backend Engineer · APIs, Data & Cloud
Portland, OR · 555-123-4567 · jane@example.com · github.com/janedev

## SUMMARY
Backend engineer with six years building APIs and data pipelines.

## SKILLS
**Languages:** Python, TypeScript, SQL
**Cloud & infrastructure:** AWS (Lambda, S3, RDS), Docker, Terraform, GitHub Actions

## EXPERIENCE
**Senior Software Engineer** · Globex | Jan 2021 – Present
### Platform
- Built and shipped a service that handled **millions** of requests a day.
- Cut deploy time from 40 minutes to 6.
### Data
- Moved nightly reports onto a streaming pipeline.

**Software Engineer** · Initech | Jun 2017 – Dec 2020
- Wrote the billing integration.

## CERTIFICATIONS
**AWS Certified Developer** · Amazon | 2022

## EDUCATION
**B.S., Computer Science** · Oregon State University | 2013 – 2017
"""

OLD = """# Jane Dev
Portland, OR | 555-123-4567 | jane@example.com

## SUMMARY
Backend engineer.

## SKILLS
**Languages:** Python, SQL

## WORK EXPERIENCE
**Globex** | *Senior Software Engineer* | Jan 2021 – Present
- Built the platform.

## EDUCATION
**Oregon State University** | *B.S., Computer Science* | 2013 – 2017
"""


def _open(md: str):
    return pdfplumber.open(io.BytesIO(render_pdf(md)))


def _rgb(color) -> tuple[int, ...]:
    return tuple(round(c * 255) for c in (color or ()))


def _fills(page) -> list[tuple[tuple[int, ...], dict]]:
    """Filled shapes and their colors (rounded boxes are curves, not rects)."""
    shapes = page.rects + page.curves
    return [(_rgb(r.get("non_stroking_color")), r) for r in shapes if r.get("fill")]


def _words(page):
    return page.extract_words(extra_attrs=["size", "non_stroking_color"])


def _near(a: float, b: float, tol: float = 1.0) -> bool:
    return abs(a - b) <= tol


def test_letter_page_and_margins():
    with _open(JOB) as doc:
        page = doc.pages[0]
        assert (round(page.width), round(page.height)) == (612, 792)
        words = _words(page)
        assert _near(min(w["x0"] for w in words), MARGIN_X)
        assert max(w["x1"] for w in words) <= RIGHT + 0.5


def test_header_name_title_and_navy_rule():
    with _open(JOB) as doc:
        page = doc.pages[0]
        words = _words(page)
        name = next(w for w in words if w["text"] == "Jane")
        assert _near(name["size"], 24, 0.1)
        assert _rgb(name["non_stroking_color"]) == NAVY
        title = next(w for w in words if w["text"] == "Backend" and w["size"] > 11)
        assert _near(title["size"], 11.5, 0.1)
        assert _rgb(title["non_stroking_color"]) == BLUE
        # The thick navy rule under the header runs the full width.
        rules = [r for c, r in _fills(page) if c == NAVY]
        assert rules and _near(rules[0]["x0"], MARGIN_X)
        assert _near(rules[0]["x1"], RIGHT)
        assert rules[0]["top"] > title["bottom"]


def test_section_headings_sit_on_light_blue_rules():
    with _open(JOB) as doc:
        page = doc.pages[0]
        bars = [r for c, r in _fills(page) if c == BAR]
        heads = [w for w in _words(page) if w["text"] in ("SUMMARY", "SKILLS")]
        assert len(heads) == 2
        assert all(_rgb(w["non_stroking_color"]) == NAVY for w in heads)
        assert len(bars) >= 5  # summary, skills, experience, certs, education
        for bar in bars:
            assert _near(bar["x0"], MARGIN_X) and _near(bar["x1"], RIGHT)
        # Each heading's rule sits just under it.
        for head in heads:
            assert any(0 < b["top"] - head["bottom"] < 6 for b in bars)


def test_skills_table_has_labels_left_and_lines_between_rows():
    with _open(JOB) as doc:
        page = doc.pages[0]
        words = _words(page)
        label = next(w for w in words if w["text"] == "Languages")
        assert _rgb(label["non_stroking_color"]) == NAVY
        assert _near(label["x0"], MARGIN_X)
        item = next(w for w in words if w["text"] == "Python,")
        assert _near(item["top"], label["top"], 1.5)  # same row
        assert item["x0"] > MARGIN_X + 100  # the right-hand column
        assert not any(w["text"].endswith(":") and w is label for w in words)
        grey = [
            ln for ln in page.lines if _rgb(ln.get("stroking_color")) == (229, 231, 235)
        ]
        assert len(grey) >= 2  # one under each row


def test_job_header_dates_are_right_aligned():
    with _open(JOB) as doc:
        page = doc.pages[0]
        words = _words(page)
        present = next(w for w in words if w["text"] == "Present")
        assert _near(present["x1"], RIGHT)
        title = next(w for w in words if w["text"] == "Senior")
        assert _near(title["size"], 11, 0.1)
        assert _near(present["top"], title["top"], 2)
        company = next(w for w in words if w["text"] == "Globex")
        assert _rgb(company["non_stroking_color"]) == BLUE
        # A "### Group" is a blue bold sub-heading.
        group = next(w for w in words if w["text"] == "Platform")
        assert _rgb(group["non_stroking_color"]) == BLUE
        # A certification's year sits on the right too.
        year = next(w for w in words if w["text"] == "2022")
        assert _near(year["x1"], RIGHT)


def test_bullets_are_indented():
    with _open(JOB) as doc:
        words = _words(doc.pages[0])
        dot = next(w for w in words if w["text"] == "•")
        text = next(w for w in words if w["text"] == "Built")
        assert MARGIN_X < dot["x0"] < MARGIN_X + 6
        assert 8 < text["x0"] - MARGIN_X < 16


def test_text_reads_in_order():
    """Single column, top to bottom: what a tracking system reads."""
    with _open(JOB) as doc:
        text = "\n".join(p.extract_text() for p in doc.pages)
    order = [
        "Jane Dev",
        "Backend Engineer · APIs, Data & Cloud",
        "jane@example.com",
        "SUMMARY",
        "SKILLS",
        "Languages Python, TypeScript, SQL",
        "EXPERIENCE",
        "Senior Software Engineer · Globex Jan 2021 – Present",
        "Platform",
        "Built and shipped",
        "Software Engineer · Initech Jun 2017 – Dec 2020",
        "CERTIFICATIONS",
        "EDUCATION",
    ]
    at = [text.find(s) for s in order]
    assert -1 not in at, [s for s, i in zip(order, at, strict=True) if i == -1]
    assert at == sorted(at)


def test_footer_counts_pages():
    long_md = (
        JOB
        + "\n## PROJECTS\n"
        + "\n".join(
            f"**Project {n}** · github.com/jane/p{n} | 2020 – 2021\n"
            "- Built a tool that a lot of people used every single day at work.\n"
            "- Wrote the docs, the tests and the release scripts for it.\n"
            for n in range(12)
        )
    )
    with _open(long_md) as doc:
        assert len(doc.pages) == 2
        for n, page in enumerate(doc.pages, 1):
            lines = page.extract_text().splitlines()
            assert lines[-1] == f"Page {n} of 2"
            foot = [w for w in _words(page) if w["top"] > 750][-1]
            assert _near(foot["x1"], RIGHT)
            assert _near(foot["size"], 8.5, 0.1)
    # One page: no footer, and never "MASTER RESUME".
    with _open(JOB) as doc:
        text = doc.pages[0].extract_text()
        assert len(doc.pages) == 1
        assert "Page 1" not in text
        assert "MASTER RESUME" not in text.upper()


def test_old_layout_renders_in_the_new_look():
    """The 022 layout ("**Company** | *Title* | dates") still renders."""
    with _open(OLD) as doc:
        page = doc.pages[0]
        text = page.extract_text()
        words = _words(page)
    assert "Portland, OR · 555-123-4567 · jane@example.com" in text
    assert "Globex · Senior Software Engineer Jan 2021 – Present" in text
    assert "Oregon State University · B.S., Computer Science 2013 – 2017" in text
    assert "|" not in text and "*" not in text
    present = next(w for w in words if w["text"] == "Present")
    assert _near(present["x1"], RIGHT)
    assert any(c == BAR for c, _ in _fills(page))


def test_long_titles_wrap_and_never_overlap_the_dates():
    md = (
        "# Jane Dev\n\n## EXPERIENCE\n"
        "**Senior Principal Staff Software Engineer, Platform Reliability and "
        "Developer Experience and Internal Tools** · Globex Corporation "
        "International Holdings | Jan 2021 – Present\n- Built it.\n"
    )
    with _open(md) as doc:
        words = _words(doc.pages[0])
    date = next(w for w in words if w["text"] == "Jan")
    same_line = [w for w in words if _near(w["top"], date["top"], 3) and w is not date]
    left = [w for w in same_line if w["x0"] < date["x0"] - 20]
    assert left and max(w["x1"] for w in left) < date["x0"] - 4
    # It wrapped: some of the title is on the next line, at the left margin.
    below = [w for w in words if date["top"] + 8 < w["top"] < date["top"] + 30]
    assert any(_near(w["x0"], MARGIN_X) and w["text"] != "•" for w in below)


def test_core_areas_boxes_only_when_asked():
    md = (
        "# Jane Dev\n\n## CORE AREAS\n"
        "### Identity & Access\nEntra ID, AD, SSO\n"
        "### Endpoint\nWindows, Intune\n"
        "### Cloud\nAzure, AWS\n"
        "### Automation\nPowerShell, Python\n\n"
        "## SKILLS\n**Languages:** Python\n"
    )
    with _open(md) as doc:
        page = doc.pages[0]
        boxes = [r for c, r in _fills(page) if c == BOX]
        text = page.extract_text()
    assert len(boxes) == 4
    tops = {round(b["top"]) for b in boxes}
    assert len(tops) == 1  # side by side
    assert "Identity & Access" in text and "PowerShell, Python" in text
    with _open(JOB) as doc:
        assert not [r for c, r in _fills(doc.pages[0]) if c == BOX]


def test_a_long_resume_stays_on_the_page():
    """A long sample: every word inside the margins, and no block overlaps
    the next (each line starts below the one before it)."""
    md = (
        JOB
        + "\n## PROJECTS\n"
        + "\n".join(
            f"**Project {n} with a fairly long name** · An Organization | 2019 – 2020\n"
            + "\n".join(
                f"- Bullet {b} describing the work in enough words to wrap onto a "
                "second line of the page, the way real bullets often do."
                for b in range(3)
            )
            + "\n"
            for n in range(10)
        )
    )
    with _open(md) as doc:
        assert len(doc.pages) >= 2
        for page in doc.pages:
            words = _words(page)
            assert all(
                w["x0"] >= MARGIN_X - 0.5 and w["x1"] <= RIGHT + 0.5 for w in words
            )
            body = [w for w in words if w["top"] < 750]
            assert all(w["bottom"] <= 792 - 36 + 1 for w in body)
            lines = page.extract_text_lines()
            for a, b in zip(lines, lines[1:], strict=False):
                assert b["top"] >= a["top"] - 0.5


def test_cover_letter_gets_the_header():
    md = (
        "# Jane Dev\nPortland, OR | jane@example.com\n\n"
        "Dear Hiring Manager,\n\nI am applying for the role.\n\nSincerely,\nJane Dev\n"
    )
    with _open(md) as doc:
        page = doc.pages[0]
        text = page.extract_text()
        assert any(c == NAVY for c, _ in _fills(page))
    assert text.index("Jane Dev") < text.index("Dear Hiring Manager,")
    assert "I am applying for the role." in text


@pytest.mark.parametrize(
    ("line", "kind"),
    [
        ("**Languages:** Python, SQL", "row"),
        ("**Languages**: Python, SQL", "row"),
        ("**Languages:** English. **Work:** authorized in the US", "para"),
        ("**Globex** | *Engineer* | 2019 – 2021", "entry"),
        ("**Engineer** · Globex | Sep 2024 – Present", "entry"),
        ("**MD-102** · Microsoft | In progress", "entry"),
        ("**Globex** | *Engineer*", "entry"),
        ("Engineer, Globex | 2019 – 2021", "entry"),
        ("A plain sentence | with a pipe", "para"),
        ("**Bold** start of a plain sentence.", "para"),
        ("- **Built** it | fast", "bullet"),
        ("### Group", "group"),
        ("#### Smaller group", "group"),
        ("---", "section"),  # a horizontal rule is skipped: the template draws its own
        ("> Title line", "title"),
    ],
)
def test_parser_reads_each_line_kind(line, kind):
    blocks = _parse("## EXPERIENCE\n" + line)
    assert blocks[-1]["kind"] == kind
