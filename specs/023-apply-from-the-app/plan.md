# Implementation Plan: Apply from the app

**Branch**: `023-apply-from-the-app` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: The feature specification from `specs/023-apply-from-the-app/spec.md`.

## Summary

Make the application page the remote control for a run:
- answer Claude (quick answers or typed text) next to a photo of the screen;
- talk to Claude any time;
- see the screen now;
- know when Claude stopped;
- be sure it was sent (Job Catcher reads the confirmation page);
- know Job Catcher is ready.

Built on spec 022's run, requests and photos. No new tables.

## Technical Context

| | |
|---|---|
| **Language/Version** | Python 3.11 (backend), TypeScript/React 19 (app), JavaScript MV3 (Job Catcher) |
| **Primary Dependencies** | FastAPI, SQLAlchemy 2 async, Alembic, FastMCP; Vite, TanStack Query v5; esbuild, Vitest, Playwright |
| **Storage** | Postgres (Supabase): two new columns on `apply_runs`; a data fix on `job_listings` |
| **Testing** | pytest (SQLite + offline Postgres SQL for the migration), vitest, Playwright (real Chromium) |
| **Target Platform** | Render (API), Vercel (app, phone and computer), Chrome (Job Catcher) |
| **Project Type** | Web app + browser extension + MCP connector |
| **Performance Goals** | A reply reaches Claude on its next check (≤45 s). A "screen now" photo in ≤10 s. The page polls every 3 s while open. |
| **Constraints** | $0 hosting; the MCP client's ~60 s request timeout; Chrome's 2 captures per second |
| **Scale/Scope** | Owner + friends; ≤200 messages and ≤5 "screen now" photos per run |

All unknowns were resolved in [research.md](research.md).

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ The spec, plan, research, data model, contracts and quickstart are written; MANIFESTs will be updated. |
| II. User-centric | ✅ Plain-words UI, phone-first. It's driven by the owner's real runs. |
| III. AI-powered | ✅ Claude does the thinking. The app adds no AI calls, and degrades when Job Catcher is missing (says so). |
| IV. Security & privacy | ✅ See the notes below. |
| V. Test-driven | ✅ Tests for every new path in each of the three suites, plus a real-browser test for the screen-now photo and the confirmation. |
| VI. Clean architecture | ✅ Services do the logic, routes stay thin, the extension is pure helpers plus thin wiring. |
| VII. Simplicity | ✅ JSON on the existing run row. No new tables, no push service. |

**Security & privacy notes:**
- Every route is owner-scoped.
- Message length is capped.
- Peeks follow the same tab checks as page photos (never another tab).
- The confirmation only ends runs the user already OK'd.
- No password is ever read.
- The new columns are covered by the RLS already on `apply_runs`.

**Gates pass. Re-checked after the design: still pass.**

## Project Structure

### Documentation (this feature)

```text
specs/023-apply-from-the-app/
├── spec.md
├── plan.md            # this file
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/interfaces.md
└── tasks.md           # /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── alembic/versions/t8c9d0e1f2a4_apply_from_the_app.py   # messages, claude_at, entity fix
├── app/models/apply.py, app/models/job_listing.py         # columns; @validates unescape
├── app/services/apply_runs.py                             # messages, replies, peeks, stopped, confirmation, readiness
├── app/api/v1/apply.py, app/schemas/apply.py              # messages, peek, help reply, not-sent
├── app/mcp_server.py                                      # message_user; from_user on every tool
└── app/apply/playbook.md, rules.md                        # choices, message_user, agreements, CAPTCHA

frontend/src/
├── lib/apply.ts, hooks/useApply.ts
├── components/apply/{Conversation,HelpCard,ScreenNow,Stopped,DidItGo,Readiness}.tsx
└── routes/ApplyRunPage.tsx                                # wiring, tab title

extension/
├── src/background/applyRun.js                             # peek, confirmation photo + event
├── src/autofill/applyMode.js, applyPage.js                # confirmation watch, CONFIRM words
├── src/extract/util.js                                    # clean() decodes entities
└── panel/src/lib/context.ts                               # the app is never "an application"
```

**Structure decision:** the same three-part layout as spec 022.

| Part | Branch | PR |
|---|---|---|
| A | `023-apply-from-the-app` | backend, plus these docs |
| B | `023-apply-from-the-app-ui` | app |
| C | `023-apply-from-the-app-jc` | Job Catcher 0.41.0 |

Merge A first; B and C only use A's routes.

## Complexity Tracking

No violations.
