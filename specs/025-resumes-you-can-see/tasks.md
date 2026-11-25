# Tasks: Résumés you can see, shape and talk over

**Input**: [plan.md](plan.md), [spec.md](spec.md)

**Tests**: requested by the constitution (V).

## PR 025 A: the template and the viewer (US1, US2)

- [ ] T001 [US2] Template constants (colors, sizes, margins measured from the master) and the drawing pieces in backend/app/services/resume_pdf.py:
  - the navy banner with the name;
  - the blue title line (`> line`);
  - grey contact text;
  - section bars;
  - a two-column skills table from `**Label:** items`;
  - job headers with right-aligned dates (`**Company** | *Title* | dates` and `**Title** · Company | dates`);
  - blue `### Group` sub-headings;
  - core-areas boxes (only when a résumé has `## CORE AREAS`);
  - bullets;
  - the footer "page X of Y".
- [ ] T002 [US2] Old Markdown (the 022 layout) renders in the new look; long titles wrap without overlapping the dates. Same file.
- [ ] T003 [P] [US2] Tests with pdfplumber in backend/tests/test_resume_pdf_template.py: banner color, section bar color, dates right-aligned, footer text, old layout, 2-page sample, no overlap.
- [ ] T004 [US1] `PdfViewer` (lazy `pdfjs-dist` and worker, pages on canvases, zoom, Download, a .docx fallback) in frontend/src/components/common/PdfViewer.tsx
- [ ] T005 [US1] Use the viewer in Settings › Résumés, a job's résumé, documents on a job, and the application page. Files: frontend/src/components/settings/ResumesCard.tsx, frontend/src/components/apply/ResumeForJob.tsx, and the document list
- [ ] T006 [P] [US1] Tests (pdfjs mocked) in frontend/src/components/common/PdfViewer.test.tsx; `vite build` passes

## PR 025 B: pick, review, trim (US3, US4, US5)

- [ ] T007 The migration `v0e1f2a3b4c6_resume_review` (down_revision: 024's `u9d0e1f2a3b5`) adds `users.review_resumes` and `apply_runs.resume_picked`, in backend/alembic/versions/ and backend/app/models/
- [ ] T008 [US5] `create_run(saved_job_id, resume_id?)`: owner check, sets the run's and the job's résumé, `resume_picked`; the brief says `resume_picked`. Files: backend/app/services/apply_runs.py and backend/app/api/v1/apply.py
- [ ] T009 [US3] The `resume_review` status: `save_resume` pauses when `review_resumes` is on and the résumé wasn't picked. A `resume` decision (use / change + note) comes back through `wait_for_you`. Routes in backend/app/api/v1/apply.py; the settings field in backend/app/api/v1/users (or profile) routes
- [ ] T010 [US4] Playbook step 3: 2 pages at most, trim to the job, keep every real role/school/cert, the template layout (title line, groups, skills table), no core areas for jobs; plus the review step. Files: backend/app/apply/playbook.md and rules.md
- [ ] T011 [P] Tests in backend/tests/test_apply_resume_review.py: picked résumé run, review pause, use/change, setting off, playbook rules
- [ ] T012 [US5] "Which résumé?" sheet in frontend/src/components/apply/ApplyWithClaudeButton.tsx
- [ ] T013 [US3] The `ResumeReview` card (viewer, Use it, Change something, conversation, Edit) in frontend/src/components/apply/ResumeReview.tsx, on frontend/src/routes/ApplyRunPage.tsx; the steps strip knows `resume_review`
- [ ] T014 [US3] The setting "Review résumés before Claude applies" in Settings
- [ ] T015 [P] Tests for the sheet and the review card (vitest)

## Polish

- [ ] T016 MANIFESTs and the README
- [ ] T017 Full test runs and `vite build`
