# Implementation Plan: Bug inbox (Bugs & ideas)

**Branch**: `032-bug-inbox` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

## Summary

This adds a new owner-only **Bugs & ideas** area in Admin, with 4 tables: reports, events, links and shots ([data-model.md](data-model.md)). It's fed by:
1. the owner's **Add a bug or idea** button on every page;
2. the owner's AI through **4 new connector tools**;
3. Claude's **apply-run problems** (spec 030, folded in);
4. **errors the app catches itself**: server errors, browser crashes, Job Catcher failures, email check failures, Scout refusals, and services going down.

Repeats merge by a plain fingerprint, a fixed bug seen again reopens as **Came back**, and priority is worked out at read time. Copy for Claude reuses spec 030's fenced format. It ships in **3 PRs**, and each one is useful on its own.

## Technical Context

| | |
|---|---|
| **Language/Version** | Python 3.11 (backend), TypeScript and React 19 (app and Job Catcher panel), JS (Job Catcher background) |
| **Primary Dependencies** | FastAPI, SQLAlchemy 2 async, Alembic, FastMCP, rapidfuzz (already used), APScheduler (already used); Vite, TanStack Query v5, shadcn/ui, sonner |
| **Storage** | Postgres. New tables `bug_reports`, `bug_report_events`, `bug_report_links`, `bug_report_shots` (bytes, like `apply_photos`; research R1). Migration after `z4c5d6e7f8a0`, with data steps for the old run problems and the 5 starting entries |
| **Testing** | pytest (service, routes, connector tools, migration up and down, scrub with planted secrets), vitest (inbox page, add sheet, copy text, error boundary), extension vitest (caught posts, owner report), Playwright (phone add-a-bug, Job Catcher report on a lab page) |
| **Target Platform** | Render API, Vercel app (phone and computer), Chrome MV3 |
| **Performance Goals** | The inbox list loads in under 1 s for 1,000 reports; caught-error recording adds under 50 ms and never blocks the user's response |
| **Constraints** | Owner-only; no AI; $0; no personal data in caught reports; page text is data only; nothing changes for other users except a friendly crash screen |
| **Scale/Scope** | One owner, a few friends; up to a few thousand reports |

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ Spec, plan, research, data model, contracts, quickstart; MANIFESTs updated; old card and routes removed, no dead code. |
| II. User-centric | ✅ Add a bug in seconds from any page, phone first; one place to see everything; nothing new for other users to learn. |
| III. AI-powered | ✅ The app adds no AI. Claude works through owner-only connector tools. |
| IV. Security & privacy | ✅ `require_admin` on every route; the connector owner check; caught reports store no user; every text scrubbed and capped; images type- and size-checked; page text fenced; rate limits and an hourly cap; no loops on recording errors. |
| V. Test-driven | ✅ Each story has backend and UI tests; a migration test; a non-owner refusal test on every route and tool. |
| VI. Clean architecture | ✅ One service `bug_reports.py` owns all rules; routes, tools, the exception handler, the scheduler and run problems all call it. |
| VII. Simplicity | ✅ One event log instead of 3 tables; no Storage bucket; deterministic fingerprints; priority computed in SQL. |

No violations, so nothing in Complexity Tracking.

## PRs (each ships value)

### PR A: The inbox (US1, US5, US6 copy, US7, US9, plus the add form without screenshots)
- Migration: the 4 tables; old run problems brought in once; the 5 starting entries.
- `backend/app/services/bug_reports.py`:
  - create, list (filters, search, priority, counts), detail, update, bulk, delete;
  - notes, links, merge and split, fingerprint, came-back;
  - `from_run_problem`.
- `scrub(text, cap)` generalized in `apply_problems.py`.
- `backend/app/api/v1/admin_bugs.py`: the `/v1/admin/bugs*` routes (contract), with the old apply-problems routes removed. `attention.py` gets `bugs_new`.
- The frontend has 5 parts:
  - **Page:** `routes/AdminBugsPage.tsx` at `/admin/bugs`, with a "Bugs & ideas" entry and count on Admin.
  - **Inbox components** in `components/bugs/`:
    - `BugList`: tabs, section chips with counts, the filter sheet, search;
    - `BugRow`;
    - `BugDetail`: a sheet on phones, a side panel on computers;
    - `BugStatusMenu`;
    - `BugNotes`;
    - `BugLinks`;
    - `BulkBar`.
  - **Add a bug:**
    - `AddBugSheet`, with automatic context: page, device, browser, theme, version, Job Catcher version;
    - an Add button in the desktop sidebar and the phone top bar, owner only.
  - **Copy for Claude:** `lib/bugReport.ts` extended for the new format and batch copy.
  - **Removed:** `BugReportsCard`.
