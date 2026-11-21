# Feature Specification: Claude Scout casts a wider, correctly placed net

**Feature Branch**: `011-scout-wider-search`

**Created**: 2026-11-20

**Status**: Built

**Input**: The user's report after several near-empty LinkedIn runs (e.g. "6 results total, 1 new"): "The problem is the brief, not a lack of jobs." They asked for:

- no exact-phrase titles, plus related titles, with searches split into several links
- the degree skip rule made optional and off by default, and actually honoured
- a radius and location that LinkedIn really applies, with any radius up to at least 50 miles
- the 24-hour window kept, and no workplace or pay filter
- a way to fill in skills
- LinkedIn's result count per link in the run summary
- an audit of everything else that shrinks results

Builds on 003, 007, 008, 009 and 010.

## What was found (live settings and runs, read-only; code; public notes on LinkedIn's URLs)

1. **Exact phrases joined with OR.** Every title was wrapped in quotes and
   joined with OR in a single link, so close variants were missed (Systems
   Administrator, M365 Admin, IT Specialist…).
2. **The degree rule ignored the switch.** The switch on each resume type
   saves `degree_only` correctly, but the main steps told Claude to skip, or
   score 0–3, any job needing a degree with no "or equivalent", whatever the
   switch said. It also defaulted to on for every starter type, and all five of
   the user's types have it on.
3. **No radius and an unclear place.**
   - Both IT Admin searches have no radius, so no `distance` was sent. Only
     the Systems & Automation search has 25.
   - The place is plain text: "Beaverton", "beaverton", and in one search the
     typo "Beavrton".
   - Signed in, LinkedIn keeps only its numeric location ID (`geoId`) and drops
     the place text. With no ID, it falls back to a metro area (the "Portland,
     Oregon Metropolitan Area" the scout saw).
   - LinkedIn's own radius menu has 5 / 10 / 25 / 50 / 100 miles.
   - Public tests disagree on whether `distance` and `sortBy` still apply when
     signed in. `f_TPR` works. Nothing public confirms `start=` on the newer
     `/jobs/search-results/` page.
4. **Low scores hidden for good, and everywhere.** A job once scored "below
   your bar" was hidden from every later run, on every resume type, even after
   the rules that sank it changed. That covers 7 IT Admin jobs and 4 Systems
   jobs, several of which were likely capped by the degree rule.
5. **Harsh scoring.**
   - The rubric's "years/degree met" part let a missing degree cost points
     even when the posting accepts experience.
   - "Pay and location" could lose a point when pay isn't listed.
   - The degree rule forced 0–3.
6. **"Fits" judged narrowly.** Claude judged a title's fit against the
   resume type's exact titles, and those passes were remembered for 30 days.
7. **IT Admin had no skills**, so its scores rested on titles alone.
8. **Nothing showed how many results LinkedIn returned**, so a too-narrow
   search looked like "no new jobs".

## Requirements

- **FR-001 (titles)**: Each resume type gets *related titles* ("also search
  for") and an *exact titles only* switch, off by default.
  - With it off, every title gets its own link, with no quotes.
  - Each run searches up to the *searches per run* limit (1–10, default 6).
    Titles take turns across runs when there are more.
  - With it on, the run keeps one link with quoted titles joined by OR.
- **FR-002 (paging across links)**: A run reads up to *pages per search*
  (1–8, default 2) of each link, then moves to the next link. A page with
  nothing new ends that link, not the run. Jobs seen on an earlier link in the
  same run aren't offered twice.
- **FR-003 (degree)**:
  - `degree_only` defaults to off for new types.
  - When it's off, Claude scores the job normally and only lists the degree
    under gaps. It never skips the job or caps its score.
  - When it's on, the old rule applies.
  - The main steps follow the resume type's setting instead of hard-coding the
    rule.
- **FR-004 (place and radius)**:
  - The radius is any whole number of miles from 1 to 100. A search with a
    place but no radius uses 25.
  - LinkedIn and ZipRecruiter round up to their nearest option (5, 10, 25, 50,
    100). Indeed rounds up to 5, 10, 15, 25, 35, 50 or 100. Google gets the
    exact miles.
  - LinkedIn links always carry the place, its `geoId` once known,
    `distance`, `f_TPR` and `sortBy=DD`.
  - On the first page of a LinkedIn run, Claude checks the place LinkedIn
    shows. If it's wrong or there's no `geoId` yet, Claude sets the place in
    LinkedIn's location box and sends the page's address. The app saves the
    `geoId` on the search for every later run.
- **FR-005**: Keep `f_TPR=r86400` for "Today". No workplace filter unless the
  search asks for one. No pay filter unless the search or type sets a minimum.
- **FR-006 (skills)**: A resume type with no skills offers "Fill from my
  resume" on its card.
- **FR-007 (result counts)**:
  - With the first page of each link, Claude sends the result count LinkedIn
    shows and the address it landed on.
  - The finish summary, the run in History and its log list each link's
    count, and any link parameters LinkedIn dropped in its redirect.
- **FR-008 (what's hidden)**:
  - "Seen before" stays: jobs reported in a way the user decided on (picked,
    saved, passed on, already had).
  - A below-bar score only hides a job from runs of the same resume type, and
    only until that type's rules change.
  - A job that was only listed, never opened or reported, is never hidden.
- **FR-009 (titles that didn't fit)**: Each resume type shows how many titles
  Claude passed over, lists them, and has "Clear", which also lets that type's
  below-bar jobs be looked at again.
- **FR-010 (fair scoring)**:
  - The rubric's experience part counts experience as equal to a degree unless
    the posting strictly requires one and `degree_only` is on.
  - Pay not listed counts as met. Every workplace type is fine.
  - Claude judges "fits" as "a job the user could do going by the resume type
    and its related titles; when unsure, true".

## Success criteria

- **SC-001**: The IT Admin search produces one unquoted link per title, each
  with the place, `distance=25`, `f_TPR=r86400` and `sortBy=DD` (and `geoId`
  once found).
- **SC-002**: With `degree_only` off, the brief never tells Claude to skip or
  cap a job for a degree.
- **SC-003**: A run's summary states LinkedIn's result count for every link it
  read.
- **SC-004**: Clearing a type's passed titles and rules lets its earlier
  below-bar jobs show again.

## Out of scope

- Guessing LinkedIn's `geoId`s: they're learned from the page.
- Changing anyone's saved resume types: the user switches the degree rule
  off on their own types.
