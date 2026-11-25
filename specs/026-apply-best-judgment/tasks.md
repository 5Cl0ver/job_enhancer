# Tasks: Apply with best judgment

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/interfaces.md](contracts/interfaces.md)

**Tests**: requested by the constitution (V), so each story has tests.

## Phase 1: Setup

- [ ] T001 Add the migration `w1f2a3b4c5d7_apply_live` (after 025's `v0e1f2a3b4c6`), plus `ApplyRun.live` (JSON, nullable), in backend/alembic/versions/w1f2a3b4c5d7_apply_live.py and backend/app/models/apply.py
- [ ] T002 [P] Add a migration SQL test in backend/tests/test_migration_apply_live.py

## Phase 2: Foundational (server)

- [ ] T003 `_answers` keeps `guess`, `agreement` and `by`, and drops card/CVV questions, in backend/app/services/apply_runs.py
- [ ] T004 Plain-word problem lines from fill and photo results (`_problem_text`), and `problems` in the run view, in backend/app/services/apply_runs.py

## Phase 3: US1 + US3, the résumé is attached and problems are plain (server)

- [ ] T005 [US1] `extension_state` adds `resume_id` (the run's, else the job's) and `live` in backend/app/services/apply_runs.py
- [ ] T006 [US3] `fill_result` reports `resume` with a `tell` line; `need_help` accepts kind `file`; the run view gives `resume_file` in backend/app/services/apply_runs.py and backend/app/mcp_server.py
- [ ] T007 [US3] `photo_result` explains the reason codes in backend/app/services/apply_runs.py
- [ ] T008 [P] [US1] [US3] Tests in backend/tests/test_apply_best_judgment.py

## Phase 4: US4, the live view (server + app)

- [ ] T009 [US4] `save_live(run, payload)`: checks, caps, sensitive filter, status gate; cleared on status change in `_set`, in backend/app/services/apply_runs.py
- [ ] T010 [US4] `POST /v1/apply/runs/{id}/live` in backend/app/api/v1/apply.py
- [ ] T011 [P] [US4] Tests for the live route and service in backend/tests/test_apply_best_judgment.py
- [ ] T012 [US4] `LiveFill` component and types in frontend/src/components/apply/LiveFill.tsx and frontend/src/lib/apply.ts; shown on frontend/src/routes/ApplyRunPage.tsx while filling
- [ ] T013 [P] [US4] Test frontend/src/components/apply/LiveFill.test.tsx

## Phase 5: US5, best judgment (connector)

- [ ] T014 [US5] Playbook step 4 rewritten for best judgment; rules.md version 2026.11.27 with the locked stop list, in backend/app/apply/playbook.md and backend/app/apply/rules.md
- [ ] T015 [US5] Tool docstrings: `page_done`/`ready_for_review` answers with `guess`/`agreement`; `need_help` kind `file`, in backend/app/mcp_server.py
- [ ] T016 [P] [US5] Playbook tests (the stop list, never guess experience) in backend/tests/test_apply_best_judgment.py

## Phase 6: US6, bubbles and batched fixes

- [ ] T017 [US6] `decide` accepts `fixes` (≤ 30, trimmed); `wait_for_you` returns them; the route takes them, in backend/app/services/apply_runs.py and backend/app/api/v1/apply.py
- [ ] T018 [US6] `bubbleOrder`, `sourceOf` and `fixNote` in frontend/src/lib/apply.ts
- [ ] T019 [US6] `Bubbles` (check-first list, page bubbles, edit sheet, fix tray) in frontend/src/components/apply/Bubbles.tsx; used by frontend/src/components/apply/Review.tsx
- [ ] T020 [US6] Pages show plain problem lines and source chips in frontend/src/components/apply/Pages.tsx; the file help card with Download in frontend/src/components/apply/Remote.tsx
- [ ] T021 [P] [US6] Tests: frontend/src/components/apply/Bubbles.test.tsx, frontend/src/lib/apply.test.ts; backend fixes tests

**Checkpoint: PR 026 A (server + app).**

## Phase 7: US1 + US2 + US4, Job Catcher 0.42.0

- [ ] T022 [US1] Hidden upload boxes behind visible upload buttons/drop zones in extension/src/autofill/scan.js; the section heading in the box's context
- [ ] T023 [US1] Workday's résumé box recognised in extension/src/autofill/resolve.js (with a Workday-like fixture extension/test/fixtures/workday-resume.html)
- [ ] T024 [US1] `getAutofillCopy` uses the open run's `resume_id` for a page on the run's site (`applyRun.resumeFor(tab)`) in extension/src/background.entry.js and extension/src/background/applyRun.js
- [ ] T025 [US3] The session report carries the résumé state; the fill result sends `resume` in extension/src/autofill.entry.js, extension/src/autofill/session.js and extension/src/background/applyRun.js
- [ ] T026 [US2] Bring-to-front photos and peeks, put back, minimised windows, `idle` reasons, in extension/src/background/applyRun.js; the `idle` permission and 0.42.0 in extension/manifest.json
- [ ] T027 [US4] The live loop (every 3 s while filling, only on change, sensitive boxes dropped, `by` from the fill report) in extension/src/background/applyRun.js
- [ ] T028 [P] Tests in extension/test/apply-mode.spec.js and extension/test/fill-engine.spec.js (hidden upload, Workday résumé, run résumé, photos put back, live snapshot)
- [ ] T029 The app's "new enough" Job Catcher version becomes 0.42.0 for the live view only (older ones keep working) in backend/app/services/apply_runs.py

**Checkpoint: PR 026 B (Job Catcher).**

## Phase 8: Polish

- [ ] T030 MANIFEST updates (backend app/services, frontend components/apply, extension src) and the README feature list
- [ ] T031 A full test run on all three packages, plus `vite build`

## Dependencies

- 026 A needs 025 merged (the migration chain and the résumé review status).
- 026 B needs 026 A on the server (`resume_id`, the live route); with an older server, the run résumé falls back to the URL guess and the live posts are ignored.