- `apply_runs.report_problem` also feeds the inbox.

### PR B: Catches itself, screenshots, repeats (US2 screenshots, US3, US4 suggestions)
- **Screenshots:** the shots table routes; image shrink in the browser (`lib/shrinkImage.ts`); photo or file picker in `AddBugSheet`.
- **Repeat suggestions:** the "Looks like…" step after save; merge and undo in the detail view.
- **Server errors:** `main.py`'s `unhandled_exception_handler` calls `bug_reports.catch_server_error`.
- **Browser crashes:**
  - `router.tsx` gets `errorElement` → `components/bugs/CrashScreen.tsx`;
  - `lib/catchErrors.ts` adds the `onerror` / `unhandledrejection` listeners, guarded and once a minute per message.
- **Caught endpoint:** `POST /v1/bugs/caught` (`api/v1/bugs.py`), rate-limited, with the hourly cap.
- **Email and Scout:**
  - `email.py` scan failure paths record a report;
  - `scout_log.record(ok=False)` records one.
- **Health:** a scheduler job `health_watch` runs every 15 min; one report per outage.
- **Versions:** `__APP_VERSION__` (Vite `define` from `VERCEL_GIT_COMMIT_SHA`); the backend reads `RENDER_GIT_COMMIT`.

### PR C: Claude and Job Catcher (US6 tools, US8, Job Catcher caught errors)
- **Connector:**
  - `_owner_only`, plus `list_bug_reports`, `read_bug_report`, `update_bug_report`, `add_bug_report` (contract);
  - `docs/mcp-connector.md` updated.
- **Job Catcher, background:**
  - `/v1/extension/hello` returns `is_owner`;
  - `background.entry.js` posts real save and résumé failures to `/v1/bugs/caught`;
  - a new message `reportProblem` takes a page photo (reuses `capture` and `shrink`) and posts the report and its shot with the pass.
- **Job Catcher, panel:** the **Report a problem here** link and a small form, owner only.
- **Release:** version 0.45.0.
- **Also:** `require_admin_or_pass` for the two owner routes Job Catcher uses.

Order: A, then B, then C. Each gets its own branch, review, fixes and merge.

## Project Structure

### Documentation (this feature)

```text
specs/032-bug-inbox/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/rest.md, contracts/connector-tools.md
└── checklists/requirements.md
```

### Source Code

```text
backend/alembic/versions/a5…_bug_reports.py         new (tables + bring in run problems + starting entries)
backend/app/models/bug_report.py                    new (4 models) + models/__init__.py
backend/app/schemas/bug_reports.py                  new
backend/app/services/bug_reports.py                 new (all rules)
backend/app/services/apply_problems.py              scrub(text, cap); admin_list/set_status removed
backend/app/services/apply_runs.py                  report_problem also feeds the inbox
backend/app/services/admin_service.py               health_watch job body
backend/app/services/scout_log.py                   refusals recorded
backend/app/api/v1/admin_bugs.py                    new; admin.py apply-problems routes removed
backend/app/api/v1/bugs.py                          new (/v1/bugs/caught)
backend/app/api/v1/attention.py, email.py, extension.py
backend/app/middleware/auth.py                      require_admin_or_pass
backend/app/main.py                                 handler records; health_watch scheduled; routers
backend/app/mcp_server.py                           _owner_only + 4 tools
frontend/src/routes/AdminBugsPage.tsx               new; router.tsx (route + errorElement)
frontend/src/components/bugs/*                      new
frontend/src/components/admin/BugReportsCard.tsx    removed
frontend/src/components/layout/*                    Add button; Admin count
frontend/src/hooks/useBugReports.ts                 new; useAdmin.ts old hooks removed
frontend/src/lib/bugReport.ts, catchErrors.ts, shrinkImage.ts, appVersion.ts
frontend/vite.config.ts                             define __APP_VERSION__
extension/src/background.entry.js, background/*     caught posts, reportProblem
extension/panel/src/views/ReportProblem.tsx         new; App/Settings link
extension/manifest.json                             0.45.0
```

**Structure Decision**: the existing web app layout (backend/, frontend/, extension/). Nothing new at the top level.

## Risks

- **Error floods after a bad deploy:** handled by fingerprints, the hourly cap, and the rate limit.
- **A recording loop:** recording never raises, and the browser guard stops nested reports.
- **Health pings on a schedule wake the external APIs every 15 min:** they're cheap pings, and JSearch is never pinged (quota).
- **Removing the old admin routes:** only the admin card used them, and both go in the same PR.
