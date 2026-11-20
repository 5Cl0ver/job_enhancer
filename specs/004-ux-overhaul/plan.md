# Implementation Plan: UX overhaul

**Branch**: `004-ux-overhaul` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-ux-overhaul/spec.md`

## Summary

Make the app hold up at real volume and tell the user what to do next. Five
slices: (1) a board that fits the window, moves cards reliably, and can be
searched; (2) stored **to-dos** per job, created from interview / assessment /
offer emails and surfaced as "Needs you"; (3) Email updates with a History so
nothing disappears, and a background scan with real progress; (4) a Claude
Scout checklist and one-step resume upload; (5) a shared look: fonts, tokens,
nav with counts, common page pieces, command palette. Root causes are in
[research.md](research.md) R1; the server freeze behind today's errors ships
separately as PR #12.

## Technical Context

**Language/Version**: TypeScript 5 / React 19 (frontend), Python 3.11 (backend)
**Primary Dependencies**: Vite, React Router 7, TanStack Query v5, Tailwind v4, shadcn/ui, `@dnd-kit/core` (installed); adding shadcn `sonner`, `tooltip`, `sheet`, `scroll-area`, `command` (cmdk) and `@fontsource-variable/geist`. Backend: FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2 (no new packages)
**Storage**: Supabase Postgres — 1 new table (`job_tasks`), 2 columns on `detected_events`, 5 on `email_accounts`, 1 backfill ([data-model.md](data-model.md))
**Testing**: Vitest + Testing Library (components, pure helpers), Playwright (board drag, search, scan progress), pytest (SQLite in-memory + a Postgres migration check, per the schema-drift lesson)
**Target Platform**: Vercel (web), Render free tier (API, one instance), phone + desktop browsers
**Project Type**: Web application (existing `frontend/` + `backend/`)
**Performance Goals**: board first render < 1 s with 200 jobs; search < 100 ms per keystroke; no request held open > 1 s by a scan
**Constraints**: $0 hosting (no queue, no worker, no websockets); one API process; Supabase egress-conscious (no full-list polling: `/attention` is three counts); WCAG 2.1 AA; reduced motion honoured; no new runtime dependency over ~15 kB gzip
**Scale/Scope**: ~200–1,000 saved jobs per user, a handful of users; 5 screens reworked, ~12 new components, 6 new/changed endpoints

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| I. Portfolio quality | The before/after is the story: audit table (R1), UI contracts, screenshots for the README; no dead code (old scan endpoint and `useSortable` path removed, not left beside the new ones) |
| II. User-centric | Every item traces to a complaint from real use; first-time paths get checklists and empty states; failures always say what happened (FR-011) |
| III. AI-powered | No new AI. To-dos come from the existing email classifier, which stays rule-based and versioned |
| IV. Security & privacy | Scan status exposes counts only, never email content; new endpoints are user-scoped with 404 on foreign ids; RLS on `job_tasks`; uploads keep existing type/size checks |
| V. Tests | Each slice lands with its tests: drop-on-card and failed-move (component), task lifecycle + one-task-per-email (API), history after apply/dismiss (API), scan status transitions incl. stale heartbeat (service), migration on Postgres |
| VI. Clean architecture | Routes → `services/job_tasks.py`, `services/email_scan_job.py` → models; the page reads tasks through the same saved-jobs contract; pure helpers (`lib/boardFilter.ts`, `lib/nextAction.ts`) hold the logic |
| VII. Simplicity | Incremental rendering instead of virtualisation; in-process task instead of a queue; CSS motion instead of a library; one table instead of a task system |

Gate: **pass**. Re-checked after design: still pass. (Wording drift as before:
the constitution names Next.js/NextAuth; the app is Vite + Supabase Auth.)

## Project Structure

### Documentation (this feature)

```text
specs/004-ux-overhaul/
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
├── alembic/versions/xxxx_job_tasks_and_scan_state.py
├── app/
│   ├── models/job_task.py
│   ├── schemas/{job_task,attention}.py        # + open_tasks on saved_job, history fields on email
│   ├── services/
│   │   ├── job_tasks.py                       # CRUD, create/remove from email events
│   │   ├── email_scan_job.py                  # background scan + status/heartbeat
│   │   ├── email_review.py                    # list by view, acted_at/acted_by, bulk
│   │   ├── email_scan.py                      # mail_link: Yahoo sender + subject
│   │   ├── saved_jobs.py                      # default stage, open_tasks
│   │   └── scout_tracks.py                    # attach_resume (atomic upload)
│   └── api/v1/{tasks,attention}.py            # + email.py, scout.py, saved_jobs.py changes
└── tests/{services/test_job_tasks.py, services/test_email_scan_job.py,
          api/test_tasks.py, api/test_email_history.py, test_migration_job_tasks.py}

