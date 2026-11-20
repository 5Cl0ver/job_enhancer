# Implementation Plan: Know where every job came from and where it went

**Branch**: `006-know-where-things-are` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-know-where-things-are/spec.md`

## Summary

Every saved job records how it got there and says so on its card. Claude Scout
stops saving on its own: good fits wait in a review where they are pre-ticked,
the folder is pre-filled from the search, and one button saves them. Each search
chooses its folder. The pages link both ways (run ↔ job ↔ folder ↔ email), and
jobs made from emails get readable names or ask for them. What went wrong on the
first real run, and why, is in [research.md](research.md) R1; screens are in
[contracts/ui.md](contracts/ui.md).

## Technical Context

**Language/Version**: Python 3.11 (FastAPI); TypeScript 5 / React 19
**Primary Dependencies**: SQLAlchemy 2 async, Alembic, Pydantic v2, FastMCP; Vite, React Router 7, TanStack Query v5, Tailwind 4.3, shadcn/ui on Radix. **No new dependency.**
**Storage**: Supabase Postgres. Two small migrations (step 1: `saved_jobs.origin` + backfill; step 2: `scout_missions.collection_id` + `auto_save`, `scout_runs.stats`) ([data-model.md](data-model.md)). No new tables
**Testing**: pytest on SQLite plus an offline Postgres SQL test for the migration and its backfill; connector tests in `tests/test_mcp_scout.py`; Vitest + Testing Library; Playwright phone spec
**Target Platform**: Render (API, runs `alembic upgrade head` on deploy) + Vercel (web); phone and desktop browsers
**Project Type**: Web application (existing `backend/` + `frontend/`); the extension changes by one field
**Performance Goals**: no extra request on the My Jobs list (origin and fit ride on the existing payload); confirm of 10 findings under 2 s; job page adds one small request
**Constraints**: $0 hosting; migration safe on a live table (nullable / defaulted columns, reversible); connector replies stay the same size; phone parity; invented company names in code and tests; email text never logged
**Scale/Scope**: 1 migration, 4 new endpoints, 3 changed payloads, ~6 new components, ~12 touched; 4 slices, each its own PR

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| I. Portfolio quality | A traceable data story (origin, run ↔ job links) and a human-in-the-loop step for an AI agent, both easy to show and explain |
| II. User-centric | Each part answers a sentence the user said after their first real run; defaults make the common case one press |
| III. AI-powered | The agent proposes, the person confirms; Claude's reasons become visible on the job itself. Unattended saving stays available per search |
| IV. Security & privacy | All new routes user-scoped; a rename can never alter a listing another user saved; `/attention` stays counts-only; email content stays out of logs and the label is derived, not copied |
| V. Tests | Each slice ships with service, API and component tests; the migration backfill and the listing copy-on-write get their own tests |
| VI. Clean architecture | Origin is set where saved jobs are created, in one service; review logic lives in `scout_runs`; name rules stay pure in `email_job_names`; UI reads one `source` endpoint |
| VII. Simplicity | Two new outcome values instead of a review table; folder chosen by one resolver; no new libraries; doubtful names computed, not stored |

Gate: **pass**. Re-checked after design: still pass.

## Project Structure

### Documentation (this feature)

```text
specs/006-know-where-things-are/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rest-api.md
│   └── ui.md
└── tasks.md            # next: /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── alembic/versions/{c0d1e2f3a4b6_saved_job_origin,d1e2f3a4b5c7_scout_review}.py
├── app/models/{saved_job,scout}.py            # origin; collection_id, auto_save; PICKED, SKIPPED
├── app/schemas/{saved_job,scout,attention}.py
├── app/services/
│   ├── saved_jobs.py        # origin on create; scout_fits(); rename_listing() copy-on-write
│   ├── job_source.py        # where a job came from: collection, Scout search, email
│   ├── scout_runs.py        # report_job → picked; confirm_run(); save_finding(); scout_folder()
│   ├── email_review.py      # origin=email; ask-for-name path; scout_review count
│   └── email_job_names.py   # stricter role/company; doubtful_name()
├── app/api/v1/{saved_jobs,scout,attention}.py
├── app/mcp_server.py        # origin=claude; playbook + reply wording
└── tests/{services/test_job_origin.py, services/test_scout_review.py,
           services/test_rename_listing.py, services/test_email_job_names.py,
           api/test_scout_confirm.py, test_mcp_scout.py, test_migration_job_origin.py}

