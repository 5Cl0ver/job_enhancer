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

## Phase 6: Review fixes (PR #62)

- [X] T013 A guess left as it was is sent `guessed` and not kept as a thing told (frontend Questions.tsx, backend `record_answers`)
- [X] T014 `fill_page` / `page_done` refused while the checklist is out; playbook says wait
- [X] T015 Answers go back to where asking began (`from` on each question): filling, or the résumé change
- [X] T016 No new checklist over answers Claude hasn't picked up
- [X] T017 Live fixes: only the user's words in the message; box label and value from the live view, apart, marked as page text
- [X] T018 Stronger scrub (bare codes, "password X", emails, phones), job slugs kept in pages; admin list reads only the columns it needs

## Phase 7: US4, Bug reports

- [X] T019 [US4] Context and status on each report; `PATCH /v1/admin/apply-problems/{run_id}/{id}` in backend/app/services/apply_problems.py and backend/app/api/v1/admin.py
- [X] T020 [US4] `bugReport` / `allOpenReport` Markdown in frontend/src/lib/bugReport.ts
- [X] T021 [US4] `BugReportsCard` (grouped, open / all, Fixed / Ignore, Copy for Claude, Copy all open, manual copy box) in frontend/src/components/admin/BugReportsCard.tsx
- [X] T022 [P] [US4] Tests: backend/tests/test_apply_checklist.py, frontend/tests/lib/bugReport.test.ts, frontend/tests/components/BugReports.test.tsx