frontend/
├── src/
│   ├── globals.css                            # fonts, accent + stage tokens, motion utilities
│   ├── components/ui/{sonner,tooltip,sheet,scroll-area,command}.tsx
│   ├── components/common/{PageHeader,EmptyState,ErrorState,Skeletons,CommandPalette}.tsx
│   ├── components/tracker/{KanbanBoard,PipelineColumn,KanbanCard,BoardToolbar,MoveMenu}.tsx
│   ├── components/jobs/{JobDrawer,NeedsYou,TaskList}.tsx
│   ├── components/email/{EmailTabs,ReviewRow,HistoryRow,ScanStatus,EmailViewer}.tsx
│   ├── components/scout/{SetupChecklist,ResumeTypes,ScoutStart}.tsx
│   ├── hooks/{useTasks,useAttention,useScanStatus,useTracker,useEmailAccount}.ts
│   ├── lib/{boardFilter,nextAction,emailUpdates}.ts   # pure
│   └── routes/{DashboardLayout,MyJobsPage,EmailUpdatesPage}.tsx
├── tests/{lib/boardFilter.test.ts, components/{KanbanBoard,NeedsYou,EmailTabs,ResumeTypes}.test.tsx}
└── e2e/board.spec.ts                          # drag onto a full column, search, failed move
```

**Structure Decision**: existing web-app layout. New shared pieces go in
`components/common/`; no new routes (the drawer and tabs are URL params on
existing pages).

## Delivery slices

Each slice is its own branch → PR → review → CI → merge, and is usable alone.

0. **Server freeze** — PR #12, ready. Stops the errors seen today.
1. **Board that works** (US1): shared kit needed now (toasts, tooltip, sheet,
   scroll-area, EmptyState/ErrorState, fonts + tokens), drop fix, Move to…,
   touch/keyboard sensors, per-column scroll, incremental render, collapse empty
   stages, search + highlight, hover, default-stage backfill.
2. **Needs you** (US2): `job_tasks`, API, created from email events, badges,
   panel, nav counts, job drawer.
3. **Email you can follow** (US3): tabs + History + undo, paged Other mail,
   bulk endpoint, background scan + status, Yahoo link, viewer.
4. **Scout start** (US4): checklist, upload on card, starter searches.
5. **Polish** (US5): nav icons + More sheet, PageHeader on every page, command
   palette, README screenshots, accessibility pass.

Slice 1 is frontend-only apart from the stage backfill, so it can go live fast.

## Risks

| Risk | Handling |
|---|---|
| Yahoo's search URL may ignore `from:` / `subject:` | Check on a real account first (quickstart); fall back to plain keywords |
| In-process scan dies on a Render restart | Heartbeat makes it read "stopped"; cursors are already saved; Scan again resumes |
| Migration on live data | Additive only (new table, nullable columns, backfill of NULL stages); backup before; Postgres migration test |
| Board regressions while reworking drag-and-drop | Playwright test drives a real drag onto a populated column before and after |

## Complexity Tracking

None.
