# Research: Scout results, levels and a smarter Claude (012)

## R1. Why company-site pages were never copied

**Found (live, read-only):** 36 page copies have ever been kept, all from
LinkedIn, Indeed or ZipRecruiter. Today's Local companies run reported 6 jobs
(3 on a Workday site, 3 on an Oleeo `tal.net` site). Claude called report_job
twice for each, about 9 seconds apart, and no copy arrived for any of them.

**What the code allows:**

- `scoutpage.js` runs on every https site.
- It asks the background whether a Google Jobs or Local companies run is going
  (`/runs/active` → `any_site`), and the backend answers correctly for a
  running Local run.
- `myworkdayjobs.com` counts as a jobs host. `tal.net` doesn't (only
  `taleo.net`), and its `/opp/…` path doesn't look like a job page, so Oleeo
  pages only count by their wording.
- Workday is a single-page app. The title comes from what the extractor finds,
  and there's no JobPosting JSON-LD until the page has drawn, so the extractor
  may find no title and no copy is sent.

**Other likely causes:**

- Chrome's copy of the extension wasn't reloaded after 007 added
  `scoutpage.js`. `extension/dist/` is ignored by the root `.gitignore` (its
  own `.gitignore` says it's committed), so every machine builds its own copy.
- Claude re-reports after about 9 seconds, before a slow careers site has
  drawn.

**Decision:**

1. Reproduce with the extension's Playwright harness on two saved fixtures (a
   Workday-style page that draws late, and an Oleeo-style page). Fix whichever
   step fails:
   - Add a title fallback: `og:title`, then the `h1`, then
     `[data-automation-id=jobPostingHeader]`.
   - Add `tal.net`, `oleeo` and other common hiring systems to the job hosts.
2. Give the copy more time: report_job's answer asks Claude to wait about 10
   seconds and re-report up to 3 times (not 2) before it's "not copied".
3. Add an "Extension" health line to the Last run card when a run had
   not-copied jobs: "The extension didn't copy N pages: reload it in
   chrome://extensions and refresh the tab."

**Result (built):** the Playwright harness reproduced it. A Workday-style page
that draws itself with no title tags produced no copy on the old code (0 sent)
and one on the new. The fixes: a title fallback (the hiring system's header,
the h1, og:title), the posting's own block for the text, the company from the
hiring-system subdomain, more hiring-system hosts, and the app matching
Workday links with or without their language part (`/en-US/…`) and Oleeo
links by their `/opp/` id.

**Alternatives rejected:** letting Claude send the job text. The safety rule
stays: saved jobs are the page's own words.

## R2. Showing a job whose page wasn't copied

**Decision:** report_job takes short facts Claude reads on the page:

- title (≤200 characters)
- company (≤120)
- location (≤120)
- level (`entry|mid|senior|lead`)
- years asked (0–30)
- posted (≤40, e.g. "2 days ago")
- in_area (bool)

These are stored on the finding and labelled "as Claude read it". They are
**never** the job text.

Saving still needs the page copy. "Open and Save" opens the posting, and the
extension's Save button saves it. That keeps 003's rule that My Jobs only holds
the page's own words. Results still shows the job, with its name, score and
link, so nothing is hidden.

**Alternative rejected:** saving from Claude's facts with an empty description.
AI Apply and cover letters read the description, so a job saved without one is
a trap.

## R3. Experience levels on LinkedIn

`f_E` is a comma-separated list: 1 internship, 2 entry, 3 associate, 4
mid-senior, 5 director, 6 executive. This comes from public notes and scraper
docs, not official LinkedIn documentation, so each run reports whether the
filter was dropped. 011's dropped-filter check already covers this.

- **Mapping:**
  - Entry → 2
  - Mid → 3, 4
  - Senior → 4, 5

  So Entry + Mid sends `f_E=2,3,4`. LinkedIn files most mid-level jobs as
  "Mid-Senior", so 4 has to be in, and the app's own level cap (below) keeps
  real senior roles out of Best.
- **Indeed / ZipRecruiter:** no dependable level parameter, so levels apply
  through scoring only.

Sources: [Kondo: LinkedIn job search URL hacks](https://www.trykondo.com/blog/linkedin-job-search-hacks); [LinkedIn job search URL parameters that still work](https://iamdheeraj0211.github.io/earlyapply/linkedin-job-search-url-parameters.html).

## R4. Making levels stick (not just a hint)

**Decision:** the app caps the band, so Best is guaranteed to be at the user's
level whatever Claude scores. A job whose reported level is above the chosen
levels, or whose years asked are more than the user's years + 2:

- one step above → at most `min_fit − 1` (Possible)
- two or more steps above (lead, manager, director, or years asked ≥ the
  user's years + 5) → at most `min_fit − 3` (Long shot)

The finding keeps Claude's score in `claude_fit`, and `app_note` says why it
was lowered ("Senior role: you chose Entry–Mid"). Order: entry < mid < senior
< lead.

## R5. Thin searches

**Decision:** when a search's `total_results` is under 25 and its window is
shorter than 7 days, the next link is the same search with the next window:
1 → 3 → 7 days on LinkedIn (`f_TPR`), Indeed (`fromage`) and ZipRecruiter
(`days`). This happens once per search per run. Already-seen jobs are skipped
as usual, and the run's links line says "widened to 3 days".

## R6. Related titles Claude suggests

**Decision:** a scoped resume type with no related titles gets
`suggest_titles: 4` in the brief. Claude calls `set_search_titles` (now allowed
for scoped runs, capped at 4 extra titles) before opening start_urls. The
answer returns the new start_urls.

The suggested titles are saved in `criteria.track.suggested` and shown on the
run, each with a **Keep** button that adds it to the type's related titles.
Titles must be at the chosen levels; the brief says so, and the app drops
titles with "senior", "lead", "principal", "manager" or "director" when Senior
isn't chosen.

## R7. Where the result groups are computed

**Decision:** on the server. GET /scout/findings returns each finding with its
`band` (best, possible or long_shot) worked out against its own run's
`min_fit`, plus its status (new, saved, passed, hidden). The phone and computer
then show the same thing, and tests cover it in one place.

## R8. Recommended settings

**Decision:** one constant in the backend (`RECOMMENDED`), served at GET
/scout/recommended and used as the default for new searches and types:

- 10 jobs per run
- past 7 days
- fit 6
- 25 miles
- degree rule off
- levels Entry + Mid

The app shows the differences from the current settings and applies them
through the existing PATCH calls. Skills fill from the resume using 011's
helper.
