# Tasks: Sites to skip

One PR (`024-sites-to-skip`): the server and the app ship together.

## Setup

- [X] T001 Migration u9d0e1f2a3b5: `skipped_sites` (unique user + host, cascade, RLS on); migration test in backend/tests/test_migration_skipped_sites.py
- [X] T002 `SkippedSite` model in backend/app/models/skipped_site.py, registered in backend/app/models/__init__.py

## Foundation

- [X] T003 backend/app/services/skipped_sites.py: `host_of`, `matches` (site or real sub-site), `skipped_by`, `hosts` / `list_sites`, `add` (max 100, 409 for LinkedIn, Indeed, ZipRecruiter, Google), `remove`, `suggestions`, `refusal`
- [X] T004 Schemas in backend/app/schemas/skipped_site.py; owner-only routes in backend/app/api/v1/skipped_sites.py, registered in backend/app/api/v1/router.py

## User Story 1: a list of sites to skip (P1)

- [X] T005 [US1] useSkippedSites hooks in frontend/src/hooks/useSkippedSites.ts (409 → `NeedsConfirm`)
- [X] T006 [US1] "Sites to skip" card in frontend/src/components/scout/SkippedSites.tsx: paste box, list with ✕, warning with "Skip it anyway", suggestions with "Skip it"
- [X] T007 [US1] The card first on Claude Scout › Instructions (frontend/src/components/scout/ScoutInstructions.tsx); a link from Settings (frontend/src/routes/SettingsPage.tsx)

## User Story 2: Claude Scout never brings jobs from them (P1)

- [X] T008 [US2] `get_scout_brief` adds `skip_sites` (only when set); one locked line in backend/app/scout/rules.md; PLAYBOOK_VERSION 2026.11.13
- [X] T009 [US2] `check_jobs` leaves rows on a skipped site out, counted as `skipped_site` (run log and "Looked at" line)
- [X] T010 [US2] `report_job` turns down a link on a skipped site with the plain sentence

## User Story 3: Apply with Claude never applies through them (P2)

- [X] T011 [US3] `get_apply_brief` adds `apply_url_skipped` and a `next` line (find the company's own posting, or `need_help`)

## User Story 4: one tap from a job (P3)

- [X] T012 [US4] "Never this site" in frontend/src/components/jobs/JobActions.tsx (only for a job with a link, not one made from an email)

## Polish

- [X] T013 Data export lists the sites (backend/app/api/v1/users.py); account deletion removes them (cascade)
- [X] T014 [P] Tests: backend/tests/test_skipped_sites.py, frontend/tests/components/SkippedSites.test.tsx, frontend/tests/lib/scout.test.ts
- [X] T015 [P] MANIFESTs: models, services, api, schemas, components, hooks, routes

## Review fixes

- [X] T016 Application systems (Greenhouse, Lever, Workday…) can't be skipped (400); "Never this site" is hidden on them (shared list in frontend/src/hooks/useSkippedSites.ts)
- [X] T017 Apply enforces it: `fill_request` and `page_done` / `ready_for_review` refuse a page on a skipped site; the brief's `next` line stays after pages exist
- [X] T018 Two adds at once: the unique key's IntegrityError (savepoint) answers "already"
- [X] T019 Normalizing: shared names ("co.uk", github.io…) refused, repeated "www." dropped, only a leading scheme counts, international names in xn-- form
- [X] T020 "Never this site" shows the server's own message on an error
