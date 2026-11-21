# Tasks: Scout results you can see, sort and act on, at your level

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/api.md](contracts/api.md),
[quickstart.md](quickstart.md)

**Tests**: requested (constitution V, plan "tests first"). Each story writes its
tests before its code.

## Phase 1: Setup

- [X] T001 Migration `j8e9f0a1b2c4_scout_results_levels` in backend/alembic/versions/j8e9f0a1b2c4_scout_results_levels.py (resume_tracks `levels`/`years`; scout_findings `location`/`level`/`years_asked`/`posted`/`in_area`/`claude_fit`/`facts_from`/`passed_at`; scout_companies `last_openings`), plus backend/tests/test_migration_scout_results.py

## Phase 2: Foundational

- [X] T002 Model columns and `FindingOutcome.TOO_FAR` in backend/app/models/scout.py and backend/app/models/resume_track.py
- [X] T003 `RECOMMENDED` constant and level helpers (`LEVELS`, `level_rank`, `linkedin_f_e`) in backend/app/services/scout_levels.py

## Phase 3: US1 — One place to see every job (P1)

**Independent test**: GET /scout/findings on existing findings returns Best / Possible / Long shot groups with counts; passing a finding moves it out of New.

- [X] T004 [P] [US1] Tests for bands, statuses, list filters, cursor, pass, save of picked, user scoping in backend/tests/test_scout_results_levels.py
- [X] T005 [US1] `scout_results.py`: `band()`, `status_of()`, `list_findings()`, `pass_finding()` in backend/app/services/scout_results.py
- [X] T006 [US1] Schemas `FindingItem`, `FindingPage` in backend/app/schemas/scout.py
- [X] T007 [US1] Routes GET /findings, POST /findings/{id}/pass; /findings/{id}/save accepts picked (409 without copy) in backend/app/api/v1/scout.py and backend/app/services/scout_review.py
- [X] T008 [P] [US1] Types, `useFindings`, `usePassFinding`, band labels in frontend/src/lib/scout.ts and frontend/src/hooks/useScout.ts
- [X] T009 [US1] Results tab component (groups, filters, sort, Open / Save / Pass, Long shots folded) in frontend/src/components/scout/ScoutResults.tsx with frontend/src/components/scout/ScoutResults.test.tsx
- [X] T010 [US1] Fifth tab "Results" (short labels on phone) and `?view=results&run=` in frontend/src/components/scout/ScoutPanel.tsx

## Phase 4: US2 — What I'm looking for, and the last run (P1)

**Independent test**: after any finished run (even empty) Start shows a Last run card with its numbers and See results; the waiting line counts New Best+Possible.

- [X] T011 [P] [US2] Tests for RunOut `bands`, `hidden`, `not_copied` in backend/tests/test_scout_results_levels.py
- [X] T012 [US2] RunOut extras (`bands`, `hidden`, `not_copied`, `suggested_titles`, `widened`) in backend/app/schemas/scout.py and backend/app/services/scout_runs.py
- [X] T013 [P] [US2] `lookingFor()` plain line helper with tests in frontend/src/lib/scout.ts and frontend/src/lib/scout.test.ts
- [X] T014 [US2] Last run card + waiting line in frontend/src/components/scout/LastRun.tsx with frontend/src/components/scout/LastRun.test.tsx
- [X] T015 [US2] Start uses the plain line, the Last run card and the waiting line instead of per-run review cards in frontend/src/components/scout/ScoutStart.tsx

## Phase 5: US3 — Entry and mid-level jobs (P1)

**Independent test**: an Entry+Mid LinkedIn run's start_urls carry `f_E=2%2C3%2C4`; a senior fit-9 report is lowered to `min_fit − 1`.

- [X] T016 [P] [US3] Tests: levels on tracks (PATCH validation), f_E in links, level/years cap, brief `levels`/`years`/`level_rule` in backend/tests/test_scout_results_levels.py
- [X] T017 [US3] Track schemas `levels`/`years` and PATCH in backend/app/schemas/scout.py and backend/app/services/scout_tracks.py
- [X] T018 [US3] Snapshot levels/years in criteria, f_E on LinkedIn links, `level_rule` in the brief, cap in report_job in backend/app/services/scout_runs.py
- [X] T019 [US3] Rubric/playbook text for levels in backend/app/services/scout_instructions.py, backend/app/scout/playbook.md
- [X] T020 [US3] Level chips and years in frontend/src/components/scout/ResumeTypes.tsx; level shown on Results rows

