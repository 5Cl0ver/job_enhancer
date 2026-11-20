---
description: "Task list for 009: Claude Scout finds better jobs"
---

# Tasks: Claude Scout finds better jobs

**Input**: Design documents from `/specs/009-scout-smarter-search/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Included. The constitution (V. Test-Driven Confidence) requires them for every critical path. Within each story, write the tests first and see them fail.

**Organization**: Grouped by user story, so each story can be built and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md
- Paths are from the repository root (`backend/`, `frontend/`)

---

## Phase 1: Setup

**Purpose**: Version and instruction files that every story builds on.

- [X] T001 Bump `PLAYBOOK_VERSION` to `2026.11.6` in backend/app/services/scout_runs.py
- [X] T002 [P] Create backend/app/scout/broad.md with the broad steps (research R3, R6), and load it as `BROAD_STEPS` in backend/app/services/scout_runs.py

---

## Phase 2: Foundational (blocks every story)

**Purpose**: The one migration and the model fields all stories use.

- [X] T003 Write the migration in backend/alembic/versions/g5b6c7d8e9f1_scout_broad_search.py (revises `f4a5b6c7d8e0`):
  - `resume_tracks.kind` (default `'scoped'`)
  - `scout_missions.overrides` (JSON, nullable)
  - `scout_findings.search_title` and `closest_track_id` (FK SET NULL)
  - new `scout_titles` table with unique (`mission_id`, `title_key`), the `user_id` index, and RLS on Postgres
- [X] T004 [P] Add `kind` to `ResumeTrack` in backend/app/models/resume_track.py
- [X] T005 [P] Add `ScoutMission.overrides`, `ScoutFinding.search_title` / `closest_track_id` and a new `ScoutTitle` model in backend/app/models/scout.py; register `ScoutTitle` in backend/app/models/__init__.py
- [X] T006 [P] Migration test (SQLite round trip from f4a5b6c7d8e0 and offline Postgres SQL, including RLS and no DROP on upgrade) in backend/tests/test_migration_scout_broad.py
- [X] T007 Run the migration up, down and up on the trial Postgres copy with /c/Users/fabia/job-enhancer-trial/bin/alembic_scout.py

**Checkpoint**: the schema is in place; existing tests still pass.

---

## Phase 3: User Story 1 — Every job is scored against my real resume (P1) 🎯 MVP

**Goal**: Each run tells Claude to read the active resume through `get_master_profile` and score against it. The page notes when there's no resume, and flags resume types with no skills.

**Independent Test**: The brief for an existing scoped search has `resume_ready: true`, and the playbook and `next` say to call `get_master_profile` first. With no resume, `resume_ready: false` and the run still works. Resume types with no skills are flagged.

### Tests for User Story 1

- [X] T008 [P] [US1] Connector tests in backend/tests/test_scout_resume_grounding.py:
  - the brief's `resume_ready` with and without an active resume that has text (an inactive or empty resume counts as none)
  - `next` names `get_master_profile` only when `resume_ready`
  - the brief stays under 6,000 characters
  - no resume text appears in `run.criteria`, `run.stats` or findings
- [X] T009 [P] [US1] Vitest in frontend/tests/components/ScoutStart.test.tsx (no-resume note on the Start page) and frontend/tests/components/ResumeTypes.test.tsx ("no skills listed" flag)

### Implementation for User Story 1

- [X] T010 [US1] Add a `resume_ready(db, user_id)` helper (an active `Resume` with non-blank `extracted_text`) in backend/app/services/scout_runs.py; add `resume_ready` to `brief`, and put "call get_master_profile once, then …" at the front of `next` when it's true
- [X] T011 [US1] Update backend/app/scout/playbook.md:
  - a new step 1: "if resume_ready, call get_master_profile once and score every job against it; credit only what it shows"
  - "why it fits" names at least one resume item
  - the fallback when there's no resume
- [X] T012 [P] [US1] Show the "Upload your resume for better scores" note with a link when `useResumes()` has no active resume, in frontend/src/components/scout/ScoutStart.tsx
- [X] T013 [P] [US1] Show the "No skills listed — add some, or rely on your uploaded resume" flag on each resume type with empty `key_skills` in frontend/src/components/scout/ResumeTypes.tsx

**Checkpoint**: US1 works on its own; deployable as the MVP.

---

## Phase 4: User Story 2 — "Anything I'd be good at" (P1)

**Goal**: A broad search where Claude chooses the titles, the app builds the links and remembers how each title did, and good fits carry the closest resume type and go to "Claude's picks".

**Independent Test**:
- Create a broad LinkedIn mission and queue it.
- The brief has no `start_urls`, but has `titles_tried` and `resume_types`.
- `set_search_titles` returns a LinkedIn link with those titles and the mission's filters.
- `report_job` with `resume_type` sets the closest track and credits a title.
- A second run's brief shows the counts.
- With no resume, queueing returns 422.

### Tests for User Story 2

- [X] T014 [P] [US2] Service and connector tests in backend/tests/test_scout_broad.py:
  - the hidden broad track: created once, not listed, doesn't count toward 8, its name is reserved, PATCH and DELETE return 404
  - a broad mission ignores `track_id`
  - queueing without a resume returns 422
  - the brief's shape
  - `set_search_titles`: normalising, duplicates, the cap of 8, an empty result returns an error, fixed after the first `check_jobs`, works on Local companies
  - `search_titles` / `start_urls` / `page_url` use the run's titles
  - `report_job` `resume_type`: matched without regard to case; an unknown name counts as none
  - a good fit is credited to the title with the most words in common
  - resting after 3 empty runs, within 14 days
  - "Claude's picks" as the default collection
  - saving tags the closest track
- [X] T015 [P] [US2] API tests in backend/tests/api/test_scout_broad_api.py:
  - POST and PATCH missions with `broad`
  - `MissionOut.broad`
  - GET /tracks hides the broad track
  - POST runs returns 422 with no resume
  - `RunOut.titles` / `broad`, and `FindingOut.closest_track_name`
- [X] T016 [P] [US2] Vitest in frontend/tests/components/ScoutStart.test.tsx: the "Anything I'd be good at" choice, a broad mission's summary line, and the closest resume type in frontend/tests/components/RunReview.test.tsx

### Implementation for User Story 2

- [X] T017 [US2] In backend/app/services/scout_tracks.py:
  - `list_tracks` and the track limit and name checks use scoped tracks only
  - `BROAD_NAME`
  - `broad_track(db, user_id)` (get or create)
  - `get_track` for the page returns 404 for a broad track on PATCH and DELETE
- [X] T018 [US2] Add `broad` to `MissionCreate`, `MissionUpdate` and `MissionOut` (with `track_id` optional when broad) and the `place_problem` check in backend/app/schemas/scout.py; add `titles` and `broad` to `RunOut` and `closest_track_name` to `FindingOut`
- [X] T019 [US2] Create backend/app/services/scout_titles.py:
  - `RESTING_RUNS=3`, `REST_DAYS=14`, `MAX_TITLES=8`
  - `choose(db, run, titles)` (Always first; drops Never, resting and duplicates; cap; returns kept and dropped)
  - `record_runs`
  - `credit_fit(db, run, finding)` (the most-words-in-common rule)
  - `tried(db, mission_id, limit)`
  - `is_resting`
- [X] T020 [US2] In backend/app/services/scout_runs.py:
  - `create_mission` / `update_mission` resolve the broad track
  - `queue_run` sets `criteria["broad"]` and blocks with no resume
  - `search_titles(c)` returns `c["search_titles"]` for broad runs
  - `brief` broad keys: `broad_steps`, `titles_tried`, `resume_types`, `max_titles`, an empty `start_urls`, and `next`
  - a new `set_search_titles(db, user_id, run_id, titles)`
  - `report_job(resume_type=…)` sets `closest_track_id` and calls `credit_fit` on a good fit
  - `runs_out` fills `titles` and `closest_track_name`
- [X] T021 [US2] Add the `set_search_titles` tool and `report_job`'s `resume_type` argument, with descriptions as in contracts/connector-tools.md, in backend/app/mcp_server.py
- [X] T022 [US2] In backend/app/services/scout_review.py, `default_folder_name` returns "Claude's picks" for broad criteria, and saving a broad finding uses `closest_track_id` as the saved job's track
- [X] T023 [US2] Accept `broad` on POST and PATCH /missions, and map 422 on POST /missions/{id}/runs, in backend/app/api/v1/scout.py
- [X] T024 [P] [US2] Add the `broad`, `titles` and `closest_track_name` types, `BROAD_NAME`, and mission summary text in frontend/src/lib/scout.ts
- [X] T025 [US2] Add the "Anything I'd be good at" choice in the resume-type picker (sends `broad: true`), with a hint and the no-resume block, in frontend/src/components/scout/ScoutStart.tsx
- [X] T026 [P] [US2] Show "Closest: IT Admin" on each broad good fit in frontend/src/components/scout/RunReview.tsx and frontend/src/components/scout/RunFindings.tsx
- [X] T027 [US2] Run the trial-Postgres check (rolled back) from quickstart.md, step 2, with a script in the session scratchpad

**Checkpoint**: US1 and US2 both work; a broad search runs end to end.

---

## Phase 5: User Story 3 — I can override Claude (P2)

**Goal**: The Always, Never and Avoid lists on a broad search, applied from the next run.

**Independent Test**:
- Set overrides with PATCH.
- Queue a run.
- `set_search_titles` keeps the Always title first and drops the Never title.
- `check_jobs` counts an Avoid word as excluded.
- Changing overrides mid-run doesn't change the running run.

### Tests for User Story 3

- [X] T028 [P] [US3] Tests in backend/tests/test_scout_broad.py (an `Overrides` class):
  - the list limits and tidying (422 past 20 entries or 80 characters)
  - a snapshot at queue time
  - Always first and never resting
  - Never dropped as `never_search`, also when the case differs
  - Avoid words merged into `skip.exclude` and counted as "excluded"
  - clearing the lists restores Claude-only choices
- [X] T029 [P] [US3] Vitest in frontend/tests/components/BroadOverrides.test.tsx: add and remove in each list, save sends PATCH `overrides`, phone-size touch targets

### Implementation for User Story 3

- [X] T030 [US3] Add the `Overrides` schema (three lists, limits, tidying) and `overrides` on the mission schemas in backend/app/schemas/scout.py
- [X] T031 [US3] In backend/app/services/scout_runs.py, `queue_run` snapshots overrides into criteria and merges Avoid into `track.skip.exclude`; the brief returns `always`, `never` and `avoid`
- [X] T032 [US3] Create frontend/src/components/scout/BroadOverrides.tsx (three chip lists with add and remove, shown in the mission editor when broad), and wire it into frontend/src/components/scout/ScoutStart.tsx

**Checkpoint**: overrides change what the next run does.

---

## Phase 6: User Story 4 — I can see what Claude searched for (P2)

**Goal**: "Claude searched for" in History with one-tap pin, block and add to resume type, and a "Titles tried" list in the search settings.

**Independent Test**:
- GET /missions/{id}/titles lists titles with runs, good fits and resting.
- In History, a broad run shows its titles and counts.
- Tapping "Add to resume type" PATCHes that track's titles.
- Pin and block PATCH the mission's overrides.

### Tests for User Story 4

- [X] T033 [P] [US4] API test for GET /missions/{id}/titles (sorting, `resting` / `always` / `never` flags, 404 for a scoped mission or another user's mission) in backend/tests/api/test_scout_broad_api.py
- [X] T034 [P] [US4] Vitest in frontend/tests/components/RunTitles.test.tsx: titles with counts; pin, block and add to resume type each send the right PATCH; works at phone width

### Implementation for User Story 4

- [X] T035 [US4] Add the GET /missions/{id}/titles route (using `scout_titles.tried`) in backend/app/api/v1/scout.py and its response schema in backend/app/schemas/scout.py
- [X] T036 [P] [US4] Add a `useMissionTitles(missionId)` hook in frontend/src/hooks/useScout.ts
- [X] T037 [US4] Create frontend/src/components/scout/RunTitles.tsx ("Claude searched for:" rows with good fits; Always / Never / Add to resume type actions, with a resume-type picker); show it in frontend/src/components/scout/ScoutHistory.tsx for broad runs
- [X] T038 [US4] Add a folded "Titles tried" list (runs, good fits, Resting tag) to frontend/src/components/scout/BroadOverrides.tsx

**Checkpoint**: all four stories work.

---

## Phase 7: Polish & cross-cutting

- [X] T039 [P] Update the manifests: backend/app/services/MANIFEST.md (scout_titles, scout_runs, scout_tracks), backend/app/models/MANIFEST.md (ScoutTitle, the new fields), frontend/src/components/MANIFEST.md (BroadOverrides, RunTitles)
- [X] T040 [P] Update the "How Claude Scout Works" diagram page (artifact) with the broad search and resume scoring
- [X] T041 Run the full checks from quickstart.md: pytest, ruff, tsc, eslint, vitest, vite build
- [ ] T042 Open the PR, run an independent review, fix the findings, wait for CI, then ask the user before merging (the migration goes live on merge)
- [ ] T043 After the merge and deploy, run the by-hand checks in quickstart.md with the user

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T007)** → user stories.
- **US1** (T008–T013) depends only on Foundational and is the MVP.
- **US2** (T014–T027) depends on Foundational. It uses US1's `resume_ready` (T010) for the 422 check, so do it after US1.
- **US3** (T028–T032) depends on US2 (broad missions and `set_search_titles`).
- **US4** (T033–T038) depends on US2 (title memory). It can run alongside US3, except that T038 edits BroadOverrides.tsx from T032.
- **Polish** comes last.

## Parallel examples

- **Foundational**: T004, T005 and T006 together (different files), then T003 and T007.
- **US1**: T008 and T009 together; then T012 and T013 alongside T010 and T011.
- **US2**: T014, T015 and T016 together; then T024 and T026 alongside the backend work T017–T023.
- **US3 and US4**: T028, T029, T033 and T034 together.

## Implementation strategy

1. **MVP**: Setup, Foundational and US1. Scoring against the resume fixes the "can't find 8s" problem for the searches the user already has.
2. **Main ask**: US2, the broad search.
3. **Control**: US3 and US4, overrides and what Claude searched for.
4. All four ship in one PR (one migration), with tests per story. The PR is reviewed and the user approves the merge.
