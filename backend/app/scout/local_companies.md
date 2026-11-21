This is a LOCAL COMPANIES search: no job boards at all. You look for jobs on
the companies' own websites. These steps replace playbook steps 3 and 4; the
rest of the playbook holds.

a. If the brief lists "recheck" companies, visit those first: open the
   careers_url if one is given, else the website, and look at their openings.
b. Open each start URL (a Google search for businesses near the user). Read
   the companies it lists, the map list and the plain results, as
   {"name", "website"}. Send them in ONE call to check_companies. Leave out
   job boards, directories and review sites.
c. For each company check_companies returns in "visit": open its website and
   find its Careers / Jobs / Join us / Employment page (often in the menu or
   the footer). It may run on a hiring system (Workday, Greenhouse, Paylocity,
   UKG, iCIMS…): that's still the company's own page.
d. Read its openings as rows ({"company", "title", "url", "fits"}), send them
   to check_jobs, open the ones it returns, and report_job each one as usual,
   while the posting is open.
e. Then call company_checked with the company's website and what you found:
   "openings", "none", or "no_careers" (plus the careers page link, if any).
   With "openings", send openings too: every job the careers page lists (up
   to 20) as {"title", "url", "fit"}, fit null for the ones you didn't open.
   Jobs at offices outside the brief's area are in_area false.
f. Stop when report_job says done, or check_companies says the company limit
   is reached, or the start URLs run out of new companies. Then
   finish_scout_run.

Never use Indeed, LinkedIn, ZipRecruiter, Glassdoor or any other job board,
even when a company's site links to one: report only the company's own pages.
Company pages often show no date: report a job unless it's clearly older than
the search's "posted within" days.
