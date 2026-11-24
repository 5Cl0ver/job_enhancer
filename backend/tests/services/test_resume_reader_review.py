"""Reader fixes from the spec 020 correctness review. Invented résumés."""

from app.services.resume_reader import read


def jobs(text):
    return [(j["title"], j["company"]) for j in read(text)["work"]]


def test_title_company_dates_on_three_lines():
    text = """EXPERIENCE
Data Analyst
Tidewell Health
Mar 2021 - Jun 2023
- Built dashboards
Support Specialist
Quillstone
Jan 2019 - Feb 2021
"""
    out = read(text)["work"]
    assert [(j["title"], j["company"]) for j in out] == [
        ("Data Analyst", "Tidewell Health"),
        ("Support Specialist", "Quillstone"),
    ]
    assert (out[0]["start_month"], out[0]["end_year"]) == (3, 2023)


def test_company_title_dates_on_three_lines():
    text = """WORK HISTORY
Kelso Labs
Systems Administrator
2020 - Present
"""
    assert jobs(text) == [("Systems Administrator", "Kelso Labs")]


def test_dates_split_over_two_lines():
    text = """EXPERIENCE
Network Engineer | Opaline Pay
Sep 2021 –
Jun 2023
"""
    out = read(text)["work"]
    assert out[0]["company"] == "Opaline Pay"
    assert (
        out[0]["start_month"],
        out[0]["start_year"],
        out[0]["end_month"],
        out[0]["end_year"],
    ) == (
        9,
        2021,
        6,
        2023,
    )


def test_shift_hours_and_prose_with_years_are_not_jobs():
    text = """EXPERIENCE
Front Desk Agent | Northvale Fitness | Mar 2020 - Present
Worked the 0800-1700 shift and opened the gym every weekday morning.
Grew membership every year from 2019 - 2021 by running sign-up drives with the local schools and clinics.
"""
    out = read(text)["work"]
    assert len(out) == 1
    assert out[0]["title"] == "Front Desk Agent"


def test_years_before_1950_are_not_dates():
    assert read("EXPERIENCE\nArchivist | Kelso Labs | 1901 - 1905\n")["work"] == []


def test_skills_keep_brackets_together():
    skills = read("SKILLS\nCloud: Azure (AD, Intune), AWS; Scripting: PowerShell\n")[
        "skills"
    ]
    assert "Azure (AD, Intune)" in skills
    assert "AWS" in skills
    assert "AD" not in skills and "Intune)" not in skills


def test_prose_with_a_bare_year_range_is_not_a_job():
    text = """EXPERIENCE
Records Clerk | Kelso Labs | Mar 2018 - Present
Managed migration of 2019-2020 records to the new system
Kelso Labs 2016 - 2018
"""
    out = read(text)["work"]
    assert [j["start_year"] for j in out] == [2018, 2016]


def test_open_end_date_continues_on_the_next_line():
    text = """EXPERIENCE
Platform Engineer | Brightfold Labs | Aug 2024 -
Present
Support Analyst | Quillstone | 2021 –
2024
"""
    out = read(text)["work"]
    assert out[0]["current"] is True and out[0]["start_month"] == 8
    assert (out[1]["start_year"], out[1]["end_year"]) == (2021, 2024)
