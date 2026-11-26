# Tasks: Job Catcher fixes

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md)

**Tests**: each bug gets a test that fails on the old code (constitution V).

## US1 - The right job history, in whole sentences

- [X] T001 [US1] Reader joins wrapped lines, keeps "• ", splits only at bullets or sentence ends, never cuts mid-word, takes "Portland, OR" under a job as its place, in backend/app/services/resume_reader.py
- [X] T002 [P] [US1] Tests in backend/tests/services/test_resume_reader_wraps.py
- [X] T003 [US1] `history_of_document` + `refresh_borrowed`; `save_for_job` and `rerender` read the document, in backend/app/services/apply_resume.py; called from backend/app/api/v1/autofill.py (details) and backend/app/api/v1/ai.py (work-history)
- [X] T004 [P] [US1] Tests in backend/tests/api/test_resume_details.py and backend/tests/test_mcp_apply.py
- [X] T005 [US1] A run's copy never carries the master's history when its résumé can't load, in extension/src/background.entry.js

## US2 - Workday's résumé box

- [X] T006 [US2] `uploadZone` (any case, drop zone beside the input, never a dropdown) and `uploadArea` in extension/src/autofill/scan.js; `uploadKind` reads area, group, section, Workday's input in extension/src/autofill/resolve.js
- [X] T007 [US2] Drop the file on Workday's zone when it ignores the box, in extension/src/autofill/widgets.js
- [X] T008 [P] [US2] Lab pages matching the real DOM (inside and beside the zone) in extension/test/lab/; tests in extension/test/job-catcher-fixes.spec.js and extension/e2e/apply.spec.js

## US3 - Each step reports only its own boxes

- [X] T009 [US3] `report()` lists only boxes on the page now, in extension/src/autofill/session.js
- [X] T010 [US3] Claude's fill keeps only frames that reported after the press and waits for a busy fill's report, in extension/src/background/applyRun.js
- [X] T011 [P] [US3] Tests in extension/test/job-catcher-fixes.spec.js, extension/test/apply-mode.spec.js, extension/e2e/apply.spec.js

## US4 - Phone Extension

- [X] T012 [US4] `isPhoneExtension` guard in extension/src/autofill/classify/profileKeys.js, tests in extension/test/job-catcher-fixes.spec.js and the e2e

## US5 - One tab

- [X] T013 [US5] `showFor` never switches tabs while the user is active, any window, in extension/src/background/applyRun.js; test in extension/test/apply-mode.spec.js
- [X] T014 [US5] Playbook: open apply links in the same tab; version 2026.11.29, in backend/app/apply/playbook.md and backend/app/services/apply_playbook.py

## US6 - Learning from Claude

- [X] T015 [US6] Migration `y3c5e7a9b1d2` + `CustomAnswer.source`, schema, a user save clears it, in backend/
- [X] T016 [US6] backend/app/services/apply_learn.py; `decide()` learns on submit/self and keeps `review.changed`; `page_done` carries it, in backend/app/services/apply_runs.py
- [X] T017 [P] [US6] Tests in backend/tests/test_apply_learn.py
- [X] T018 [US6] "From Claude" line in Autofill memory, frontend/src/components/settings/SavedAnswersCard.tsx

## Polish

- [X] T019 Job Catcher 0.43.0 (extension/manifest.json) + extension/release-notices.txt
- [X] T020 MANIFEST files (extension, backend app, services)
