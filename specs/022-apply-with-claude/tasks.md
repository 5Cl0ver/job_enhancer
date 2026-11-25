# Tasks: Apply with Claude

## Part A: Job Catcher saves the whole job (PR `022-apply-with-claude`)

- [X] T001 [US1] Strip expand/collapse button text from descriptions in extension/src/extract/util.js (`cleanDescription`) and use it in mergeJob
- [X] T002 [US1] Clean board tails and location tails from titles in extension/src/extract/util.js (`cleanTitle`); skip board names as companies, and skip a title equal to the company, in mergeJob
- [X] T003 [US1] Drop the "careers-" prefix from hiring-site names on the panel's reads (`tidyJob`; extension/src/scoutCapture.js `siteName` already does it for Scout)
- [X] T004 [US1] Press "more" buttons inside a description before reading it on Save (new extension/src/extract/expand.js, used by content.entry.js onSave and the panel's readPage)
- [X] T005 [P] [US1] Tests in extension/test/extract-clean.spec.js and fixtures; bump the manifest to 0.39.0 plus the release notice

## Part B: apply runs on the server (PR `022-apply-runs`)

- [X] T010 Migration s7b8c9d0e1f3_apply_runs (apply_runs, apply_requests, apply_photos, profile_facts, resumes.is_master, resumes.document_id) plus a migration test
- [X] T011 Models in backend/app/models/apply.py and resume.py
- [X] T012 [US2] Service backend/app/services/apply_runs.py: create, open run, expiry, lock, status, events, brief, questions, answers, help, review, finish, requests, photos, cleanup
- [X] T013 [US4] Résumé save in backend/app/services/apply_resume.py: layout check, document + PDF résumé, set the job's résumé, re-render on edit (PDF code moved to app/services/resume_pdf.py)
- [X] T014 [US3] Facts service + routes (backend/app/api/v1/profile_facts.py); add the facts and the master résumé to `_master_profile_text`
- [X] T015 [US4] Résumé master/delete routes plus the list fields in backend/app/api/v1/ai.py
- [X] T016 [US2] REST routes in backend/app/api/v1/apply.py (app and Job Catcher); update the pass allowlist test
- [X] T017 [US2] Connector tools in backend/app/mcp_server.py; playbook and rules in backend/app/apply/*.md
- [X] T018 [P] Tests: tests/test_apply_runs.py, tests/test_mcp_apply.py, tests/api/test_apply_api.py, tests/test_apply_resume.py, tests/api/test_profile_facts.py

## Part C: the app (PR `022-apply-app`)

- [ ] T020 [US2] Hooks frontend/src/hooks/useApply.ts and lib frontend/src/lib/apply.ts (steps, labels)
- [ ] T021 [US2] Apply with Claude button in components/jobs/JobDetail.tsx (desktop and phone)
- [ ] T022 [US2–US6] Application page routes/ApplyRunPage.tsx plus components/apply/* (Steps, StartStep, Questions, ResumeStep, Pages, PhotoViewer, Review, HelpCard)
- [ ] T023 [US2] Top banner components/apply/ApplyBanner.tsx in DashboardLayout
- [ ] T024 [US4] Settings › Résumés: components/settings/ResumesCard.tsx (master, delete, made for a job) and FactsCard.tsx
- [ ] T025 [US8] What you sent on the job page: components/apply/WhatYouSent.tsx
- [ ] T026 [P] Tests in frontend/tests/components/apply/*.test.tsx and tests/lib/apply.test.ts

## Part D: Job Catcher apply mode (PR `022-apply-job-catcher`)

- [ ] T030 [US5] Background apply loop extension/src/background/applyRun.js: find the run, claim, fill (presence.press), photos (scroll + captureVisibleTab + shrink), results
- [ ] T031 [US5] Page side in extension/src/autofill.entry.js: tick, scroll steps, answers list, Submit block, Submit notice
- [ ] T032 [US6] Final-submit matcher extension/src/autofill/submitGuard.js (pure) with tests
- [ ] T033 [P] Tests: unit (applyRun, submitGuard) + e2e with the fake API; bump the manifest to 0.40.0 plus the release notice
