# Implementation Plan: See and control everything Claude Scout is told

**Branch**: `010-scout-instructions` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-scout-instructions/spec.md`

## Summary

A new **Instructions** tab shows everything a Scout run gives Claude:

- the main steps, the extra steps for each source, the scoring weights and the
  limits (all editable per account, with history)
- the locked rules and the tool descriptions (read-only)

The always-apply rules move to a locked file the app adds after the user's
main steps, so no edit can remove them.

Each run snapshots its instructions at Start. A Preview builds the brief for
any saved search without creating anything. A new run log records every Scout
connector call, with plain summaries and trimmed detail; it never stores the
resume or repeats the instruction texts.

## Technical Context

**Language/Version**: Python 3.11 (backend), TypeScript 5 / React 19 (frontend)

**Primary Dependencies**:
- Backend: FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2, FastMCP
- Frontend: Vite, TanStack Query v5, Tailwind v4, Radix

**Storage**: Supabase Postgres (SQLite in tests). One migration, `h6c7d8e9f0a2`, adds two tables (`scout_instruction_versions`, `scout_run_events`), each with RLS.

**Testing**: pytest (service, connector, API, migration); Vitest; a rolled-back run on the trial Postgres copy.

**Target Platform**: Render (API), Vercel (web), Claude in Chrome through the connector; phone and computer browsers

**Project Type**: Web application (backend + frontend)

**Performance Goals**:
- The brief stays under 6,000 characters with the original texts. Edited texts add their own length.
- The log for a run loads in one request (at most 400 short rows).

**Constraints**:
- Per account only.
- Nothing can remove the locked rules.
- No resume and no instruction texts in the log.
- $0 hosting.

**Scale/Scope**: The user and a few friends. At most 6 sections × 20 versions each per user.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan meets it | Pass |
|---|---|---|
| I. Portfolio-grade quality | Spec, plan, research and contracts written; manifests updated; descriptive commits; linters clean | ✅ |
| II. User-centric | Answers the user's ask: see everything, edit, control, and find what went wrong. Phone-first layout with folded long texts | ✅ |
| III. AI-powered | Prompt engineering becomes visible and versioned, per account, on top of the version-controlled originals in `app/scout/*.md` (bumped `PLAYBOOK_VERSION`) | ✅ |
| IV. Security and privacy | Owner-only routes (404); RLS on both tables; length and shape checks at the boundary; text rendered as text; locked rules have no write route; resume never logged | ✅ |
| V. Test-driven | Tests per FR: versions, reset and restore, validation, the snapshot, locked rules always appended, limits applied, preview creates nothing, log written and trimmed and capped, owner-only | ✅ |
| VI. Clean architecture | New `services/scout_instructions.py` and `services/scout_log.py`; tools stay thin with one logging wrapper; routes stay thin | ✅ |
| VII. Simplicity | One versions table for every section; the snapshot lives in `criteria` (no extra table); the log is written at the connector edge only | ✅ |

**Post-design re-check**: passes. There's nothing to justify under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/010-scout-instructions/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/rest-api.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── alembic/versions/h6c7d8e9f0a2_scout_instructions_and_log.py
├── app/
│   ├── models/scout.py                   # ScoutInstructionVersion, ScoutRunEvent
│   ├── schemas/scout.py                  # section, version, event shapes; RunOut.instructions
│   ├── scout/playbook.md, rules.md       # rules moved out to the locked file (NEW)
│   ├── services/scout_instructions.py    # NEW: originals, current, save/reset/restore/history, snapshot, assemble
│   ├── services/scout_log.py             # NEW: record, summarize, trim, list
│   ├── services/scout_runs.py            # _criteria, snapshot at queue, brief from snapshot, limits, preview
│   ├── services/scout_titles.py          # titles limit from the run
│   ├── services/scout_companies.py       # companies limit from the run
│   ├── mcp_server.py                     # logging wrapper on Scout tools; resume-read event
│   └── api/v1/scout.py                   # instructions routes, preview, run log
└── tests/                                # test_scout_instructions.py, test_scout_log.py, API + migration tests

frontend/
├── src/lib/scout.ts                      # types
├── src/hooks/useScout.ts                 # instruction / preview / log hooks
├── src/components/scout/ScoutInstructions.tsx   # NEW: the tab
├── src/components/scout/InstructionEditor.tsx   # NEW: text, rubric and limit editors with history
├── src/components/scout/ScoutPreview.tsx        # NEW
├── src/components/scout/RunLog.tsx              # NEW: in History
├── src/components/scout/ScoutPanel.tsx, ScoutHistory.tsx
└── tests/components/                     # Vitest for each
```

**Structure Decision**: The existing web-application layout; no extension change.

## Complexity Tracking

No violations.
