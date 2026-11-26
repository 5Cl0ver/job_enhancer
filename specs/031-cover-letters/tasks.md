# Tasks: Cover letters, like résumés

**Input**: [plan.md](plan.md), [spec.md](spec.md)

**Tests**: requested by the constitution (V).

## One PR

- [x] T001 Migration `z4c5d6e7f8a0` and the model columns (`saved_jobs.cover_letter_id`, `apply_runs.cover_letter_id`)
- [x] T002 [US1] `cover_letters.check_letter` / `save_for_job`; `apply_runs.save_cover_letter`; the MCP tool `save_cover_letter`
- [x] T003 [US1] Playbook block (when to write, length, no stiff openings, sign-off); version 2026.12.01
- [x] T004 [US2] `render_letter_pdf` in `resume_pdf.py`; `cover_letters.pdf_of` (header from the job's résumé, else the profile)
- [x] T005 [US3] Routes: `GET /v1/ai/cover-letters`, `PUT /v1/saved-jobs/{id}/cover-letter`, the document PDF for a letter, edit caps
- [x] T006 [US3] `JobCoverLetterPicker` on the job page; `CoverLetterCard` on the application page; `useCoverLetters`
- [x] T007 [US4] `GET /v1/autofill/cover-letters/{id}`; `cover_letter_id` in the saved-jobs summary and `/v1/apply/active`
- [x] T008 [US4] Job Catcher: `isCoverLetterUpload`, `isCoverLetterText`, the letter in the fill copy; 0.44.0 and its release notice
- [x] T009 Tests: backend/tests/test_cover_letters.py, frontend/tests/components/CoverLetters.test.tsx, extension/test/cover-letter.spec.js, extension/e2e/cover-letter.spec.js (lab page test/lab/cover-letter.html)
- [x] T010 MANIFEST files

## Review fixes (PR #63)

- [x] T011 Job Catcher fetches the letter fresh for every fill (no kept copy)
- [x] T012 The job's pick is the one truth for Job Catcher, the run card and the brief; None wins mid run
- [x] T013 `uploadKind` reads the box's group or heading: a lone "Attach" under "Cover Letter" is never the résumé's (unit + lab page `cover-letter-only.html`)
- [x] T014 Text boxes: only a label mainly about the cover letter; a box too small is left ("Too long for this box")
- [x] T015 The opening check strips markdown and skips Re/name/contact/date lines; blocks "Hi team" and "I'm writing to…"; `save_draft` checks cover letters
- [x] T016 A rich-text box that drops paragraph breaks counts the pasted letter as taken
- [x] T017 Indexes on both `cover_letter_id` columns
- [x] T018 Claude's later save never takes the job's pick back from the user ("None" or another letter): it's set only when the job has none and the run saved none yet, or still has this run's letter
