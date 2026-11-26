"""A PDF's wrapped lines become whole points again (spec 029, bug 1).

A PDF breaks a bullet over several lines; the reader used to keep the breaks,
lose the second half of a sentence when it was short, glue the next bullet on,
drop the bullet marks and cut the last point mid-word. Invented people."""

from app.services.resume_reader import read

WRAPPED = """EXPERIENCE
Software Engineer | Northwind Labs | Mar 2023 - Present
• Built an event pipeline on serverless functions triggered by
Northwind CRM webhooks, with retries and a dead-letter queue for failed events.
• Kept every secret in a managed key store, with the audit trail in
Cloud Logbook.
• Built a secure payroll API integration used by 300 staff every week.
Support Engineer | Contoso Retail | Jan 2020 - Feb 2023
•Ran a support chatbot on a hosted bot service with a key store, a blob store,
a queue and a small SQL database behind it, for every store in the region.
• Routed every support request through the help desk and an omni-
channel inbox for the forty agents on the team, day and night.
"""


def test_wrapped_lines_join_back_into_their_sentence():
    jobs = read(WRAPPED)["work"]
    assert [j["company"] for j in jobs] == ["Northwind Labs", "Contoso Retail"]
    assert jobs[0]["description"].split("\n") == [
        "• Built an event pipeline on serverless functions triggered by Northwind CRM "
        "webhooks, with retries and a dead-letter queue for failed events.",
        "• Kept every secret in a managed key store, with the audit trail in "
        "Cloud Logbook.",
        "• Built a secure payroll API integration used by 300 staff every week.",
    ]


def test_a_word_broken_at_the_line_end_is_whole_again():
    second = read(WRAPPED)["work"][1]["description"].split("\n")
    assert second[0].startswith("• Ran a support chatbot")
    assert second[0].endswith("for every store in the region.")
    assert "omni-channel inbox" in second[1]
    assert second[1].endswith("day and night.")


def test_points_without_bullet_marks_split_at_sentence_ends():
    text = """WORK HISTORY
Data Analyst | Tidewell Health | Mar 2021 - Present
Built weekly dashboards for the clinic managers and the finance team using
SQL and Excel.
Cut report time from two days to two hours.
"""
    desc = read(text)["work"][0]["description"]
    assert desc.split("\n") == [
        "Built weekly dashboards for the clinic managers and the finance team "
        "using SQL and Excel.",
        "Cut report time from two days to two hours.",
    ]


def test_a_bullet_mark_on_its_own_line_still_counts():
    text = """EXPERIENCE
Help Desk Technician | Quillstone | 2018 - 2020
•
Reset passwords and set up laptops.
•
Wrote the team's how-to guides.
"""
    desc = read(text)["work"][0]["description"]
    assert (
        desc
        == "• Reset passwords and set up laptops.\n• Wrote the team's how-to guides."
    )


def test_the_next_jobs_title_is_never_glued_onto_the_last_point():
    text = """EXPERIENCE
Opaline Pay — Software Engineer II
June 2021 - Present
- Shipped React front ends
Quillstone
Support Specialist    2018 - 2021
- Answered 40 tickets a day
"""
    jobs = read(text)["work"]
    assert jobs[0]["description"] == "• Shipped React front ends"
    assert (jobs[1]["title"], jobs[1]["company"]) == (
        "Support Specialist",
        "Quillstone",
    )


def test_a_long_description_ends_at_a_whole_point_never_mid_word():
    point = (
        "Moved forty services to containers with zero downtime and full rollback plans."
    )
    text = "EXPERIENCE\nEngineer | Kelso Labs | 2019 - 2021\n" + "\n".join(
        f"- {point}" for _ in range(40)
    )
    desc = read(text)["work"][0]["description"]
    assert len(desc) <= 2000
    assert all(line == f"• {point}" for line in desc.split("\n"))


def test_one_huge_point_is_cut_at_a_space():
    line = " ".join(["platform"] * 9)
    wrapped = "\n".join([line] * 40)  # one point wrapped over 40 lines
    text = f"EXPERIENCE\nEngineer | Kelso Labs | 2019 - 2021\n- {wrapped}\n"
    desc = read(text)["work"][0]["description"]
    assert len(desc) <= 2000
    assert desc.endswith("platform")


