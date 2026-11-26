# Implementation Plan: one checklist, edit while it fills, problems report

**Branch**: `030-apply-checklist` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

## Summary

1. **Edit while it fills**: Filling now's lines become buttons; a pop-up sends a change or a question to a new owner route, which puts it in the run's conversation as an unread message carrying `fix`. Claude already reads unread messages in every tool result (`from_user`), so nothing new on its side but a note.
2. **One checklist**: `ask_questions` gains `guess`, `choices`, `only_you` and works while filling too; questions carry a `batch`. The app's Questions card becomes the checklist.
3. **Problems report**: a new connector tool `report_problem` stores capped, scrubbed lines in `apply_runs.problems`; the run page shows them closed; the admin page lists them across runs.

## Technical Context

| | |
|---|---|
| **Language/Version** | Python 3.11 (backend), TypeScript/React 19 (app) |
| **Primary Dependencies** | FastAPI, SQLAlchemy 2 async, Alembic, FastMCP; Vite, TanStack Query v5, shadcn/ui |
| **Storage** | One JSON column `apply_runs.problems` (NOT NULL, default `[]`), migration `y3b4c5d6e7f9` after 029's `y3c5e7a9b1d2`. Checklist fields and fixes live in the existing `questions` and `messages` JSON |
| **Testing** | pytest (tools, service, routes, migration SQL), vitest (checklist, pop-up, problems) |
| **Constraints** | No AI in the app; Job Catcher unchanged; $0 |

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ Short spec, plan, research, data model, tasks; MANIFESTs updated. |
| II. User-centric | ✅ One list instead of many stops; change things without waiting for the review; phone first. |
| III. AI-powered | ✅ Claude does the judgment through the connector; the app adds no AI. |
| IV. Security & privacy | ✅ Owner-only run routes, admin-only list (`require_admin`); caps on every list and string; kinds checked; secrets scrubbed; page query dropped; sensitive questions never asked or fixed. |
| V. Test-driven | ✅ Each story has tests. |
| VI. Clean architecture | ✅ Problems in their own small service (`apply_problems.py`); fixes reuse the message inbox. |
| VII. Simplicity | ✅ One column, one route each, one new tool; existing tools extended. |

## Project Structure

```text
backend/alembic/versions/y3b4c5d6e7f9_apply_problems.py   new
backend/app/models/apply.py                               problems column
backend/app/services/apply_problems.py                    new: scrub, add, admin_list
backend/app/services/apply_runs.py                        checklist, live_fix, report_problem, inbox fix
backend/app/mcp_server.py                                 ask_questions docs, need_help docs, report_problem
backend/app/api/v1/apply.py, admin.py; schemas/apply.py   live-fix, apply-problems
backend/app/apply/playbook.md, rules.md; apply_playbook.py version 2026.11.30
frontend/src/components/apply/Questions.tsx               the checklist
frontend/src/components/apply/LiveFill.tsx                tap a line, LiveFixSheet
frontend/src/components/apply/Problems.tsx                new
frontend/src/components/admin/ApplyProblemsCard.tsx       new
frontend/src/lib/apply.ts, hooks/useApply.ts, hooks/useAdmin.ts
```
