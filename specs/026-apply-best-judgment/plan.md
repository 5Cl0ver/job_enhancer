# Implementation Plan: Apply with best judgment

**Branch**: `026-apply-best-judgment` | **Date**: 2026-11-25 | **Spec**: [spec.md](spec.md)

**Input**: The feature specification from `specs/026-apply-best-judgment/spec.md`.

## Summary

Four fixes to Apply with Claude, from the first real runs:
1. **The résumé is attached**: Job Catcher uses the run's own résumé, and sees upload boxes hidden behind a "Select files" button (Workday).
2. **Photos work** while Claude's tab isn't showing: Job Catcher shows the tab for a moment, photographs it, and puts the user's tab back.
3. **Best judgment**: Claude fills everything, marks its guesses, and only stops for sign-in, CAPTCHA, files and facts about the user.
4. **See it all**: a live "Filling now" list while it works (Job Catcher reads the page; no Claude tokens), plain-word problems, and answer bubbles at the review with batched fixes.

## Technical Context

| | |
|---|---|
| **Language/Version** | Python 3.11 (backend), TypeScript/React 19 (app), JavaScript MV3 (Job Catcher) |
| **Primary Dependencies** | FastAPI, SQLAlchemy 2 async, Alembic, FastMCP; Vite, TanStack Query v5, shadcn/ui; esbuild |
| **Storage** | Postgres: one nullable JSON column `apply_runs.live` (migration `w1f2a3b4c5d7`, after 025's). Answer flags and fixes live in the existing JSON columns |
| **Testing** | pytest (service, routes, tools, migration SQL), vitest (app), vitest + Playwright MV3 harness (Job Catcher) |
| **Target Platform** | Render, Vercel, Chrome (Job Catcher 0.42.0) |
| **Performance Goals** | Live view ≤ 5 s behind the page; ≤ 1 small POST per 3 s while filling, none when nothing changed |
| **Constraints** | No AI in the app; no new connector tools; old Job Catcher keeps working; never send passwords; $0 |
| **Scale/Scope** | One open run per user; ≤ 150 boxes per live snapshot |

All unknowns are resolved in [research.md](research.md).

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ Spec, research, data model, contracts, quickstart, tasks; MANIFESTs updated. |
| II. User-centric | ✅ Fewer stops, a live view, plain problems, one-tap fixes; phone parity. |
| III. AI-powered | ✅ Claude does the judgment through the connector; the app adds no AI. The live view costs no tokens. |
| IV. Security & privacy | ✅ Owner-only routes; the live view never carries password/SSN/card boxes; values trimmed; live data cleared when the run leaves filling. Bring-to-front only for the run's own tab during an open run. The new `idle` permission has no install warning and only reads "active/idle/locked". |
| V. Test-driven | ✅ Tests for each story (see tasks). |
| VI. Clean architecture | ✅ The pure parts (upload-box finding, live snapshot, bubble ordering) are pure functions with unit tests. |
| VII. Simplicity | ✅ One column, optional fields on existing tools, no new tools. |

**Gates pass. Re-checked after the design: still pass.**

## Project Structure

### Documentation

```text
specs/026-apply-best-judgment/
├── spec.md
├── plan.md            # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
└── tasks.md
```

### Source Code

```text
backend/
├── alembic/versions/w1f2a3b4c5d7_apply_live.py
├── app/models/apply.py                 # ApplyRun.live
├── app/services/apply_runs.py          # live(), answer flags, fixes, fill/photo results in plain words
├── app/api/v1/apply.py                 # POST runs/{id}/live; decision with fixes
├── app/mcp_server.py                   # page_done/ready_for_review answers: guess, agreement; wait_for_you: fixes
├── app/apply/playbook.md, rules.md     # best judgment
frontend/src/
├── lib/apply.ts                        # types, bubble ordering, plain problem words
├── components/apply/LiveFill.tsx       # Filling now
├── components/apply/Bubbles.tsx        # answer bubbles + fix tray
├── components/apply/Pages.tsx, Review.tsx, Remote.tsx
extension/
├── manifest.json                       # 0.42.0, "idle"
├── src/background/applyRun.js          # run résumé, bring-to-front photos, live loop
├── src/background.entry.js             # getAutofillCopy uses the run's résumé
├── src/autofill/scan.js                # hidden upload boxes behind buttons
├── src/autofill/resolve.js             # Workday résumé box
├── src/autofill.entry.js / session.js  # résumé state in the report
```

**PRs:**
- **026 A (server + app):** the live column and route, answer flags, fixes, plain problems, the playbook, Filling now, bubbles. Works with Job Catcher 0.41.0 (no live view until B).
- **026 B (Job Catcher 0.42.0):** run résumé, hidden upload boxes, photos, live loop, résumé state.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| Switching tabs annoys a user at the computer | It lasts about a second, only for the run's own tab during an open run, and the user's tab comes back. When the user is active at the computer and the window is hidden behind other apps, nothing is raised: the page is kept as text and the reason is shown. |
| Best judgment writes a wrong fact | Facts about the user are never guessed (locked rule); guesses are marked and shown first at the review; nothing is sent without the user's Submit. |
| Ticking agreements | Only ones required to go on; listed at the review for the user's OK; the final Submit is the user's. |
| Live view leaking secrets | Password, SSN, card and CVV boxes are never read; values ≤ 300 chars; cleared when filling ends; owner-only. |
| Request volume | Job Catcher sends only on change, at most every 3 s, only while filling. |

## Complexity Tracking

No violations.
