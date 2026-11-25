# Tasks: one checklist, edit while it fills, problems report

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md)

## Phase 1: Setup

- [X] T001 Migration `y3b4c5d6e7f9` (after 029's `y3c5e7a9b1d2`) and `ApplyRun.problems` in backend/alembic/versions/y3b4c5d6e7f9_apply_problems.py and backend/app/models/apply.py

## Phase 2: US2, one checklist

- [X] T002 [US2] `ask_questions` takes `guess` / `choices` / `only_you`, batches, works while filling; `_what_now` goes back to filling; `_next` and `view` follow, in backend/app/services/apply_runs.py
- [X] T003 [US2] Tool docs for `ask_questions` and `need_help` in backend/app/mcp_server.py; answers route takes up to 30 in backend/app/schemas/apply.py
- [X] T004 [US2] The checklist in frontend/src/components/apply/Questions.tsx; types, `openBatch` and the step in frontend/src/lib/apply.ts

## Phase 3: US1, edit while it fills

- [X] T005 [US1] `live_fix` and `fix` in the inbox (with a note for Claude) in backend/app/services/apply_runs.py; `POST /runs/{id}/live-fix` in backend/app/api/v1/apply.py
- [X] T006 [US1] Tap a line, `LiveFixSheet`, `useLiveFix` in frontend/src/components/apply/LiveFill.tsx and frontend/src/hooks/useApply.ts

## Phase 4: US3, problems report

- [X] T007 [US3] `apply_problems.py` (scrub, add, admin_list) and `report_problem` in backend/app/services/; the tool in backend/app/mcp_server.py; `GET /v1/admin/apply-problems` in backend/app/api/v1/admin.py
- [X] T008 [US3] `Problems` on frontend/src/routes/ApplyRunPage.tsx and `ApplyProblemsCard` on frontend/src/routes/AdminPage.tsx

## Phase 5: Playbook, tests, docs

- [X] T009 Playbook + rules (batch questions, mid-fill changes, report problems); version 2026.11.30
- [X] T010 [P] backend/tests/test_apply_checklist.py (tools, service, routes, admin, playbook, migration)
- [X] T011 [P] frontend/tests/components/apply/Checklist.test.tsx; ApplyRunPage tests updated for the checklist
- [X] T012 MANIFEST files