## Phase 6: US4 — Settings that find jobs (P1)

**Independent test**: GET /scout/recommended returns the constant; the dialog lists differences and applies them only on press.

- [X] T021 [P] [US4] Test GET /recommended and new-mission defaults in backend/tests/test_scout_results_levels.py
- [X] T022 [US4] GET /recommended route; MissionCreate defaults from `RECOMMENDED` in backend/app/api/v1/scout.py and backend/app/schemas/scout.py
- [X] T023 [US4] Recommended dialog (diff, apply via existing PATCH) in frontend/src/components/scout/Recommended.tsx with frontend/src/components/scout/Recommended.test.tsx; buttons on Start searches and resume types

## Phase 7: US5 — A smarter Claude (P2)

**Independent test**: report_job with facts stores them; `in_area=false` → too_far; a thin 1-day search's next link widens to 3 days; a scoped type with no related titles gets `suggest_titles: 4`.

- [X] T024 [P] [US5] Tests: facts stored and capped, too_far not counted and remembered, 3 reports before no_copy, widening, suggest_titles and scoped set_search_titles, senior titles dropped in backend/tests/test_scout_results_levels.py and backend/tests/test_mcp_scout.py
- [X] T025 [US5] report_job facts, in_area → too_far, 3 tries in backend/app/services/scout_runs.py and backend/app/mcp_server.py
- [X] T026 [US5] check_jobs widening (1 → 3 → 7 days) recorded in `_links` in backend/app/services/scout_runs.py
- [X] T027 [US5] `suggest_titles` in the brief and scoped set_search_titles saving `criteria.track.suggested` in backend/app/services/scout_runs.py and backend/app/mcp_server.py
- [X] T028 [US5] Playbook/rules: facts, in_area, longer copy wait, suggestions in backend/app/scout/playbook.md and backend/app/scout/rules.md (bump `PLAYBOOK_VERSION`)
- [X] T029 [US5] Suggested titles with Keep, widened note in frontend/src/components/scout/RunTitles.tsx and frontend/src/components/scout/ScoutHistory.tsx

## Phase 8: US6 — Local companies that help (P2)

**Independent test**: the extension copies a Workday-style late-drawing page and an Oleeo-style page in the Playwright harness; a company keeps the openings Claude saw.

- [X] T030 [P] [US6] Fixtures + unit tests for the title fallback and hiring hosts in extension/src/scoutCapture.test.js and a late-drawing Workday-style page in extension/e2e/extension.spec.js
- [X] T031 [US6] Title fallback (og:title, h1, Workday header) and hosts (tal.net, oleeo, others) in extension/src/scoutCapture.js
- [X] T032 [US6] company_checked `openings` → `last_openings` in backend/app/services/scout_companies.py and backend/app/mcp_server.py, with tests
- [X] T033 [US6] "Has jobs listed" + openings links in frontend/src/components/scout/ScoutCompanies.tsx; extension health line on the Last run card

## Phase 9: Polish

- [X] T034 Full checks: backend pytest + ruff, frontend vitest + tsc + eslint + vite build, extension vitest + build
- [X] T035 Trial Postgres flow per quickstart.md
- [X] T036 Independent review, fixes, PR; merge only after the user's OK

## Dependencies

- T001 → T002 → everything else. T003 before US3/US4.
- US1 before US2 (Last run's See results opens Results).
- US3 before US4 (recommended sets levels).
- US5 and US6 after US1 (facts and openings appear in Results / Companies).

## Parallel examples

- US1: T004 and T008 together (backend tests, frontend types).
- US3: T016 with T020's UI once T017's schema is set.

## Strategy

MVP is US1 + US2 (see every job, see the last run). US3 and US4 fix what is
searched. US5 and US6 make each run bring back more. All ship in one PR.
