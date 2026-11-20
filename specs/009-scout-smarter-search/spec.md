# Feature Specification: Claude Scout finds better jobs — scored against your real resume, and an "Anything I'd be good at" search

**Feature Branch**: `009-scout-smarter-search`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User description: "I'm limiting myself. The potential of Claude in
Chrome is amazing, it should be able to find me anything I'd be good at, not
just exactly what I scoped. Scoped is fine, but also broad: what does Claude
think is going to be good for me?" And: "Let Claude do its thing, but give me
the option to override if necessary, to tweak it." Near misses (jobs scored a
little under the minimum, shown unticked) are wanted; they are not the problem.

Builds on [003-job-scout](../003-job-scout/spec.md),
[007-local-companies](../007-local-companies/spec.md) and
[008-scout-fewer-repeats](../008-scout-fewer-repeats/spec.md). The phone rule
from 005 holds: everything here works on a phone as on a computer.

## Why

From the user's live runs (scores and settings only): asking for a fit of 8 or
more for "IT Admin", Claude only found jobs it scored 5–7. Three causes:

1. **Claude never reads the user's actual resume during a Scout run.** It
   scores each posting against the resume type's short lists (titles, skills,
   notes) only. The user's full resume is already in the app, but a run never
   uses it.
2. **The "IT Admin" resume type has no skills listed.** Skills are 4 of the 10
   points, so against an empty list an 8 is close to impossible.
