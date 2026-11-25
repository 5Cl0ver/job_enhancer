# Implementation Plan: Sites to skip

**Branch**: `024-sites-to-skip` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: The feature specification from `specs/024-sites-to-skip/spec.md`.

> **Status: built.** The owner said go on 2026-11-25; see [tasks.md](tasks.md).

## Summary

A **Sites to skip** list the user keeps in Claude Scout › Instructions. Claude Scout never brings jobs from those sites, and Apply with Claude never applies through them. The server checks every link it gets, so Claude reads at most one extra line and makes no extra calls.

The live data shows why: learn4good, jobleads and the like make up about 1 in 6 of Scout's finds.

## Technical Context

| | |
|---|---|
| **Language/Version** | Python 3.11 (backend), TypeScript/React 19 (app) |
| **Primary Dependencies** | FastAPI, SQLAlchemy 2 async, Alembic, FastMCP; Vite, TanStack Query v5 |
| **Storage** | Postgres (Supabase): one new small table `skipped_sites` |
| **Testing** | pytest (SQLite + offline Postgres SQL for the migration), vitest |
| **Target Platform** | Render (API), Vercel (app, phone and computer) |
| **Project Type** | Web app + MCP connector |
| **Performance Goals** | One indexed query per check; no new connector calls |
| **Constraints** | Token-light (one brief line at most); no change to how Scout looks or works otherwise |
| **Scale/Scope** | ≤100 sites per user |

All unknowns were resolved in [research.md](research.md).

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ Spec, research, data model, contracts and quickstart; MANIFESTs updated when built. |
| II. User-centric | ✅ One section, paste a link, one-tap suggestions, a warning before skipping a source Scout needs. |
| III. AI-powered | ✅ No new AI. Claude reads one line; the server does the checking. |
| IV. Security & privacy | ✅ See the notes below. |
| V. Test-driven | ✅ Unit tests for matching; tool tests for check_jobs, report_job and the briefs; route and migration tests; one app component test. |
| VI. Clean architecture | ✅ A `skipped_sites` service, thin routes, a reuse of the existing host helpers. |
| VII. Simplicity | ✅ One table, one section, no new tools. |

**Security & privacy notes:**
- Owner-only routes and input checks: a host only, length-capped, at most 100.
- RLS is on for the new table.
- Included in the data export and removed with the account.

**Gates pass. Re-checked after the design: still pass.**

## Project Structure

### Documentation

```text
specs/024-sites-to-skip/
├── spec.md
├── plan.md            # this file
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/interfaces.md
```

### Source Code (when built)

```text
backend/
├── alembic/versions/u9d0e1f2a3b5_skipped_sites.py
├── app/models/skipped_site.py
├── app/services/skipped_sites.py       # host_of, matches, add/remove/list, suggestions, is_skipped
├── app/api/v1/skipped_sites.py
├── app/services/scout_runs.py          # brief line; check_jobs + report_job filters
├── app/services/apply_runs.py          # apply brief flag
└── app/scout/rules.md                  # one locked line

frontend/src/
├── components/scout/SkippedSites.tsx   # the section (Instructions)
├── hooks/useSkippedSites.ts
└── components/jobs/JobActions.tsx      # "Never this site"
```

**Structure decision:** one PR. It is small, and both sides ship together. The backend is additive, so the app only shows the section once the routes exist.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| Skipping a source Scout searches (LinkedIn) would empty runs | Warn and confirm first (409 needs_confirm). |
| A look-alike host matching by accident | Exact host or a real sub-site only (R5); tested. |
| Claude retrying the same skipped link | The refusal says exactly what to do instead, and the brief lists the sites up front. |
| Token growth | One line, only when the list isn't empty. |

## Complexity Tracking

No violations.
