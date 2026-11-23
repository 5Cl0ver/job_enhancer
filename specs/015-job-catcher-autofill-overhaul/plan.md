# Implementation Plan: Job Catcher overhaul — instant, reviewable autofill on any application page

**Branch**: `015-job-catcher-autofill-overhaul` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/015-job-catcher-autofill-overhaul/spec.md`

## Summary

The autofill is rebuilt as a small pipeline of tested parts instead of one 1,050-line script with five separate passes.

1. **Scan.** Find every field, including those in hidden-inside components (shadow DOM) and frames, and give each a clear question.
2. **Decide.** Choose a value from profile → remembered → rule → AI, or a reason to leave it.
3. **Write.** Each field kind (text, dropdown, search dropdown, choice, date, file) has one writer that acts like a person and then reads the field back.
4. **Session.** Keeps what was filled and what it held before (for Undo). It also notices new steps and the user's own answers.

Speed comes from the background worker **holding a copy of everything autofill needs**. One new `GET /v1/autofill/bundle` request with a cheap version check fills that copy, and the résumé is read into work history and education **once**, stored on the résumé row. Pressing Autofill then makes no network call.

Review moves to the **side panel's new "Apply" view**. It sees every frame of the tab and doesn't cover the form. The page keeps only a one-line status pill, drawn inside its own shadow root so sites can't restyle it.

The work starts by building the **test lab**:
- invented application pages in real applicant-system shapes, including a real React form
- a fake app server
- a Playwright harness that loads a test copy of the built extension

The probe failures (search dropdown, confirm email, aria-labelled field, shadow DOM, slow serial calls) become the first red tests. Two quick wins can ship first, as they fix Scout today:
- re-injecting scripts into open tabs on update
- **Save anyway** in Scout Results

## Technical Context

**Language/Version**:
- Extension: JavaScript (ES2022), Chrome MV3, bundled by esbuild with Chrome 110 as the target.
- Backend: Python 3.11.
- Frontend: TypeScript, React 19.

**Primary Dependencies**:
- Extension: esbuild, Vitest + happy-dom (unit), Playwright (browser). New dev-only dependencies: `react` and `react-dom`, used only to build the lab's React form.
- Backend: FastAPI, SQLAlchemy async, Alembic, LangChain NVIDIA (existing AI).
- Frontend: TanStack Query, sonner.

**Storage**:
- `chrome.storage.local` holds the autofill copy and the résumé bytes. It is wiped on sign-out.
- `chrome.storage.session` holds the fill sessions per tab and frame, so they survive service-worker restarts and are gone when the browser closes.
- Postgres: an additive migration adds `resumes.parsed_history` (JSON) and `resumes.parsed_history_at`.

**Testing**:
- Vitest for the pure parts: scan, labels, classify, resolve, answer matching, writers where the DOM allows.
- Playwright in real Chromium with the built extension, against `extension/test/lab/` and `extension/e2e/support/fake-api.js`.
- pytest for the bundle endpoint, the résumé-reading cache, autofill-map confidence and Save anyway.
- Vitest/RTL for the Save anyway button.
- CI gets a new `extension` job (unit tests, then browser tests under xvfb).

**Target Platform**: Chrome desktop with Manifest V3, Chrome 116 or later (needed for `sidePanel.open` from a click).

**Project Type**: Web app (FastAPI + Vite React) plus a browser extension.

**Performance Goals**:
- Instant tier (press → filled) under 1 s with the copy present, regardless of server speed.
- Scan under 300 ms on a 300-control page.
- New-step fill under 1 s after the step appears.
- At most one AI request per step.

**Constraints**:
- Never submit.
- Never touch self-ID, consent, passwords or CAPTCHAs.
- Never overwrite user input.
- The AI gets only questions and options.
- No new permission that triggers a scary install warning. `unlimitedStorage` and `commands` add no warning; `webNavigation` and `tabs` are avoided.
- `extension/config.js` stays pointed at the live services. Tests use a temporary copy with a test config.

**Scale/Scope**:
- One user plus friends.
- About 10 lab page shapes.
- Roughly 3,000 new or rewritten lines in the extension and about 400 in the backend.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan meets it |
|---|---|
| I. Portfolio quality | The engine is split into single-purpose modules with a manifest. The lab plus browser tests are a showcase of the testing approach. The README Testing section is updated. |
| II. User-centric | Fills in under 1 s and puts review in one place. The UI is short: one status line, and a panel grouped as Needs you, Check these, then Filled (collapsed). |
| III. AI | AI is the last tier, batched and marked. Unsure answers are suggestions only. Nothing breaks without a key (FR-020b). The prompt lives in `ai_service.py`, under version control. |
| IV. Security & privacy | The copy stays in extension-only storage and is wiped on sign-out. The AI gets questions and options only. Self-ID and consent are never touched. Lab data is invented, and no personal data appears in tests or logs. |
| V. Tests | Lab browser tests check every story, so the "tests pass but the real thing fails" gap closes. CI runs the extension tests for the first time. |
| VI. Clean architecture | Scan, decide, write and session are separate. The background stays the only API caller. Site-specific code is isolated in `sites/`. |
| VII. Simplicity | No new profile columns: the long tail stays with remembered answers. No new permissions. Workday is the only site adapter. Everything else goes through the general engine. |

**Result: PASS.** Nothing goes in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/015-job-catcher-autofill-overhaul/
├── spec.md
├── plan.md              # this file
├── research.md          # decisions R1–R14
├── data-model.md        # copy, session, field, decision, résumé reading
├── quickstart.md        # how to run the lab + checks, and the live try
├── contracts/
│   ├── autofill-bundle.md      # GET /v1/autofill/bundle
│   ├── autofill-map.md         # POST /v1/ai/autofill-map (+confidence)
│   ├── scout-save-anyway.md    # POST /v1/scout/findings/{id}/save {anyway}
│   └── extension-messages.md   # content ⇄ background ⇄ panel messages
└── tasks.md             # next: /speckit-tasks
```

