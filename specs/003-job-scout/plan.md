# Implementation Plan: Job Scout

**Branch**: `003-job-scout` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-job-scout/spec.md`

## Summary

**Claude Scout**, a new tab in the Search area (renamed **Find Jobs**, beside
today's Job boards search): the user keeps a few **resume tracks** (one resume per
kind of role), builds **missions** (source × track × count × recency × pay ×
fit bar), and launches a run that produces a two-line prompt for **Claude in
Chrome**. The browser agent does the human-like browsing (LinkedIn, Indeed, or
small local company career pages); the app is its memory. Through new tools on
the existing MCP connector the agent fetches a brief (criteria, versioned
playbook, everything to skip), reports each job with a 0–10 fit score, logs each
company it checked, and finishes the run. The app dedupes against the tracker and
every past finding, saves good fits into a "Scout" folder tagged with their
track, and shows the run live.

## Technical Context

**Language/Version**: Python 3.11 (backend), TypeScript 5 / React 19 (frontend)
**Primary Dependencies**: FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2,
FastMCP (existing connector); Vite, React Router 7, TanStack Query v5,
Tailwind v4, shadcn/ui
**Storage**: Supabase Postgres — 5 new tables + 2 columns on `saved_jobs` ([data-model.md](data-model.md))
**Testing**: pytest (SQLite in-memory + Postgres-specific checks per the schema-drift lesson), Vitest, Playwright for the page
**Target Platform**: Render (API + MCP), Vercel (web), Claude in Chrome on the user's machine
**Project Type**: Web application (existing `backend/` + `frontend/`)
**Performance Goals**: brief < 500 ms with 1,000 saved jobs; report_job < 300 ms; page polls every 5 s only while a run is open
**Constraints**: $0 hosting (no headless browsers, no queues); the app never scrapes; board runs capped at 15 jobs; Supabase egress-conscious (no full-list polling)
**Scale/Scope**: one user + friends; ~8 tracks, tens of missions, a few runs a day, hundreds of companies

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| I. Portfolio quality | One clear feature story ("an AI agent with a memory"), documented contracts, MANIFEST updates, screenshots for the README |
| II. User-centric | Built around the user's two biggest time sinks; one page, guided first track, prompt copied in two clicks; phone + desktop |
| III. AI-powered | Claude does the browsing and scoring; the playbook and rubric are versioned in the repo (`backend/app/scout/playbook.md`); no new LLM cost for the app |
| IV. Security & privacy | Connector tools are user-scoped and validated; tools cannot change stages; no personal data in logs; RLS on new tables; board-terms risk stated in the UI |
| V. Tests | Service unit tests (dedupe, due logic, URL canonicalisation), API + MCP contract tests, component tests, one e2e |
| VI. Clean architecture | Routes → `services/scout_*.py` → models; MCP tools call the same services as REST |
| VII. Simplicity | Reuses connector, resumes, collections, save service; polling instead of websockets; no scheduler |

Gate: **pass** (no violations). Note: the constitution still names Next.js/NextAuth; the app is Vite + Supabase Auth since 2026-07 — wording drift, not a violation.

## Project Structure

### Documentation (this feature)

```text
specs/003-job-scout/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── mcp-tools.md
│   └── rest-api.md
└── tasks.md            # next: /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── alembic/versions/xxxx_job_scout.py
├── app/
│   ├── models/{resume_track,scout_mission,scout_run,scout_finding,scout_company}.py
│   ├── schemas/scout.py
│   ├── services/
│   │   ├── scout_tracks.py       # CRUD + limits
│   │   ├── scout_runs.py         # missions, runs, brief, report, finish
│   │   ├── scout_dedupe.py       # keys + URL canonicalisation (pure)
│   │   └── scout_companies.py    # due/hot/blocked
│   ├── scout/playbook.md         # versioned agent instructions + rubric
│   ├── api/v1/scout.py
│   └── mcp_server.py             # + get_scout_brief, check_job, report_job, log_company, finish_scout_run
└── tests/{services/test_scout_*.py, api/test_scout.py, test_mcp_scout.py}

frontend/
├── src/
│   ├── routes/SearchPage.tsx     # "Find Jobs": tabs Job boards (existing) · Claude Scout
│   ├── routes/DashboardLayout.tsx # nav label Search → Find Jobs
│   ├── components/scout/ScoutPanel.tsx  # views: Start · History · Companies · Resume types
│   ├── components/scout/{MissionBuilder,PromptCard,RunLive,FindingRow,TrackEditor,CompanyTable}.tsx
│   ├── hooks/useScout.ts
│   └── lib/scout.ts              # labels, fit bands (pure)
└── tests/{lib/scout.test.ts, components/Scout*.test.tsx}
```

**Structure Decision**: existing web-app layout; the feature is one backend
service family + a new tab in the existing Search route (renamed Find Jobs),
plus tools on the existing connector. Auto-apply to Scout's jobs is the next
feature and builds on each job's resume type.

## Delivery slices

1. **Tracks** (US1): model, CRUD, Tracks tab, track badge + resume on job page.
2. **Board missions** (US2): missions, runs, brief/check/report/finish, prompt card, live run, dedupe. *This is the demo.*
3. **Local companies** (US3): company log, due logic, Companies tab.
4. **Review & stats** (US4): dismiss → skip, per-track/source tallies, README section.

Each slice ships on its own branch → PR → CI → merge, like the email work.

## Complexity Tracking

None.