def test_the_place_under_the_job_line_is_its_location():
    text = """EXPERIENCE
Platform Engineer | Brightfold Labs | Mar 2023 - Present
Portland, OR
- Ran the build servers
"""
    job = read(text)["work"][0]
    assert job["location"] == "Portland, OR"
    assert job["description"] == "• Ran the build servers"


def test_a_wrapped_sentence_is_never_taken_as_the_next_company():
    """Review repro: the end of a sentence over "Title  dates" with the company
    on the line under it."""
    text = """EXPERIENCE
Platform Engineer | Northwind Labs | Mar 2020 - Jan 2023
• Kept every secret in a managed key store, with the audit trail in
Cloud Logbook.
Data Analyst Feb 2018 - Dec 2019
Contoso Retail
• Built the weekly sales dashboards.
"""
    first, second = read(text)["work"]
    assert first["description"] == (
        "• Kept every secret in a managed key store, with the audit trail in "
        "Cloud Logbook."
    )
    assert (second["title"], second["company"]) == ("Data Analyst", "Contoso Retail")
    assert second["description"] == "• Built the weekly sales dashboards."


def test_the_title_under_company_and_dates():
    text = """EXPERIENCE
Kelso Labs | 2019 - 2021
Support Engineer
- Answered 40 tickets a day
"""
    [job] = read(text)["work"]
    assert (job["title"], job["company"]) == ("Support Engineer", "Kelso Labs")


def test_a_new_point_after_a_full_line_is_not_glued_on():
    text = """EXPERIENCE
Site Reliability Engineer | Tidewell Health | 2021 - 2024
Ran the on-call rotation and the incident reviews for eight EKS clusters
Mentored 3 junior engineers
Cut paging noise by half with better alert rules and runbooks for the team
"""
    desc = read(text)["work"][0]["description"]
    assert desc.split("\n") == [
        "Ran the on-call rotation and the incident reviews for eight EKS clusters",
        "Mentored 3 junior engineers",
        "Cut paging noise by half with better alert rules and runbooks for the team",
    ]


def test_a_company_ending_inc_is_still_taken_as_the_next_jobs_name():
    text = """EXPERIENCE
Analyst | Kelso Labs | 2019 - 2021
- Built reports
Support Engineer
Northwind Labs, Inc.
2021 - 2023
"""
    second = read(text)["work"][1]
    assert (second["title"], second["company"]) == (
        "Support Engineer",
        "Northwind Labs, Inc.",
    )


def test_a_line_about_the_job_is_never_its_company():
    """Verification: "Team lead for payments" under "Title  dates" was taken
    as the company (and typed into Workday). Blank is better than wrong."""
    text = """EXPERIENCE
Software Engineer Mar 2020 - Jan 2023
Team lead for payments
• Built the refunds service.
"""
    [job] = read(text)["work"]
    assert job["company"] == ""
    assert job["description"] == "Team lead for payments\n• Built the refunds service."


def test_company_names_under_the_job_line():
    for name in ["Bank of America", "Contoso Retail", "Procter & Gamble"]:
        text = (
            f"EXPERIENCE\nData Analyst Feb 2018 - Dec 2019\n{name}\n- Built reports\n"
        )
        assert read(text)["work"][0]["company"] == name, name


def test_names_that_look_like_verbs_are_names():
    """ "United Rentals" and "Applied Materials" start like "Mentored…"."""
    for name in ["United Rentals", "Applied Materials"]:
        text = (
            f"EXPERIENCE\nData Analyst Feb 2018 - Dec 2019\n{name}\n- Built reports\n"
        )
        assert read(text)["work"][0]["company"] == name, name
        # Taken back from the job above as the next job's company, too.
        above = (
            "EXPERIENCE\nAnalyst | Kelso Labs | 2015 - 2017\n- Built reports\n"
            f"{name}\nTechnician    2018 - 2021\n"
        )
        second = read(above)["work"][1]
        assert (second["title"], second["company"]) == ("Technician", name), name
