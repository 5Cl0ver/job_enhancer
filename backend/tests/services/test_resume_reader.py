"""The built-in résumé reader (spec 020, R2): jobs, schools, skills,
certifications and links from a résumé's text, with no AI. Invented people."""

from app.services.resume_reader import read

PIPES = """Wren Calloway | (555) 010-2299 | wren@example.com | linkedin.com/in/wren-calloway | github.com/wrencal
EXPERIENCE
Platform Engineer (Cloud & Tooling) | Brightfold Labs | Sep 2024 - Aug 2026
- Rebuilt onboarding on serverless functions for 300 staff
- Ran CI/CD and zero-downtime migrations
IT Support Technician | Brightfold Labs | Oct 2022 - Sep 2024
- Cut laptop setup from hours to under one hour
Support Analyst | Quillstone | Aug 2021 - Oct 2022
- Phone and web support
SKILLS
Endpoints: Windows 10/11, macOS, Intune
Scripting: PowerShell, Python, SQL, TypeScript
CERTIFICATIONS & EDUCATION
Vellacor Builder Certified, Vellacor University, 2024
Portland Community College, A.S. Computer Science, 2019
"""

DOTS = """Ash Morrow
Work History
Data Analyst · Tidewell Health    Mar 2023 – Present
• Built weekly dashboards
Junior Analyst · Kelso Labs    Jan 2020 – Feb 2023
Education
Bachelor of Science in Statistics, Oregon State University, 2019
Skills: Excel, SQL, Tableau
"""

TWO_LINE = """PROFESSIONAL EXPERIENCE
Opaline Pay — Software Engineer II
June 2021 - Present
- Shipped React front ends
Quillstone
Support Specialist    2018 - 2021
EDUCATION
Lakeview College, B.A. Economics, 2014 - 2018
"""


def test_pipes_format_reads_every_job_in_order():
    out = read(PIPES)
    jobs = out["work"]
    assert [j["title"] for j in jobs] == [
        "Platform Engineer (Cloud & Tooling)",
        "IT Support Technician",
        "Support Analyst",
    ]
    first = jobs[0]
    assert first["company"] == "Brightfold Labs"
    assert (first["start_month"], first["start_year"]) == (9, 2024)
    assert (first["end_month"], first["end_year"], first["current"]) == (8, 2026, False)
    assert "Rebuilt onboarding" in first["description"]
    assert "zero-downtime" in first["description"]
    assert jobs[2]["company"] == "Quillstone"


def test_pipes_format_skills_certifications_schools_and_links():
    out = read(PIPES)
    assert {
        "Windows 10/11",
        "macOS",
        "Intune",
        "PowerShell",
        "Python",
        "SQL",
        "TypeScript",
    } <= set(out["skills"])
    assert "Endpoints" not in out["skills"]
    assert out["certifications"] == [
        "Vellacor Builder Certified, Vellacor University, 2024"
    ] or any("Vellacor Builder Certified" in c for c in out["certifications"])
    schools = [s["school"] for s in out["education"]]
    assert "Portland Community College" in schools
    pcc = next(
        s for s in out["education"] if s["school"] == "Portland Community College"
    )
    assert pcc["end_year"] == 2019
    assert pcc["field_of_study"] == "Computer Science"
    assert "https://linkedin.com/in/wren-calloway" in out["websites"]
    assert "https://github.com/wrencal" in out["websites"]


def test_dot_format_with_present_and_inline_skills():
    out = read(DOTS)
    jobs = out["work"]
    assert jobs[0]["title"] == "Data Analyst"
    assert jobs[0]["company"] == "Tidewell Health"
    assert jobs[0]["current"] is True
    assert jobs[0]["end_year"] is None
    assert jobs[1]["company"] == "Kelso Labs"
    assert out["skills"] == ["Excel", "SQL", "Tableau"]
    osu = out["education"][0]
    assert osu["school"] == "Oregon State University"
    assert osu["degree"].lower().startswith("bachelor")
    assert osu["end_year"] == 2019


def test_two_line_jobs_put_title_and_company_right():
    out = read(TWO_LINE)
    jobs = out["work"]
    assert jobs[0]["title"] == "Software Engineer II"
    assert jobs[0]["company"] == "Opaline Pay"
    assert jobs[0]["current"] is True
    assert (jobs[0]["start_month"], jobs[0]["start_year"]) == (6, 2021)
    assert jobs[1]["title"] == "Support Specialist"
    assert jobs[1]["company"] == "Quillstone"
    assert (jobs[1]["start_year"], jobs[1]["end_year"]) == (2018, 2021)
    lake = out["education"][0]
    assert (lake["start_year"], lake["end_year"]) == (2014, 2018)


def test_nothing_is_invented_from_empty_or_odd_text():
    assert read("") == {
        "work": [],
        "education": [],
        "skills": [],
        "certifications": [],
        "websites": [],
    }
    out = read("Just a paragraph about me with no sections at all.")
    assert out["work"] == [] and out["education"] == []