### Source Code (repository root)

```text
extension/
├── manifest.json                 # + commands, unlimitedStorage, match_origin_as_fallback
├── src/
│   ├── autofill.entry.js         # thin: boots a FillSession per frame, wires messages + pill
│   ├── autofill/
│   │   ├── scan/
│   │   │   ├── walk.js           # deep walk: document + open/closed shadow roots + same-origin frames
│   │   │   ├── label.js          # the question for a control (label, aria, legend, nearby text)
│   │   │   ├── controls.js       # control → Field (kind, options, group, section)
│   │   │   └── page.js           # looksLikeApplication, stepFingerprint
│   │   ├── classify/
│   │   │   ├── profileKeys.js    # Field → profile key (autocomplete, label rules); SELF_ID/CONSENT/ESSAY/NOISE
│   │   │   └── answers.js        # normalizeQuestion, matchAnswer (pivot guard), matchOption
│   │   ├── resolve.js            # Field + copy → Decision {value, source, confidence} | Skip {reason}
│   │   ├── widgets/
│   │   │   ├── events.js         # human-like event sequences
│   │   │   ├── text.js           # input/textarea/contenteditable
│   │   │   ├── select.js         # native <select>
│   │   │   ├── combobox.js       # ARIA combobox, listbox buttons, typeahead
│   │   │   ├── choice.js         # radio, checkbox list, button groups
│   │   │   ├── date.js           # native date, split month/year, typed formats
│   │   │   ├── file.js           # file input + drop zones
│   │   │   └── index.js          # write/read/snapshot/restore by kind
│   │   ├── sites/
│   │   │   ├── index.js          # adapter registry
│   │   │   └── workday.js        # experience + education blocks, date sections, Add Another
│   │   ├── session.js            # run instant → AI tiers; undo; keep-filling; notice answers
│   │   ├── track.js              # submit detection → markApplied (generalised jobInfo)
│   │   └── ui/pill.js            # shadow-root status pill + per-root outline styles
│   ├── background.entry.js       # + routes for the new messages
│   ├── background/
│   │   ├── autofillCopy.js       # bundle change-check, résumé bytes, wipe on sign-out
│   │   ├── sessions.js           # per tab/frame session relay (storage.session) → panel
│   │   └── reinject.js           # on install/update: inject current scripts into open tabs
│   ├── panel/apply.entry.js      # side panel "Apply" view (bundled → dist/panel-apply.js)
│   └── (existing extract/, content.entry.js, scout*, savedSync.js … unchanged except cleanup)
├── sidepanel.html / sidepanel.js # + Apply view mount; existing views kept
├── test/                         # Vitest (existing + new scan/classify/resolve/widget specs)
│   └── lab/                      # invented application pages (see research R11)
│       ├── classic.html  react-form/  workday/  buttons-typeahead.html  embed-host.html
│       ├── shadow.html  easy-apply.html  noise.html  prefilled.html  sensitive.html
└── e2e/
    ├── support/fake-api.js       # fake app server (configurable delay/failure/AI answers)
    ├── support/launch.js         # temp copy of built extension + test config + localhost matches
    └── autofill-*.spec.js, regression.spec.js, reinject.spec.js

backend/
├── alembic/versions/l0a1b2c3d4e6_resume_parsed_history.py
├── app/models/resume.py          # + parsed_history, parsed_history_at
├── app/api/v1/autofill.py        # GET /v1/autofill/bundle (new router)
├── app/services/autofill_bundle.py   # build bundle + version; schedule résumé reading
├── app/services/ai_service.py    # parse_resume_history (work + education); map_fields + confidence
├── app/api/v1/ai.py              # work-history served from cache; autofill-map + confidence
├── app/services/scout_review.py  # save_one(anyway=True) without a copy
└── tests/api/test_autofill_bundle.py, test_scout_save_anyway.py, test_ai_autofill_map.py

frontend/
├── src/components/scout/ScoutResults.tsx   # "Save anyway" when !can_save
└── tests/components/ScoutSaveAnyway.test.tsx

.github/workflows/ci.yml           # + extension job
```

**Structure decision**: This keeps the repo's existing three parts. The extension engine lives under `extension/src/autofill/`, replacing `mapper.js`, `fill.js` and `workday.js`. Their tested logic (the rules, the pivot guard, Workday dates) is moved over, not rewritten from scratch. Existing unit tests move with it and must stay green.

## Delivery order (each a PR, merged only after review and the user's OK)

1. **PR A — "Updates never strand you" + Save anyway** (Story 6 part). This is small and fixes Scout now.
   - re-inject scripts on install/update, with an orphan guard
   - Scout **Save anyway**
   - the lab harness skeleton, with a fake API, launch helper and CI job
2. **PR B — Instant, correct fill + review** (Stories 1, 2: the MVP).
   - the engine
   - the bundle endpoint and the copy held by the extension
   - the pill
   - the panel's Apply view
   - lab pages: classic, React, buttons/typeahead, embed, shadow, noise, prefilled, sensitive
3. **PR C — Learns, multi-step, Workday, AI** (Stories 3, 4, 5).
   - noticing answers
   - keep-filling
   - Workday experience and education from the stored résumé reading
   - AI confidence and suggestions
   - lab pages: Workday multi-step and Easy-Apply pop-up

Each PR ships with its browser tests green locally and in CI. The user then reloads the extension once, the last manual reload thanks to PR A, and tries the live checklist in [quickstart.md](quickstart.md).

## Complexity Tracking

None. No constitution violations.
