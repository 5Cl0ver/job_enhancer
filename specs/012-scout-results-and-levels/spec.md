# Feature Specification: Scout results you can see, sort and act on, at your level

**Feature Branch**: `012-scout-results-and-levels`

**Created**: 2026-11-20

**Status**: Draft

**Input**: The user, after a day of runs that brought back almost nothing usable:

- "I want some more entry and mid level jobs, I don't get why this is so hard."
- "I need to be able to know what I'm looking for, what the last run was, organize best ones, worst ones or possible ones."
- "When I use the Claude extension [on its own] I always get good jobs. What are you feeding Claude that it's not working?"
- "Fix all of this UI/UX, and make Claude smarter when finding me jobs."

Builds on 003, 007, 008, 009, 010 and 011.

## What was found (live runs and settings, read-only; code)

1. **Runs stop after 2 jobs.** The user's searches ask for 2 jobs, so Claude
   stops at the second fit ("Hit the target of 2 picks").
2. **A tiny window.** The searches are set to "posted today", and today's
   IT Admin search had 19 results in all.
3. **No idea of level.** Nothing tells Claude the user wants entry and
   mid-level roles. It brings back senior roles (10 years required, managing
   a team) and scores them 6 as a "stretch".
4. **Results are hard to find.** Start only shows a finished run while it has
   picks waiting, and the card stays there until saved. A run with nothing over
   the bar shows nothing on Start, so it looks like nothing happened. History
   lists jobs per run only; there's no single place to see every job found,
   best first.
5. **Jobs vanish when the page copy fails.** The extension has never copied a
   page from a company careers site: every one of 36 copies ever kept came
   from the three job boards. Today's Local companies run reported 6 jobs
   (one scored 8), and all 6 became "not copied", with no title or company.
6. **No location check outside the job boards.** The Local companies run
   reported jobs in Alabama and California for a Beaverton search.
7. **"Had openings" says nothing usable.** It means the careers page listed
   jobs, not that any fit; the jobs Claude saw aren't listed or linked.
8. **The user's settings work against them.** These are the user's own
   settings, changed only by them or with their OK: the degree rule is still
   on, IT Admin has no skills or related titles, and the place reads
   "Beaverton" with no state or radius.

## User scenarios

### US1 (P1) — One place to see every job Scout found, best first

The user opens **Results** and sees every job Scout brought back, in three
groups:

- **Best**: at or over their bar.
- **Possible**: up to 2 points under the bar.
- **Long shots**: the rest, folded away.

Each job shows its title, company, place, level, when it was posted, Claude's
score with why and gaps, and which search found it. It can be opened, saved to
My Jobs, or passed on. Filters: the last run or all runs, by resume type, and
New / Saved / Passed. It sorts by best fit or newest.

**Acceptance**:

- After any run, the jobs it found are in Results within one refresh, grouped
  by score.
- A job whose page wasn't copied still shows its title, company and link, with
  "Open and Save".
- Saving or passing a job moves it out of New.
- It works the same on phone and computer.

### US2 (P1) — Know what I'm looking for, and what the last run did

Start shows, for each search, one plain line of what it looks for, e.g.
"Entry–mid IT Admin jobs · Beaverton, OR + 25 mi · past week · fit 6+".

After any run, a **Last run** card stays on Start until the next run. It shows:

- when the run happened and what it searched (titles, place, window)
- how many jobs were looked at, and how many were best, possible or long shots
- how many were hidden as repeats and how many weren't copied
- Claude's note
- a **See results** button that opens Results on that run

The old "pick what to keep" card is replaced by a single "N new jobs waiting →
Review" line, so nothing gets stuck.

**Acceptance**:

- Every finished run, even one with nothing found, shows a Last run card with
  its numbers.
- The waiting line counts New jobs at Best or Possible and opens Results.

### US3 (P1) — Entry and mid-level jobs

Each resume type has a **Level** choice: Entry, Mid, Senior (any mix). It
defaults to Entry and Mid, and has an optional "Years of experience" (the user
has about 5).

