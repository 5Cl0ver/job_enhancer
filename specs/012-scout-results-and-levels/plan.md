# Implementation Plan: Scout results you can see, sort and act on, at your level

**Branch**: `012-scout-results-and-levels` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/012-scout-results-and-levels/spec.md`

## Summary

Scout finds jobs but hides them, stops early and ignores the user's level.
This plan:

- adds a **Results** tab where every job Claude found is grouped Best /
  Possible / Long shots, with save and pass
- adds a plain **"what I'm looking for"** line per search and a **Last run**
  card on Start
- adds **levels** (Entry / Mid / Senior) and years per resume type. LinkedIn's
  experience filter applies them, and an app-side cap makes them stick.
- adds **recommended settings** in one press
- makes Claude **smarter**:
  - short facts with every job, so nothing is nameless
  - an "in area" check
  - thin searches widen themselves
  - Claude suggests entry/mid related titles
  - company-site page copying is fixed, and the openings Claude saw are listed

Research: [research.md](research.md). Data: [data-model.md](data-model.md).
API and tools: [contracts/api.md](contracts/api.md).

## Technical Context

**Language/Version**: Python 3.11 (backend), TypeScript / React 19 (frontend), JavaScript MV3 (extension)

**Primary Dependencies**:
- Backend: FastAPI, SQLAlchemy 2 async, Alembic, Pydantic v2, FastMCP
- Frontend: Vite, TanStack Query, Radix Tabs/Dialog, Tailwind v4
- Extension: esbuild, Vitest, Playwright

No new libraries.

**Storage**: Supabase Postgres with RLS. One additive migration (data-model.md). SQLite in tests.

**Testing**:
- Backend: pytest, plus the trial-Postgres flow script
- Frontend: Vitest + Testing Library
- Extension: Vitest + the Playwright MV3 harness

**Target Platform**: Render (API), Vercel (web, phone and computer), Chrome (extension, Claude in Chrome)

**Project Type**: Web app (backend + frontend + extension)

**Performance Goals**: Results loads 100 findings in under 2 s; filters change without a full reload (cached query per filter).

**Constraints**:
- Never send job text from Claude.
- Never change the user's saved settings without their press.
- Phone parity, with no sideways scrolling.
- Invented company names in tests.

**Scale/Scope**: A handful of users and hundreds of findings each. Paging uses a `before` cursor.

## Constitution Check

| Principle | How this plan meets it |
|---|---|
| I. Portfolio quality | Spec-kit artifacts, typed contracts, tests for every new route, tool argument and component. |
| II. User-centric | Built from the user's own words. Everything Claude finds is visible and sorted. One-tap actions. WCAG: tabs, buttons with labels, 44px tap targets (`pointer-coarse:`). |
| III. AI-powered | Claude is given the level, years, area and suggested titles. The app enforces the level cap, so the AI's output is held to the user's choice. The prompts live in versioned `playbook.md` and `rubric` (010 shows them). |
| IV. Security / privacy | Every new route is user-scoped. Input caps on all new tool arguments. Facts are short, never job text. No emails touched. |
| V. Test-driven | Tests are written first for bands, caps, too_far, widening, suggestions, findings API and the UI components. Plus an extension fixture test for company pages. |
| VI. Clean architecture | Bands are worked out in one service (`scout_results.py`). Recommended settings come from one backend constant served to the UI. |
| VII. Simplicity | No new tables and no new libraries. Statuses come from the existing outcomes, plus one new outcome. |

**Gate: PASS**, with no violations to justify. Re-checked after design: still a pass.

## Project Structure

### Documentation (this feature)

```text
specs/012-scout-results-and-levels/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md            # next: /speckit-tasks
```

### Source Code

```text
backend/
├── alembic/versions/j8e9f0a1b2c4_scout_results_levels.py   # new
├── app/models/{resume_track,scout}.py                       # new columns, TOO_FAR
├── app/schemas/scout.py                                     # FindingItem/Page, RunOut extras, levels/years, Recommended
├── app/services/scout_results.py                            # new: bands, statuses, list/pass
├── app/services/scout_runs.py                               # f_E, level cap, facts, too_far, widen, suggest_titles, RECOMMENDED
├── app/services/scout_companies.py                          # last_openings
├── app/services/scout_instructions.py                       # rubric text: levels
├── app/scout/playbook.md, rules.md                          # facts, in_area, levels, suggestions, longer copy wait
├── app/mcp_server.py                                        # tool arguments
├── app/api/v1/scout.py                                      # /findings, /findings/{id}/pass, /recommended
└── tests/test_scout_results_levels.py                       # new (+ updates)

frontend/src/
├── components/scout/ScoutPanel.tsx      # 5 tabs: Start · Results · History · Types · Rules (full labels on computer)
├── components/scout/ScoutResults.tsx    # new: groups, filters, sort, save/pass
├── components/scout/LastRun.tsx         # new: Last run card + waiting line
├── components/scout/ScoutStart.tsx      # plain "looking for" line; old review cards → waiting line
├── components/scout/Recommended.tsx     # new: shows the changes, applies them
├── components/scout/ResumeTypes.tsx     # Level chips, years, recommended button
├── components/scout/ScoutCompanies.tsx  # "Has jobs listed", openings list
├── components/scout/RunTitles.tsx       # suggested titles + Keep
├── hooks/useScout.ts, lib/scout.ts      # findings/pass/recommended hooks, band labels, lookingFor()
└── **/*.test.tsx

extension/
├── src/scoutCapture.js, src/extract/*   # title fallback, more hiring-system hosts
└── e2e/scout-company.spec.js + fixtures # Workday-style late page, Oleeo-style page
```

**Structure Decision**: The existing web-app layout. New logic gets its own
service (`scout_results.py`) and components (`ScoutResults`, `LastRun`,
`Recommended`), so the large ScoutStart and scout_runs files don't grow much.

## Build order (one PR, in slices that ship together)

1. **Data and results.**
   - Migration, models, `scout_results.py`, GET /findings, pass and
     recommended routes.
   - Results tab, Last run card and waiting line.
   - This is the P1 "see everything" slice and works with existing data.
2. **Levels and recommended settings.**
   - Levels and years on types.
   - `f_E`, the level cap, rubric and playbook text.
   - The recommended settings dialog.
3. **Smarter Claude.**
   - Facts on report_job, in_area → too_far.
   - Thin searches widen themselves.
   - Suggested titles with Keep.
4. **Company pages.**
   - Extension fixtures and fix.
   - Longer copy wait.
   - Openings list and the extension health line.
5. **Checks.**
   - Full tests, trial Postgres, independent review.
   - PR → merge only after the user's OK.
   - Then the deploy check, a note to reload the extension, and suggesting
     recommended settings for the user's data. Their data changes only when
     they press the button.

## Complexity Tracking

None.
