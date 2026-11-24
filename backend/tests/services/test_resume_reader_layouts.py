"""The built-in résumé reader on many layouts (spec 020: no AI, so it must be
good). Every résumé here is invented."""

import pytest

from app.services.resume_reader import read


def jobs(text):
    return [(j["title"], j["company"]) for j in read(text)["work"]]


def test_title_line_then_company_location_and_dates():
    text = """WORK EXPERIENCE
Systems Administrator
Kelso Labs | Salem, OR | 09/2024 – Present
• Ran patching for 400 laptops
Help Desk Technician
Quillstone | Eugene, OR | 03/2021 – 08/2024
• Answered 40 tickets a day
"""
    out = read(text)["work"]
    assert [(j["title"], j["company"]) for j in out] == [
        ("Systems Administrator", "Kelso Labs"),
        ("Help Desk Technician", "Quillstone"),
    ]
    assert out[0]["location"] == "Salem, OR"
    assert out[0]["current"] is True and (
        out[0]["start_month"],
        out[0]["start_year"],
    ) == (9, 2024)
    assert (out[1]["end_month"], out[1]["end_year"]) == (8, 2024)
    assert "patching" in out[0]["description"]


def test_company_city_line_then_title_with_long_month_names():
    text = """Employment History
Brightfold Labs, Portland, OR
Software Developer    September 2021 – June 2023
▪ Built internal tools
Tidewell Health, Bend, OR
Junior Developer    January 2019 — August 2021
"""
    out = read(text)["work"]
    assert [(j["title"], j["company"]) for j in out] == [
        ("Software Developer", "Brightfold Labs"),
        ("Junior Developer", "Tidewell Health"),
    ]
    assert out[0]["location"] == "Portland, OR"
    assert (out[0]["start_month"], out[0]["start_year"], out[0]["end_month"]) == (
        9,
        2021,
        6,
    )
    assert (out[1]["start_month"], out[1]["end_month"], out[1]["end_year"]) == (
        1,
        8,
        2021,
    )


def test_title_at_company_with_dates_in_brackets():
    text = """Experience
Data Analyst at Opaline Pay (2020 - 2022)
- Wrote SQL reports
Analyst Intern at Kelso Labs (2019 - 2019)
"""
    assert jobs(text) == [
        ("Data Analyst", "Opaline Pay"),
        ("Analyst Intern", "Kelso Labs"),
    ]


def test_title_comma_company():
    text = """PROFESSIONAL EXPERIENCE
Software Engineer, Vellacor Robotics    Jun 2022 - Present
* Shipped the robot fleet dashboard
QA Analyst, Quillstone    Feb 2020 - May 2022
"""
    out = read(text)["work"]
    assert [(j["title"], j["company"]) for j in out] == [
        ("Software Engineer", "Vellacor Robotics"),
        ("QA Analyst", "Quillstone"),
    ]
    assert out[0]["current"] is True
    assert "fleet dashboard" in out[0]["description"]


def test_dash_separated_title_and_company():
    text = """Work History
IT Specialist - Northvale Fitness - Mar 2022 to Present
Support Agent - Brightfold Labs - Jan 2020 to Feb 2022
"""
    assert jobs(text) == [
        ("IT Specialist", "Northvale Fitness"),
        ("Support Agent", "Brightfold Labs"),
    ]


def test_year_only_ranges_and_present_spellings():
    text = """EXPERIENCE
Network Technician | Kelso Labs | 2021 - Current
Field Technician | Quillstone | 2018 - 2021
"""
    out = read(text)["work"]
    assert out[0]["current"] is True and out[0]["start_year"] == 2021
    assert (out[1]["start_year"], out[1]["end_year"], out[1]["current"]) == (
        2018,
        2021,
        False,
    )


def test_heading_variants_for_skills_and_certifications():
    text = """Experience
Analyst | Kelso Labs | 2020 - 2022
Core Competencies
Excel • SQL • Power BI
Licenses & Certifications
CompTIA A+ (2021)
Vellacor Cloud Practitioner
"""
    out = read(text)
    assert out["skills"] == ["Excel", "SQL", "Power BI"]
    assert out["certifications"] == ["CompTIA A+ (2021)", "Vellacor Cloud Practitioner"]


def test_contact_line_links_become_websites():
    text = """Rowan Kestrel · rowan@example.com · linkedin.com/in/rowan-kestrel · github.com/rkestrel · rowan.dev/portfolio
EXPERIENCE
Developer | Kelso Labs | 2020 - 2022
Profiles
https://www.linkedin.com/in/rowan-kestrel
"""
    sites = read(text)["websites"]
    assert "https://linkedin.com/in/rowan-kestrel" in [
        s.replace("www.", "") for s in sites
    ]
    assert any("github.com/rkestrel" in s for s in sites)
    assert any("rowan.dev/portfolio" in s for s in sites)
    assert len({s.replace("www.", "").lower() for s in sites}) == len(
        sites
    )  # no duplicates


def test_education_degree_first_and_school_first():
    text = """EDUCATION
B.S. in Computer Science — Oregon State University (2016)
Lakeview Community College, Associate of Arts, 2012 - 2014
"""
    edu = read(text)["education"]
    assert edu[0]["school"] == "Oregon State University"
    assert edu[0]["degree"].lower().startswith("b.s")
    assert edu[0]["field_of_study"] == "Computer Science"
    assert edu[0]["end_year"] == 2016
    assert edu[1]["school"] == "Lakeview Community College"
    assert (edu[1]["start_year"], edu[1]["end_year"]) == (2012, 2014)


def test_wrapped_bullets_stay_with_their_job():
    text = """EXPERIENCE
Platform Engineer | Brightfold Labs | Mar 2023 - Present
- Moved onboarding to event-driven functions for 300 staff, with duplicate
  events handled safely and an audit trail
Support Analyst | Quillstone | Jan 2020 - Feb 2023
- Helped 200 users
"""
    out = read(text)["work"]
    assert "audit trail" in out[0]["description"]
    assert "audit trail" not in out[1]["description"]
    assert out[1]["company"] == "Quillstone"


def test_summary_and_projects_are_not_jobs():
    text = """SUMMARY
Engineer with 5 years building tools since 2019 - 2024 across teams.
EXPERIENCE
Engineer | Kelso Labs | 2019 - 2024
PROJECTS
Job Tracker | 2023 - 2024
"""
    assert jobs(text) == [("Engineer", "Kelso Labs")]


@pytest.mark.parametrize(
    "line",
    [
        "Analyst | Kelso Labs | Sep 2024 - Aug 2026",
        "Analyst | Kelso Labs | Sept 2024 – Aug 2026",
        "Analyst | Kelso Labs | September 2024 — August 2026",
        "Analyst | Kelso Labs | 09/2024 - 08/2026",
        "Analyst | Kelso Labs | Sep. 2024 to Aug. 2026",
    ],
)
def test_date_spellings(line):
    job = read("EXPERIENCE\n" + line)["work"][0]
    assert (
        job["start_month"],
        job["start_year"],
        job["end_month"],
        job["end_year"],
    ) == (9, 2024, 8, 2026)
