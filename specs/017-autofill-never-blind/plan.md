# Implementation Plan: Autofill that never goes blind

**Branch**: `017-autofill-never-blind` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/017-autofill-never-blind/spec.md`

## Summary

Fix the cause first, then make sure no failure can ever leave the user stuck.

1. **The cause (US1).** `scan.js` threw away every field inside an `aria-hidden` / `inert` / `[hidden]` ancestor. MUI v4 modals (Paycom's UI) put the pop-up's own ancestor under `aria-hidden`, so every field was dropped.
   - Replace this with Chrome autofill's rendering-only visibility rule (research R2).
   - Opacity-0 radios and checkboxes are judged by their visible stand-in.
   - `aria-hidden` only ranks fields, never drops them.
2. **Reach every frame (US1).**
   - `match_origin_as_fallback` + `match_about_blank` in the manifest.
   - A **Read the page again** that re-injects a fresh copy into all frames through `chrome.scripting` and rescans.
   - A press that finds zero fields does this automatically, once, before reporting.
3. **Never stuck (US2).** Every failure state in the panel shows **Read the page again · Point at a box · Copy what Job Catcher saw**. The report has labels, kinds, frames and drop reasons, and never values (R5).
4. **Point and teach (US3).**
   - A uBlock-style picker started from the panel (R6).
   - Picked boxes are saved as weighted fingerprints, not CSS paths (R7).
   - They're stored in the user's account (new `taught_fields` table, served in the autofill bundle) so they work on both computers (R8).
   - Taught boxes rank first.
5. **Deep reader (US4, P3, last).** Optional `debugger` permission plus `DOMSnapshot`, offered only when all of the above still finds nothing (R4).

**No AI in any of this.** The no-AI autofill must stand on its own: the user's priority.

## Technical Context

**Language/Version**: JavaScript ES2022 (content/background), TypeScript + React 19 (panel), Python 3.11 (backend).

**Primary Dependencies**:
- Chrome MV3: `chrome.scripting.executeScript` (allFrames, injectImmediately), `chrome.dom.openOrClosedShadowRoot`, `Element.checkVisibility`, Popover API;
- `chrome.debugger` (optional, US4);
- FastAPI, SQLAlchemy async, Alembic.

**Storage**:
- New Postgres table `taught_fields` (RLS per user), served in `GET /v1/autofill/bundle` and cached in the extension's copy.
- The scan report is never stored: it's generated on demand.

**Testing**:
- Vitest: the visibility rule, the scan report (with a no-values check), fingerprint scoring.
- Playwright MV3 e2e against new lab pages.
- pytest for the taught endpoints and the bundle.

**Target Platform**: Chrome / Edge 120+ (`checkVisibility`, Popover).

**Project Type**: Browser extension + web service (monorepo).

**Performance Goals**:
- The scan stays under 20 ms for 200 fields.
- Read again (inject + scan + report) under 2 s.
- The picker's hover outline follows the pointer at display rate (rAF-throttled).

**Constraints**:
- Never submits.
- Consent, self-ID, password and payment fields are never filled or taught.
- Nothing is drawn on the page outside pointing mode.
- No new *required* permissions (`debugger` is optional, US4).

**Scale/Scope**:
- About 10 extension files, 1 backend model + migration + 3 endpoints, 3 lab pages, about 30 unit tests, 8 e2e tests and 8 backend tests.

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ Root cause found from source (MUI v4 ModalManager); research documented with sources |
| II. User-centric ("first-time user can use it without instructions") | ✅ Every failure has three plain actions; the picker is point-and-click |
| III. AI | ✅ Not used: the no-AI path is made reliable first (user's direction) |
| IV. Security/privacy | ✅ The report never contains values (tested); taught boxes are per user with RLS; the debugger is optional and explained before asking |
| V. Test-driven | ✅ The lab reproduces the zero-field failure before the fix; unit, e2e and pytest coverage |
| VI. Clean architecture | ✅ The visibility rule, report and fingerprint are pure modules; taught boxes are served through the existing bundle |
| VII. Simplicity | ✅ No ML. The deep reader is last and optional |

**Gate: PASS.** The post-design re-check also passes, so no complexity table.

## Project Structure

### Documentation

```text
specs/017-autofill-never-blind/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
└── contracts/ (extension-messages.md, taught-api.md)
```

### Source Code

```text
extension/
├── manifest.json                     # autofill: match_origin_as_fallback, match_about_blank; optional_permissions: debugger (US4)
├── src/autofill/
│   ├── visible.js                    # NEW: rendering-only visibility + stand-in for opacity-0 choices (R2)
│   ├── scan.js                       # use visible.js; keep drop reasons for the report
│   ├── report.js                     # NEW: per-frame scan report, no values (R5)
│   ├── fingerprint.js                # NEW: fingerprint + weighted match (R7)
│   ├── pick.js                       # NEW: the picker: outline, capture-phase events, Esc (R6)
│   ├── resolve.js / session.js       # taught boxes rank first; fill a picked box
├── src/autofill.entry.js             # messages: scanReport, startPick/stopPick, fillPicked; zero-field auto re-read
├── src/background/fillPresence.js    # readAgain (executeScript allFrames), auto retry, pick relay
├── src/background/autofillCopy.js    # taught boxes in the copy
├── panel/src/views/Apply.tsx         # Trouble bar (three actions) on every failure; pick flow ("What goes here?")
├── panel/src/views/ThisPage.tsx      # NoForm gets the three actions
├── panel/src/views/Settings.tsx      # Taught boxes: list + Remove
└── test/lab/ paycom-modal.html (MUI-v4 aria-hidden ancestor + opacity-0 radios), unlabeled.html, picker-frame.html
backend/
├── app/models/taught_field.py · alembic/versions/<new>.py
├── app/api/v1/autofill.py            # POST /v1/autofill/taught, GET list, DELETE
├── app/services/autofill_bundle.py   # include taught boxes (+ version hash)
└── tests/api/test_taught_fields.py
```

## Delivery (one PR per step; each merges only after tests, an independent review and CI)

1. **PR A: the fix + never stuck (US1 + US2).** This is the one that fixes Paycom, and it ships first.
   - `visible.js`; the scan uses it.
   - The Paycom-modal lab page: write the e2e test first and watch it find 0, then 7.
   - Manifest frame options.
   - Read again + zero-field auto retry.
   - The report + copy.
   - The Trouble bar on every failure state.
2. **PR B: point and teach (US3).**
   - The picker, fingerprints, taught boxes in the backend + bundle.
   - Panel pick flow + Settings list.
3. **PR C (only if needed): deep reader (US4).**

## Next feature (agreed 2026-11-23, after filling is proven on the user's real applications)

- **Auto-save learning:**
  - New answers and taught boxes save automatically when the user moves on.
  - Core profile changes (name, email, phone, address) still ask once, because one typo there spreads to every application.
- **An "Autofill memory" page in the app:**
  - everything learned, organized as profile / saved answers / taught boxes / by site;
  - edit or delete anything.
- **"Fix this in the app":** a link from the panel's Fix button to that exact answer in the app.

## Complexity Tracking

None.
