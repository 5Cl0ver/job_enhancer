# Implementation Plan: Claude Scout finds better jobs

**Branch**: `009-scout-smarter-search` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-scout-smarter-search/spec.md`

## Summary

Every Scout run now scores against the user's real resume. Claude reads it
through the connector's existing `get_master_profile` tool at the start of a
run, and nothing new is stored.

A new search choice, **Anything I'd be good at**, works like this:

- It's a hidden "broad" resume type per user, so every existing key and path
  keeps working.
- On each run, Claude chooses up to 8 titles from the resume and sends them
  through a new `set_search_titles` tool.
- The app applies the user's overrides (Always, Never, Avoid), builds the
  search link with the user's own filters, and remembers how each title did.
  It rests titles that keep finding nothing.
- History shows each run's titles with their good fits, and one-tap pin,
  block and add-to-resume-type.
- Good fits carry the closest resume type, so saving uses the right resume.

## Technical Context

**Language/Version**: Python 3.11 (backend), TypeScript 5 / React 19 (frontend)

**Primary Dependencies**:
- Backend: FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2, FastMCP
- Frontend: Vite, TanStack Query v5, Tailwind v4, Radix

**Storage**: Supabase Postgres (SQLite in tests). One migration: `resume_tracks.kind`, `scout_missions.overrides`, `scout_findings.search_title` and `closest_track_id`, and a new `scout_titles` table with RLS.

**Testing**: pytest (async, SQLite) plus the migration round trip and offline Postgres SQL. A rolled-back Postgres run on the trial copy. Vitest for the page.

**Target Platform**: Render (API), Vercel (web), Claude in Chrome through the connector; phone and computer browsers

**Project Type**: Web application (backend + frontend); the Job Catcher extension is unchanged

**Performance Goals**: The brief stays under 6,000 characters whatever the tracker size. `set_search_titles` and `check_jobs` answer in one round trip each.

**Constraints**:
- The resume is never stored in run, finding or title records.
- Claude never builds a search link or changes filters.
- Per account only.
- $0 hosting, so no new services.

**Scale/Scope**: The user plus a few friends. A broad search keeps at most a few hundred title rows.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan meets it | Pass |
|---|---|---|
| I. Portfolio-grade quality | Spec, plan, research and contracts in `specs/009-…`; manifests updated; conventional, descriptive commits; ruff, eslint and tsc clean | ✅ |
| II. User-centric | Solves the user's stated problem (can't find strong fits); no approval step, overrides only when wanted; works on a phone (FR-023) | ✅ |
| III. AI-powered | Claude judges fit against the real resume and picks adjacent roles. All prompt wording is in version-controlled `app/scout/*.md` with a version bump. No app-side AI cost (research R12). A broad search can't start without a resume; scoped searches fall back to resume-type-only scoring | ✅ |
| IV. Security and privacy | Resume only through the user's own signed-in connector, never stored (FR-003). RLS on `scout_titles`. Every route and tool scoped to the user. Input limits on overrides and titles | ✅ |
| V. Test-driven | Service and connector tests for each FR; migration tests; API tests for the new and changed routes; Vitest for the new UI; Postgres check on the trial copy | ✅ |
| VI. Clean architecture | Logic in `services/scout_runs.py` and a new `services/scout_titles.py`; tools stay thin in `mcp_server.py`; routes stay thin | ✅ |
| VII. Simplicity | Reuses the track key (hidden broad track) instead of making `track_id` optional everywhere; one search link per run; resting is computed, not stored | ✅ |

**Post-design re-check**: still passes. The only new table is small and per
user, and the hidden track is the simpler option (research R2), so there's
nothing to justify under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/009-scout-smarter-search/
├── spec.md
├── plan.md              # This file
├── research.md          # R1–R12 decisions
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── connector-tools.md
│   └── rest-api.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
backend/
├── alembic/versions/g5b6c7d8e9f1_scout_broad_search.py   # new migration
├── app/
│   ├── models/resume_track.py        # + kind
│   ├── models/scout.py               # + overrides, search_title, closest_track_id, ScoutTitle
│   ├── schemas/scout.py              # MissionCreate/Update/Out broad+overrides; RunOut titles; FindingOut closest_track_name
│   ├── services/scout_tracks.py      # scoped-only lists/limits; broad_track(); reserved name
│   ├── services/scout_titles.py      # NEW: choose(), record_runs(), credit_fit(), tried(), resting rule
│   ├── services/scout_runs.py        # queue_run (broad, overrides, resume check), brief, search_titles, report_job, runs_out
│   ├── services/scout_review.py      # "Claude's picks" default; save with closest track
│   ├── mcp_server.py                 # + set_search_titles; report_job resume_type
│   ├── api/v1/scout.py               # GET /missions/{id}/titles; broad on missions
│   └── scout/playbook.md, broad.md   # resume step; broad steps (NEW)
└── tests/                            # test_scout_broad.py, test_scout_resume_grounding.py, test_migration_scout_broad.py, API tests

frontend/
├── src/lib/scout.ts                  # types: broad, overrides, titles, closest_track_name
├── src/hooks/useScout.ts             # useMissionTitles
├── src/components/scout/ScoutStart.tsx     # "Anything I'd be good at" choice, overrides editor, no-resume note
├── src/components/scout/BroadOverrides.tsx # NEW: Always / Never / Avoid lists + Titles tried
├── src/components/scout/RunTitles.tsx      # NEW: "Claude searched for" with pin / block / add to resume type
├── src/components/scout/ScoutHistory.tsx, RunReview.tsx  # titles; closest resume type
├── src/components/scout/ResumeTypes.tsx    # "no skills listed" flag
└── tests/                            # Vitest for the above
```

**Structure Decision**: The existing web-application layout (`backend/` +
`frontend/`); no extension change.

## Complexity Tracking

No constitution violations to justify.