- LinkedIn searches add its experience filter for the chosen levels.
- Claude is told the levels and years:
  - a job at the chosen level can score full marks
  - one step up is a stretch, at most Possible
  - lead, manager, principal or director roles, or ones asking for clearly more
    years than the user has, are Long shots
- Each job shows the level Claude read from the posting.

**Acceptance**:

- With Entry + Mid, the LinkedIn links carry the matching experience filter.
- A posting asking for 10 years never lands in Best for a user with 5 years.

### US4 (P1) — Settings that find jobs

A **Use recommended settings** button on each search and resume type sets:

- 10 jobs per run
- posted within the past week
- fit 6+ for Best
- 25 miles, with the place in "City, ST" form
- the degree rule off
- skills filled from the resume

Before applying, it shows exactly what changes. New searches start with these.

### US5 (P2) — Claude gets smarter, not just stricter

- **Names always.** With every job, Claude sends the title, company, place,
  level and posting date it reads on the page. These are short facts, never the
  job text, and they're shown even if the page copy fails.
- **Too far is caught.** A job outside the search's place and radius (and not
  remote) is marked "Too far" and doesn't count. This applies to every source.
- **Thin searches widen themselves.** If a search finds fewer than 25 results in
  its window, the app gives Claude the same search with the next window (today
  → 3 days → week), and the run says so.
- **Related titles from the resume.** When a resume type has no related titles,
  Claude suggests up to 4 entry/mid titles from the resume for that run. They
  are shown on the run, and each can be kept with one tap.

### US6 (P2) — Local companies that actually help

- Copying pages from company careers sites works (Workday, Taleo and the like),
  checked with the extension's test harness.
- "Had openings" is reworded ("Has jobs listed"). Each company lists the
  openings Claude saw, as tappable links, with a fit where Claude scored one.

## Requirements

- **FR-001**: A Results view lists every finding of the user's runs, grouped
  Best / Possible / Long shots against each run's own bar, with filters (run,
  resume type, New/Saved/Passed) and sorting (fit, newest).
- **FR-002**: Every finding shows title, company and link, even without a page
  copy. Saving still needs the page's own words: without a copy, "Open and
  Save" opens the posting so the extension saves it (research R2).
- **FR-003**: Start shows a plain summary line per search, a Last run card for
  the latest finished run, and one waiting line in place of per-run review cards.
- **FR-004**: Resume types gain `levels` (Entry/Mid/Senior, default
  Entry+Mid) and an optional `years`. Both are sent to Claude and used in
  scoring. LinkedIn links add the experience filter for the chosen levels.
- **FR-005**: report_job accepts short facts (title, company, location, level,
  posted), each length-capped. The safety rule against sending job text stays.
- **FR-006**: A location check marks findings outside the search's place,
  radius and remote rule as Too far, so they don't count toward the target.
- **FR-007**: A search with fewer than 25 results in its window gets a widened
  repeat (up to a week), at most once per search per run.
- **FR-008**: Recommended settings exist, are shown before applying, and are
  the defaults for new searches and types. Existing settings change only when
  the user presses the button.
- **FR-009**: Scoped resume types without related titles let Claude suggest up
  to 4 per run, shown on the run, each keepable with one tap.
- **FR-010**: Company-site page copying is diagnosed and fixed. Companies keep
  the openings Claude saw (title, link, up to 20).
- **FR-011**: Phone and computer show the same features. No horizontal scroll.

## Success criteria

- **SC-001**: After a run, the user can find its best job in 2 taps from Start.
- **SC-002**: No job Claude reports is hidden. Every finding is in Results
  with a name and a link.
- **SC-003**: With recommended settings and Entry+Mid, a LinkedIn IT Admin run
  brings back up to 10 jobs, with none needing a lot more experience than the
  user has in Best.
- **SC-004**: Every run, including an empty one, shows its numbers on Start.

## Out of scope

- Auto-applying, or saving jobs without the user.
- Changing the user's saved settings without them pressing the button (or
  saying so).
- New job boards.
