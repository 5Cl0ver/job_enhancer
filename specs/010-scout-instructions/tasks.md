---
description: "Task list for 010: the Instructions page and the run log"
---

# Tasks: See and control everything Claude Scout is told

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/rest-api.md](contracts/rest-api.md)

**Tests**: Included (Constitution V).

## Format: `[ID] [P?] [Story] Description`

Stories US1–US5 are from spec.md. Paths are from the repository root.

---

## Phase 1: Setup

- [ ] T001 Bump `PLAYBOOK_VERSION` to `2026.11.7` in backend/app/services/scout_runs.py
- [ ] T002 Move the always-apply rules from backend/app/scout/playbook.md into a new backend/app/scout/rules.md, and take the rubric line out of the playbook (research R2)

## Phase 2: Foundational

- [ ] T003 Write the migration backend/alembic/versions/h6c7d8e9f0a2_scout_instructions_and_log.py: create `scout_instruction_versions` and `scout_run_events`, with indexes and RLS on Postgres
- [ ] T004 [P] Add `ScoutInstructionVersion` and `ScoutRunEvent` to backend/app/models/scout.py and register both in backend/app/models/__init__.py
- [ ] T005 [P] Migration test in backend/tests/test_migration_scout_instructions.py (SQLite round trip, offline Postgres SQL)
- [ ] T006 Run the migration up, down and up on the trial Postgres copy

## Phase 3: US1 + US2 + US3 — See, edit and lock (P1) 🎯 MVP

- [ ] T007 [P] [US2] Service tests in backend/tests/test_scout_instructions.py:
  - originals and current values
  - save, reset and restore, with history limited to 20
  - validation: text length, rubric adds up to 10, limits in range
  - `original_changed`
  - per user only
- [ ] T008 [P] [US3] Tests that the brief always ends with the locked rules after any edit, and that a run keeps its snapshot after a later edit and in a new chat, in backend/tests/test_scout_instructions.py
- [ ] T009 [P] [US2] Tests that the limits apply: pages stop `check_jobs`, titles cap `set_search_titles`, companies cap `check_companies`. In backend/tests/test_scout_instructions.py
- [ ] T010 [P] [US1] API tests in backend/tests/api/test_scout_instructions_api.py:
  - GET returns the sections, the locked rules and the tools
  - PUT, reset, history and restore
  - 422 cases
  - 404 for an unknown key and for another user's version
- [ ] T011 [US2] Create backend/app/services/scout_instructions.py:
  - `KEYS` and `ORIGINALS`
  - `current`, `sections`, `save`, `reset`, `restore`, `history`
  - `snapshot(db, user_id)` and `rubric_text`
  - `assemble_playbook(snapshot)`, which returns the user's main steps, then the rubric line, then `RULES`
- [ ] T012 [US3] In backend/app/services/scout_runs.py:
  - `_criteria` (shared with the preview) adds the snapshot to `queue_run`
  - `brief` builds `playbook`, `source_steps`, `broad_steps` and `rubric` from the snapshot
  - the limits are read from `criteria["limits"]` with fallback to the constants: `check_jobs`, `run_tip`, `max_pages`, `max_titles`
- [ ] T013 [P] [US2] Read the titles limit from the run in backend/app/services/scout_titles.py, and the companies limit from the run in backend/app/services/scout_companies.py
- [ ] T014 [US1] Add schemas for sections, versions and saves, plus `RunOut.instructions`, in backend/app/schemas/scout.py; fill `instructions` in `runs_out`
- [ ] T015 [US1] Add the routes in backend/app/api/v1/scout.py: GET /instructions, PUT /instructions/{key}, POST reset, GET history, POST restore. The tool descriptions come from backend/app/mcp_server.py
- [ ] T016 [P] [US1] Add types and hooks in frontend/src/lib/scout.ts and frontend/src/hooks/useScout.ts
- [ ] T017 [US1] Create frontend/src/components/scout/ScoutInstructions.tsx:
  - sections in order, each with its original or edited label
  - folded long texts
  - the locked rules and the tools with a lock
  - the fixed limits shown read-only
- [ ] T018 [US2] Create frontend/src/components/scout/InstructionEditor.tsx:
  - a text editor with Save, Reset and History / Restore
  - a rubric editor that shows the sum live
  - a limits editor with the ranges
- [ ] T019 [US1] Add the Instructions tab in frontend/src/components/scout/ScoutPanel.tsx
- [ ] T020 [P] [US1] Vitest in frontend/tests/components/ScoutInstructions.test.tsx: sections show, edit then save, reset, rubric sum check, locked sections have no edit control

## Phase 4: US4 — Preview (P2)

- [ ] T021 [P] [US4] Tests that the preview matches the brief and creates no run, and that a broad search shows "Claude picks the titles", in backend/tests/test_scout_instructions.py
- [ ] T022 [US4] Add `preview(db, user_id, mission_id)` (no side effects) in backend/app/services/scout_runs.py and GET /missions/{id}/preview in backend/app/api/v1/scout.py
- [ ] T023 [US4] Create frontend/src/components/scout/ScoutPreview.tsx (pick a search, then see the brief as readable sections) and use it inside ScoutInstructions.tsx; Vitest

## Phase 5: US5 — The run log (P1)

- [ ] T024 [P] [US5] Tests in backend/tests/test_scout_log.py:
  - every Scout tool writes an event with a summary
  - a refused call is logged with ok=false and the error is still raised
  - the brief event has no instruction texts
  - `get_master_profile` logs "Read your resume" without its content, and only during a running run
  - trimming to 8,000 characters
  - the cap of 400 plus a "more not logged" entry
  - owner only
- [ ] T025 [US5] Create backend/app/services/scout_log.py: `record`, `summarize`, `trim`, `events`
- [ ] T026 [US5] Wrap the Scout tools with logging and log the resume read in `get_master_profile`, in backend/app/mcp_server.py
- [ ] T027 [US5] Add GET /runs/{id}/log in backend/app/api/v1/scout.py
- [ ] T028 [US5] Create frontend/src/components/scout/RunLog.tsx (summaries in order, a tap opens the detail, errors highlighted) and show it in ScoutHistory.tsx, together with which instructions the run used; Vitest

## Phase 6: Polish

- [ ] T029 [P] Update the manifests (backend services and models, frontend components)
- [ ] T030 [P] Update the "How Claude Scout Works" diagram page with the Instructions tab and the Log
- [ ] T031 Run the trial-Postgres check from quickstart.md, then the full checks
- [ ] T032 Open the PR, get an independent review, fix the findings, wait for CI to pass, then merge (the user approved merging once the review is clean), and verify the deploy

## Dependencies

- Setup → Foundational → US1–US3 (the MVP) → US4 and US5 (independent of each other) → Polish.
- T012 depends on T011; T017 and T018 depend on T014–T016; T026 depends on T025.