3. **The net is narrow by design.** A search only asks for the few titles the
   user typed. Jobs the user would be good at under other names (adjacent
   roles) are never searched for. (008 already widened each run to 4 pages and
   rotating titles.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Every job is scored against my real resume (Priority: P1)

Whatever search the user runs, Claude judges each posting against the user's
own resume (experience, skills, education, certifications), plus the resume
type's titles and skills, with the same 0–10 scoring. A resume type with an
empty skills list still gets fair scores, because the resume itself carries
the skills.

**Why this priority**: It fixes the scoring for every search the user already
has, with no new habits, and it's what a broad search depends on.

**Independent Test**: Run the existing "IT Admin" search (no skills listed)
for a posting that matches the user's resume well; the score reflects the
resume, and Claude's "why it fits" names something from the resume.

**Acceptance Scenarios**:

1. **Given** a resume type with no skills listed and an uploaded resume,
   **When** Claude scores a posting that asks for skills the resume shows,
   **Then** those skills count toward the score and "why it fits" names them.
2. **Given** an uploaded resume, **When** Claude scores a posting, **Then** it
   never credits experience, employers, dates or skills the resume doesn't
   have.
3. **Given** no resume uploaded, **When** a scoped search runs, **Then** it
   scores against the resume type as it does today, and the search page says
   that uploading a resume gives better scores.
4. **Given** a resume type with no skills listed, **When** the user opens
   Resume types, **Then** it says so and suggests adding skills (or relying on
   the uploaded resume).

---

### User Story 2 — "Anything I'd be good at" (Priority: P1)

Next to the resume types, a search can be set to **Anything I'd be good at**.
On each run, Claude reads the user's resume and decides which job titles to
search for, including adjacent roles the user may not have thought of (e.g.
IT admin experience also fits "IT support specialist", "Microsoft 365
administrator", "identity and access analyst"). It tells the app those titles;
the app builds the search link for the chosen job site with the user's own
settings (where, radius, how recent, remote) and remembers which titles were
tried and how each one did. Nothing needs approving: the run just goes.

**Why this priority**: This is the user's main ask: let Claude find anything
they'd be good at instead of only what they scoped.

**Independent Test**: Make a LinkedIn search set to "Anything I'd be good at",
press Start and say the usual line. Claude searches titles it chose from the
resume, the results land in the usual review, and History lists the titles it
searched. A second run tries different titles as well as the ones that worked.

**Acceptance Scenarios**:

1. **Given** a broad search and an uploaded resume, **When** a run starts,
   **Then** Claude chooses the titles to search from the resume, and the app
   builds the search links; Claude never changes the user's filters.
2. **Given** a broad search and no uploaded resume, **When** the user tries to
   start it, **Then** the app says a resume is needed first and links to where
   to upload one.
3. **Given** earlier runs of the same broad search, **When** a new run starts,
   **Then** Claude is told which titles were tried and how many good fits each
   gave; it keeps the titles that found good fits and adds at least two it
   hasn't tried, while it can still think of new ones.
4. **Given** a title tried in 3 runs that found no good fit, **When** the next
   runs start, **Then** that title is rested for 14 days unless the user pinned
   it.
5. **Given** a broad search, **When** Claude reports a good fit, **Then** the
   review shows which of the user's resume types it's closest to (or "none"),
   and saving files it with that resume type so applying uses the right resume.
6. **Given** a broad search, **When** good fits are found, **Then** they go to
   the search's chosen collection, by default one named "Claude's picks".
7. **Given** a broad search on Local companies, **When** it runs, **Then** the
   Google searches for local businesses use Claude's titles in place of the
   resume type's.

---

### User Story 3 — I can override Claude when I want to (Priority: P2)

Claude decides on its own by default. In the search's settings the user can
step in, and every run follows these:

- **Always search** titles: searched on every run, first.
- **Never search** titles: never sent to the job site, even if Claude picks
  them.
- **Avoid** words or kinds of role (e.g. "sales", "call center",
  "Director"): rows with these words are skipped without being opened.

**Why this priority**: The user wants Claude to work on its own, with a way to
tweak it only when something looks off.

**Independent Test**: Add "Help Desk Technician" to Never search and "sales"
to Avoid. On the next run, neither is searched and no row with "sales" in the
title is opened.

**Acceptance Scenarios**:

1. **Given** a title in Always search, **When** a run starts, **Then** it is
   among the titles searched, whatever Claude picks.
2. **Given** a title in Never search, **When** Claude picks it, **Then** the
   app leaves it out and Claude is told why.
3. **Given** a word in Avoid, **When** a results row's title has it, **Then**
   the row is skipped and counted in the run's numbers as "had a word you
   skip".
4. **Given** the user changes any of these, **When** the next run starts,
   **Then** it follows the new settings; a run already going is not changed.
5. **Given** the user empties all three lists, **Then** Claude decides
   everything on its own again.

---

### User Story 4 — I can see what Claude searched for, and keep what works (Priority: P2)

Each broad run's History shows **Claude searched for:** with each title and how
many good fits it found. From there the user can pin a title (Always search),
block it (Never search), or add it to one of their resume types with one tap.

**Why this priority**: Seeing what was tried is how the user knows Claude is
doing the right thing, and when to step in.

**Independent Test**: Open a finished broad run in History on a phone; the
titles and their counts show, and "Add to resume type" puts a title into
"IT Admin".

**Acceptance Scenarios**:

1. **Given** a finished broad run, **When** the user opens it in History,
   **Then** every title searched shows with its count of good fits, in two
   taps or fewer from Find Jobs.
2. **Given** a title in that list, **When** the user taps Add to resume type
   and picks one, **Then** the title is added to that resume type's titles.
3. **Given** a title in that list, **When** the user taps Always or Never,
   **Then** it goes to that list in the search's settings.
4. **Given** the broad search's settings, **Then** a "Titles tried" list shows
   every title used so far, with runs, good fits, and whether it's resting.

---

### Edge Cases

- **No resume uploaded:** scoped searches work as today with a "better scores
  with a resume" note; a broad search can't start until one is uploaded.
- **Several resumes:** the one marked active is used.
- **Claude sends no titles, or only blocked ones:** the app uses the Always
  search titles; if there are none, it tells Claude to choose others and the
  run doesn't start a search with no titles.
- **Claude sends too many titles:** the app keeps the Always titles plus
  Claude's first ones up to the per-run limit, and says which were left out.
- **A title close to a blocked one** (different case or punctuation): treated
  as the same title.
- **Same job found by a scoped search and a broad search:** it's only offered
  once (008's memory covers every search).
- **Titles that didn't fit:** in a broad search they're remembered for the
  user's broad searches, not for a resume type.
- **The resume changes:** the next run uses the new one; titles already tried
  keep their history.
- **Near misses:** jobs scored a little under the minimum still show, unticked,
  in the review (unchanged).

## Requirements *(mandatory)*

### Functional Requirements

**Scoring against the resume**

- **FR-001**: Every Scout run MUST give Claude the user's active resume and
  profile to score against, together with the resume type's titles and skills.
- **FR-002**: Claude's instructions MUST say to credit only what the resume or
  profile shows, and to name at least one resume item in "why it fits".
- **FR-003**: The resume MUST be given to Claude only through the user's own
  signed-in connector, and MUST NOT be stored in run records, findings or logs.
- **FR-004**: With no resume uploaded, scoped searches MUST run as today and
  the search page MUST say a resume gives better scores.
- **FR-005**: The Resume types page MUST flag a resume type with no skills.

**The broad search**

- **FR-006**: A search MUST be settable to "Anything I'd be good at" in place
  of a resume type, on all five sources.
- **FR-007**: A broad search MUST NOT start without an uploaded resume; the app
  MUST say why and where to upload one.
- **FR-008**: On a broad run, Claude MUST send the titles it chose to the app,
  and the app MUST build the search links with the user's own filters.
- **FR-009**: A broad run MUST search at most 8 titles, Always titles first; it
  still reads at most 4 results pages in total (as in 008).
- **FR-010**: The app MUST remember, per broad search, every title tried: runs,
  good fits, and when last tried.
- **FR-011**: Each broad run's brief MUST tell Claude the titles tried and their
  good fits, and ask for at least two new titles while Claude can think of
  them.
- **FR-012**: A title tried in 3 runs with no good fit MUST rest for 14 days,
  unless it's in Always search.
- **FR-013**: Each good fit from a broad search MUST carry the closest resume
  type (or none), chosen by Claude; saving MUST file it with that resume type.
- **FR-014**: A broad search's good fits MUST go to its chosen collection, by
  default one named "Claude's picks".

**Overrides**

- **FR-015**: Each broad search MUST have three editable lists: Always search,
  Never search, Avoid words.
- **FR-016**: The app MUST drop Never search titles from what's searched, and
  MUST skip rows whose titles contain an Avoid word, counting them in the run's
  numbers.
- **FR-017**: Changes MUST apply from the next run; a run already going keeps
  the settings it started with.

**Visibility**

- **FR-018**: A broad run's History MUST list each title searched with its good
  fits.
- **FR-019**: From that list the user MUST be able to pin a title, block it, or
  add it to a resume type, each in one tap plus a choice.
- **FR-020**: The broad search's settings MUST show a "Titles tried" list (runs,
  good fits, resting or not).

**Unchanged**

- **FR-021**: Everything stays per account: no user sees or changes another's
  searches, titles or lists.
- **FR-022**: The review step, near misses shown unticked, one Save, and the
  memory from 008 (findings, titles that didn't fit, pages) MUST work the same
  for broad searches.
- **FR-023**: Everything MUST work the same on a phone as on a computer.

### Key Entities

- **Broad search**: a saved search whose resume type is "Anything I'd be good
  at"; carries the three override lists and its collection.
- **Title tried**: per broad search and title: runs it was searched in, good
  fits found, last tried, resting until.
- **Run's titles**: the titles one run searched, after overrides, with good
  fits per title (shown in History).
- **Closest resume type**: on a good fit from a broad search, the user's
  resume type it fits best, or none.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the user's existing scoped searches, every good fit's "why it
  fits" names at least one item from the user's resume.
- **SC-002**: Over the first 3 runs of a broad search, at least 8 different
  titles are searched, and no title that found nothing is searched in all 3.
- **SC-003**: The user can see every title a broad run searched within 2 taps
  of Find Jobs, on a phone.
- **SC-004**: 100% of runs started after an override change follow it (Never
  titles not searched, Avoid words not opened, Always titles searched).
- **SC-005**: Within the user's first 5 broad runs, at least one good fit comes
  from a title that isn't in any of their resume types.
- **SC-006**: The resume never appears in stored run records or findings.

## Assumptions

- "Resume" means the user's active uploaded resume plus their application
  profile, the same source the connector already uses for drafting.
- Claude in Chrome is trusted to choose sensible titles; the app's role is to
  remember, limit and apply the user's overrides, not to second-guess Claude.
- Limits (8 titles a run, 3 empty runs then 14 days of rest, at least 2 new
  titles a run) are starting values the user can later see and change on the
  Instructions page (010).
- Scoped searches keep working exactly as now apart from the better scoring.
- The 0–10 rubric and the minimum fit stay as they are.

## Out of scope

- The Instructions page to view, edit and reset everything Claude is told, and
  the per-run log of every message between Claude and the app (spec 010).
- Claude choosing filters (where, radius, how recent): those stay the user's.
- Searching job sites other than the five Scout already uses.
