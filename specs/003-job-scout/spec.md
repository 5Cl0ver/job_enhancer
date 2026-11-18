# Feature Specification: Job Scout — resume tracks + browser-agent job hunting

**Feature Branch**: `003-job-scout`
**Created**: 2026-11-18
**Status**: Draft
**Input**: User description: use Claude in Chrome (a browser agent that clicks
around like a person) to find jobs on boards we can't scrape (LinkedIn, Indeed…)
and on little-known local company sites; organise the search around a handful of
resume "tracks"; keep the app aware of every job and company already seen so no
run repeats work; show it all on one clean, intuitive page.

## Why

Two time sinks today:

1. **Resumes.** The user qualifies for ~5 kinds of role (business analyst, IT
   admin / Jira admin, IT systems & automation engineer, identity/endpoint, junior
   software developer) and rewrites a resume each time they switch between them.
2. **Searching.** Boards block scraping, and the best local openings sit on small
   company career pages nobody browses. Driving Claude in Chrome by hand works,
   but every run starts from zero: it re-finds jobs already saved and re-checks
   companies checked yesterday.

## User Scenarios & Testing

### User Story 1 — Resume tracks (Priority: P1)

The user keeps one resume per kind of role ("track"): its target titles, key
skills, things to skip, minimum pay, and the resume file itself. Every job the
scout finds is tagged with the track it fits, so applying means picking up the
right resume, not rewriting one.

**Independent test**: create 5 tracks, attach a resume to each, open a saved
job and see which track (and resume) it belongs to.

**Acceptance**:
1. Given no tracks, when the user opens Claude Scout, then they can add five
   suggested types in one click (Business Analyst, IT Admin, Systems &
   Automation Engineer, Identity & Endpoint, Junior Developer) or make their own.
2. Given a track with an attached resume, when a scout job is saved for that
   track, then the job shows the track and offers that resume for applying.
3. A user can have up to 8 tracks; names are unique per user.

### User Story 2 — Build a mission, copy one prompt, get deduplicated jobs (P1)

On the Scout page the user picks a **source** (LinkedIn, Indeed, ZipRecruiter,
Glassdoor, or "Local companies"), a **track**, **how many** jobs (default 5),
**posted within** (today / 3 / 7 / 14 days), **minimum pay**, **where**
(commute zone, remote rule) and a **minimum fit** (0–10). The app shows a short
prompt to paste into Claude in Chrome. The agent then talks to the app through
the existing connector: it fetches the brief (criteria, what to skip), reports
each job with a fit score and reasons, and the jobs land in the app.

**Independent test**: build a LinkedIn mission for one track, run the prompt in
Claude in Chrome, see 5 new jobs in the app with fit scores; run the same mission
again and get 0 repeats.

**Acceptance**:
1. A job already in the tracker, or reported by any earlier run (even one the
   user dismissed), is never saved again — same company + same title, or the
   same posting URL.
2. Each reported job has: track, source, fit score 0–10, why it fits, gaps,
   posted date (or "not listed"), pay (or "not listed"), the direct posting link
   and the posting's full text.
3. Jobs under the mission's minimum fit are recorded as "seen, below bar" (so
   they aren't re-reported) but not added to the tracker.
4. The agent can never mark a job applied.
5. The run shows live on the page: started, jobs found so far, finished.

### User Story 3 — Local company log (P2)

For the "Local companies" source, the app remembers every company the scout has
looked at: careers page, hiring system (Workday, Greenhouse, …), last checked,
outcome, and whether it ever had a fitting job ("hot"). Each run's brief tells
the agent which known companies are due again and to add ~10 new ones; the user
can block a company so it's never suggested.

**Acceptance**:
1. A company checked in the last 3 days is not due unless it's hot.
2. The agent logs every company it checks, even with no fit.
3. The user can see, sort and block companies on the page.

### User Story 4 — Review and showcase (P3)

A results view per run: jobs best-first with fit, track and source; companies
checked; a running tally (jobs found per run, how many applied to, which track
and source produce the best fits). "Not for me" on a job teaches the skip list.

### Edge cases

- The agent reports a job whose link is a search page → rejected with a reason;
  the agent is told to send the posting link.
- The agent loses the connector mid-run → the run stays "in progress" and can be
  resumed with the same prompt (the brief returns what's already been reported).
- Two runs at once → each has its own id; dedupe is across all runs.
- Board blocks the agent / CAPTCHA → the agent finishes the run early with a
  note; partial results are kept.

## Requirements

- **FR-001** Tracks: CRUD; fields: name, target titles, key skills, skip rules
  (free text + structured: no degree-only, max years, excluded keywords), min
  pay, attached resume (existing Resume record), notes.
- **FR-002** Missions: saved, reusable search setups (source, track, count,
  posted window, min pay, location rule, min fit, extra instructions).
- **FR-003** Runs: each launch of a mission creates a run with a short
  copy-paste prompt naming the run id; status pending → running → done/stopped.
- **FR-004** Connector tools for the agent: get brief, check/report job, log
  company, finish run (contracts/mcp-tools.md). All are scoped to the signed-in
  user, validated, and cannot change pipeline stages.
- **FR-005** Dedupe across tracker + all scout findings (incl. dismissed) by
  normalised company+title and by canonical posting URL.
- **FR-006** Company log with due/hot/blocked logic for local runs.
- **FR-007** Lives in the existing Search area, which is renamed **Find Jobs**
  (`/search`). It gets two tabs: **Job boards** (today's API search, unchanged)
  and **Claude Scout** (`/search?tab=scout`). Claude Scout has four views:
  **Start** (pick or build a search, copy the prompt, watch it live), **History**
  (past runs and what each found), **Companies** (local company log) and
  **Resume types** (the tracks, each with its own resume file). Usable on phone
  and desktop.
- **FR-008** The agent's instructions (the "scout playbook") live in the repo,
  versioned, and are served by the brief — not pasted by the user.
- **FR-009** Exact listings: every saved Scout job's title, company, location,
  pay, posted date, link and full description are copied from the posting
  itself (Job Catcher extension capture, or the employer's Greenhouse/Lever/Ashby
  feed). Nothing in them is written or reworded by AI. Without a copy, the job
  is not saved. Claude's fit, reasons and gaps are stored apart and labelled.
- **FR-010** Small context: the user's prompt is one fixed line; no connector
  reply grows with the size of the tracker or company log; Claude never sends job
  text to the app; runs are small and resumable in a fresh chat (research R8).

## Success Criteria

- **SC-001** A repeat run of the same mission saves 0 duplicate jobs.
- **SC-002** From opening Scout to having a prompt copied: under 30 seconds for
  a saved mission.
- **SC-003** Every saved scout job has a fit score, a track and a direct link.
- **SC-004** The user stops rewriting resumes per application: each scout job
  points at one of their track resumes.
- **SC-005** A saved Scout job's description matches the posting word for word.
- **SC-006** A 5-job run fits in under ~60k tokens of chat context, and the
  1,000th run's brief is the same size as the first.

## Out of scope (for now)

- The app itself browsing or scraping any site (the agent runs in the user's own
  browser, under the user's own eye).
- Auto-applying to the jobs Scout finds — the next feature, which will use
  each job's resume type. Scheduling runs without the user present.
- Generating the 5 resumes from scratch (AI Quick Apply can tailor later).
