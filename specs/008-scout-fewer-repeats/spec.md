# Feature Specification: Claude Scout finds new jobs, not the same ones again

**Feature Branch**: `feat/scout-linkedin-fresh`
**Created**: 2026-11-20
**Status**: Built
**Input**: The user: "LinkedIn search getting same jobs over and over, nothing
new. What can we do to fix?"

Builds on [003-job-scout](../003-job-scout/spec.md) and
[007-local-companies](../007-local-companies/spec.md).

## What was going on

A counts-only look at the user's runs: five "Today" LinkedIn runs in one day,
each reading only page 1 of the results (about 25 rows). The app already
skipped jobs a run had *reported*, but most rows were ones Claude passed over
by their title, and those weren't remembered, so every run weighed the same
rows again. Every run also used the same search words.

## User Scenarios & Testing

### User Story 1 — Titles that don't fit are remembered (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a results page, **When** Claude sends its rows, **Then** each row
   says whether its title fits the resume type; the ones that don't are
   remembered for that resume type.
2. **Given** a later run for the same resume type, **When** the same job comes
   up (same link, or same company and title), **Then** it's skipped as seen
   before, without Claude weighing it again.
3. **Given** another resume type, **Then** it still weighs those jobs (a title
   that doesn't fit one may fit another).
4. **Given** 30 days have passed, **Then** the job is weighed again.
5. **Given** a job Claude opened and passed over on the skip rules (degree,
   years), **Then** Claude reports it with a low score, so no run opens it
   again.

### User Story 2 — More than page 1 (Priority: P1)

1. **Given** a LinkedIn, Indeed or ZipRecruiter run, **When** a page is
   checked, **Then** the app hands Claude the next page's link, up to 4 pages
   a run. The same page sent twice isn't counted twice.
2. **Given** a Local companies run, **Then** each company's openings aren't
   counted as pages.

### User Story 3 — Different titles each run (Priority: P2)

1. **Given** a resume type with more than 4 titles, **When** runs start,
   **Then** each one asks for the next 4, wrapping around.

### User Story 4 — Why it came back short (Priority: P2)

1. **Given** a finished search that found fewer than asked, **Then** under the
   numbers ("… 12 titles didn't fit …") one tip says what to change: give it a
   day or widen "Posted" (most were seen before), add titles to the resume
   type (most didn't fit), or widen "Posted" / a bigger radius (results ran
   out).

## Requirements

- **FR-001**: `check_jobs` rows take `"fits"`; rows with `"fits": false` are
  kept in `scout_passes` (user, resume type, company/title/link keys only, never
  job text) and are skipped as titles that didn't fit for 30 days, or until
  the resume type's titles, skills or skip rules change.
- **FR-002**: `check_jobs` returns `pages_read` and `next_page_url`; a run
  reads at most 4 pages. A page with nothing new (empty, or only rows from
  earlier pages) means the results ran out: Claude is told to finish.
- **FR-003**: Runs of one search take turns with the resume type's titles, 4 at
  a time.
- **FR-004**: A run shows "titles didn't fit" in its numbers and a one-line tip
  when it came back short.

## Out of scope

Changing LinkedIn's sort order, and searching more than 4 pages a run.
