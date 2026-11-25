# Tasks: Every email about a job, kept and organized

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/interfaces.md](contracts/interfaces.md)

**Tests first:** each fix starts from a failing test shaped like a real miss (anonymized).

## PR A: Nothing is lost

- [X] T001 Migration `x2a3b4c5d6e8_email_noted` (`seen_at`, `skip_reason`) and `STATUS_NOTED` / `STATUS_SKIPPED` in backend/alembic/versions/ and backend/app/models/detected_event.py, with a migration test
- [X] T002 [US1] Failing tests for kept-not-moved emails: applied confirmation with the card in Applied, second interview, second rejection, reminder. In backend/tests/test_email_scan.py
- [X] T003 [US1] `detect_events` stores `noted` for `already_at_or_past_stage` and `reminder` with a clear job, never just a skipped count, in backend/app/services/email_scan.py
- [X] T004 [US2] Failing tests for the digest mistakes: title inside a title, same title at many companies, generic company names, and a clear match from the company's domain. Real board alerts must still be digests. In backend/tests/test_email_match.py
- [X] T005 [US2] The digest test runs after matching with the clear-match bypass, ignores titles inside titles, counts distinct titles, and ignores generic company names (a small word list), in backend/app/services/email_match.py and email_scan.py
- [X] T006 [US5] Store job-looking skips as `skipped` with `skip_reason` (spam still never stored), plus a daily sweep (30 days, ≤ 500), in email_scan.py, email_review.py and main.py
- [X] T007 [US6] `POST /v1/email/recheck` (window ≤ 45 days, known keys, no auto-move, no cursor save, scan lock and backoff) in email.py and email_scan.py (`recheck=True`), with tests
- [X] T008 [US7] `scripts/email_scan_debug.py` runs the real `detect_events` in a rolled-back transaction and prints each status and reason
- [X] T009 The Re-check button on frontend/src/routes/EmailUpdatesPage.tsx, plus the noted rows in today's job list ("No change needed")
- [X] T010 Replay on the owner's inbox (read only, T008): 10 of 10 kept; board alerts kept off jobs (SC-001, SC-002)

## PR B: Organized

- [ ] T011 [US3] `job-emails` adds `seen`/`effect`; `POST job-emails/seen`; `latest` adds `unseen`, in backend/app/api/v1/email.py and email_review.py, with tests
- [ ] T012 [US3] frontend/src/lib/emailSections.ts (kind → section, the summary line) with tests
- [ ] T013 [US3] `JobEmails` in sections, New badge, "Show N more", marks seen after showing, in frontend/src/components/email/JobEmails.tsx (job page and pop-up)
- [ ] T014 [US4] `GET /v1/email/new` and the "New emails on your jobs" list on Email updates; a dot on board cards
- [ ] T015 [US5] `GET /v1/email/looked-at` and the "Looked at, not shown" list with reasons; "This is about my job" makes a `skipped` row `noted` through `/events/{id}/link`
- [ ] T016 Component tests (sections, New, looked-at recovery), `vite build`, and MANIFESTs

## Polish

- [ ] T017 Pre-push privacy check: grep the diff for the owner's real company names (print file:line only)
- [ ] T018 Full suites: backend, frontend, extension