frontend/src/
├── lib/{origin,scout,jobFilters,prefs}.ts     # origin labels + filter; review defaults
├── hooks/{useSavedJobs,useScout,useAttention}.ts   # source, rename, confirm, save-one; invalidations
├── components/jobs/{OriginLabel,WhereFrom,RenameJob}.tsx   # new
├── components/jobs/{JobDetail,PhoneJobList,SavedJobsBody,CollectionSidebar}.tsx
├── components/tracker/{KanbanCard,JobDetailDialog}.tsx
├── components/scout/{RunReview,FolderSelect}.tsx           # new
├── components/scout/{ScoutStart,ScoutPanel,ScoutHistory,RunFindings}.tsx
├── components/email/…        # name fields before "Add to My Jobs"
├── components/layout/{nav.ts,PhoneNav.tsx}    # Find Jobs badge
└── routes/{MyJobsPage,JobDetailPage,SearchPage}.tsx

frontend/tests/{lib/origin.test.ts, components/{RunReview,WhereFrom,RenameJob,OriginLabel}.test.tsx,
                e2e/phone.spec.ts}

extension/src/…               # Job Catcher sends origin: "extension" (one field; version bump)
```

**Structure decision**: the existing two projects; no new modules beyond the
files above.

## Slices

Each slice is one branch → PR → review → merge with the user's OK, and is
useful on its own.

| # | Slice | Delivers | Stories |
|---|---|---|---|
| 1 | **Where it came from** | Migration + backfill; origin on every create path; label on cards, rows, job page; "Where this came from" block; Where-from filter; `?folder=` / `?origin=` links; folder list refreshes on save; email-made jobs' button opens the email | 1, 4 |
| 2 | **Ask before saving** | Save-into on searches; `picked` / `skipped`; review panel + confirm + save-one; auto-save switch; "looked at N postings" line + Keep looking (`scout_runs.stats`); connector wording; Find Jobs badge; History links | 2, 3, 4 |
| 3 | **Readable names** | Rename (copy-on-write); stricter email names; ask when unclear; "Check this job's name" | 5 |
| 4 | **Phone pass** | Review bar pinned above the tab bar, filter in the sheet, Rename as a sheet, phone e2e checks | all |

Slice 1 goes first because it answers "where did these save" on its own and
makes the junk email cards explain themselves before anything else changes.

## Dependencies and risks

- **PR #15 must merge first** (its migration `b9c0d1e2f3a5` is this one's
  parent, and it reshapes the same cards and job pop-up). If #15 isn't merged
  when building starts, slice 1 branches from it and is rebased after.
- **Live runs in flight** when slice 2 deploys: a run queued before the deploy
  has no `auto_save` in its criteria and is treated as off, so its remaining
  fits become picks. Already-saved findings are untouched.
- **Backfill guesses**: only certain cases are labelled; nothing is marked
  "Added by you" unless it was created that way after this ships.
- **Extension version**: older Job Catcher builds don't send `origin`, so their
  saves show "Added by you" until the user reloads the extension. Called out in
  the PR.
- **Rename and dedup**: renaming recomputes the listing's keys; the 409 path and
  the two-user copy-on-write case are tested explicitly.

## Not in this plan

To-dos ("Needs you") and Email History from 004 are unchanged and still next;
both will hang off the same job page block this plan adds.
