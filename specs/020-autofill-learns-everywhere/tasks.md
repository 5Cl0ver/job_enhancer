# Tasks: 020 Autofill that learns everywhere

Two PRs. Within each, tests are written first, then the code. File paths are relative to the repo root.

## PR 1: Learns everywhere + résumé details (US1, US5, US6 data)

### No AI (R1)
- [X] T001 Dropped: no AI in 020 (the owner). Model and config untouched.
- [X] T002 Dropped: no AI in 020. Autofill's AI pass off behind `AI_IN_AUTOFILL` (extension/src/autofill/flags.js); e2e checks no AI request is made during a fill.

### Résumé details (R2, R7)
- [X] T003 [P] Tests for the built-in reader on 4 synthetic formats: jobs, dates, current, bullets, education, skills, certifications, links (`backend/tests/services/test_resume_reader.py`).
- [X] T004 [P] Built-in reader (`backend/app/services/resume_reader.py`).
- [X] T005 `resume_history`: built-in reader only (no AI), extended with skills, certifications and websites; `parsed_history_at` is set either way (`backend/app/services/resume_history.py`).
- [X] T006 Routes for résumé details: `GET` and `PUT /v1/autofill/resumes/{id}/details` (session only), `POST /v1/autofill/resumes/{id}/read` (session only), `GET /v1/autofill/resumes/{id}` (pass-allowed, owner only) (`backend/app/api/v1/autofill.py`). Update `PASS_ROUTES`. Tests in `backend/tests/api/test_resume_details.py`.
- [X] T007 Scheduler backfill of unread résumés, 5 per run (`backend/app/main.py` and the service).
- [X] T008 Migration: `saved_jobs.resume_id` (FK, `ON DELETE SET NULL`). `PUT /v1/saved-jobs/{id}/resume` (pass-allowed, owner only). `SavedJobSummary` carries `resume_id`. The export includes it.
- [X] T009 App: `ResumeDetailsCard` on the Autofill memory page (pick a résumé, edit jobs, schools, skills, certifications and websites, **Read my résumé**) and `JobResumePicker` on the job page. Phone layout. Tests.

### Learning everywhere (R3)
- [X] T010 Tests (`extension/test/learn-everywhere.spec.js`):
  - "Preferred Name", "Preferred First Name" and "Nickname" share `@preferred_name`.
  - The order: site, then `@key`, then exact question, then profile, then fuzzy ≥ 0.85; 0.6–0.85 is offered only.
  - Identity guard.
  - A "First Name" box in a *Preferred name* section maps to preferred_name.
  - Promotion of the owner-shaped taught rows gives `@preferred_name` and never `@first_name`.
- [X] T011 Canonical keys and fuzzy tiers (`extension/src/autofill/classify/answers.js`); section-aware classification (`profileKeys.js`); new order (`resolve.js`).
- [X] T012 Pointer save:
  - default is **Every site**: `@key` for profile-type boxes, otherwise the question key; company-specific → `site|q`; essays → `essay|q`;
  - **Only this site** writes a taught box;
  - files: `background.entry.js` (`picked`, `fillPicked`), `autofill.entry.js` (`saveable` covers values Job Catcher filled once the user changed them);
  - panel `Point.tsx` (buttons: **Always use this**, **Only this site**, **Fill once**).
- [X] T013 Typing over a filled box: `typedAnswers` learns `@key` for profile-type boxes, with the identity guard. Existing auto-save and Undo are kept.
- [X] T014 Promotion of existing taught answers when the bundle loads: idempotent, marked done in storage, most recent wins.
- [X] T015 App `SavedAnswersCard`: `@key` rows labelled with the plain question ("Preferred name · Every site"), editable.
- [X] T016 e2e (`extension/e2e/learn-everywhere.spec.js`):
  - teach on lab site A with the pointer; site B, with different wording, fills it; site C's legal name is untouched;
  - typing over on A also learns;
  - Only this site stays on A.

### Résumé per job (R7)
- [X] T017 Copy uses the chosen résumé: the linked job's résumé, else the tab's choice, else the active one. It provides both the file and the details (`autofillCopy.js`, background).
- [X] T018 Panel "Filling from: X · Change" (`Apply.tsx`) and e2e: job X uploads résumé B.
- [ ] T019 Version 0.36.0; all suites; PR; reviews; CI; merge.

## PR 2: Sections, dropdowns, skills, languages (US2, US3, US4, US6 fill)

- [ ] T020 Lab pages:
  - Workday Work Experience: 1 row with wrong pre-filled title and description, Add button, month/year dates;
  - Workday Languages: listbox buttons and the native checkbox;
  - Workday skills multiselect (virtualised);
  - Greenhouse rows;
  - SuccessFactors-like rows.
- [ ] T021 Tests (`extension/test/dropdown-driver.spec.js`): one open at a time, verify, close, never "first option".
- [ ] T022 Dropdown driver (`extension/src/autofill/widgets.js`): close-before-open, scoped visible options, `promptLeafNode`, virtual scroll, verify, close-and-confirm.
- [ ] T023 Section filler (`extension/src/autofill/sections/{index,workday,generic}.js`), replacing `workday.js`:
  - rows from structure;
  - Add up to the entry count (max 10);
  - correct pre-filled values with Undo entries;
  - never touch user-edited boxes;
  - runs on automatic steps;
  - dates via the ArrowUp commit, then the keystroke fallback.
- [ ] T024 Skills: search prompts get one skill at a time with the chip verified; text boxes get a comma list.
- [ ] T025 Languages:
  - migration `application_profile.languages`;
  - schema, export;
  - app `LanguagesCard`;
  - level ladder (`extension/src/autofill/classify/languages.js`);
  - fill language rows (language, native, each ability).
- [ ] T026 e2e on every lab page: after one press, no popup is open, rows match the profile, Undo restores the pre-filled values.
- [ ] T027 Version 0.37.0; all suites; PR; reviews; CI; merge.
