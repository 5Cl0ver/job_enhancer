# Implementation Plan: Autofill you can always find, that always works

**Branch**: `016-autofill-always-findable` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/016-autofill-always-findable/spec.md`

## Summary

**The rule:** stupid simple. Job Catcher stops deciding for the user whether a page "counts" as an application. If a page has a real form, Autofill is shown in fixed, obvious places and one press fills it.

**What changes:**

1. **Presence probe.** Each frame answers "is there a form here?" (3+ fillable fields, or an application, and no sign-in box). It answers again when a pop-up or a new step appears.
   - The panel and the toolbar badge use this answer, never the web address alone.
2. **Panel first.** The side panel can't be covered by anything on the page, so it becomes the always-there home of Autofill:
   - a big ⚡ button at the top whenever the page has a form;
   - one plain line for every outcome.
3. **Toolbar badge.** A small ⚡ on the extension icon means "this page can be filled". Clicking the icon opens the panel with the button on top.
4. **No button on the page (user decision).** The on-page pill is removed, and everything is managed from the extension.
   - This also removes the whole class of "hidden under a pop-up or cookie banner" bugs: a modal pop-up draws over every z-index and makes the rest of the page unclickable, which nothing on the page can escape.
   - The filled-field outlines stay as the on-page sign of what changed.
   - **Live status in the panel:** looking → form found → filling N of M → done / no form / problem, with a 20 s watchdog.
   - **Shortcut:** moves to Alt+Shift+J (Simplify owns Alt+Shift+F). The panel shows the real key, or "Set a shortcut".
5. **Better reading:**
   - Labels follow Chrome's order, including floating labels placed after the box, table cells, and placeholders.
   - The 3-field rule counts *recognised* fields, and is skipped when the site sets `autocomplete` or the address is a known applicant system.
6. **Applicant-system list.** One shared list (page + panel) covering Paycom, Paylocity, UKG, ADP, Dayforce, BambooHR, iCIMS, JazzHR, Rippling and the existing ones.
7. **Fill order fixes found in research:**
   - Upload the résumé FIRST, then wait for the form to settle before filling. Paylocity, Dayforce, Rippling, iCIMS and Paycom rewrite the form from the résumé.
   - Phone boxes beside a country-code picker get the national number only.

The spec 015 fill engine (classify, write, read back, review, undo, learn) is kept as is.

## Technical Context

**Language/Version**: JavaScript (ES2022) content and background scripts; TypeScript + React 19 panel.

**Primary Dependencies**: Chrome MV3 APIs:
- `chrome.action.setBadgeText`
- `chrome.tabs.sendMessage` with frameIds
- `chrome.webNavigation` is not needed: the frame replies carry `sender.frameId`
- `chrome.dom.openOrClosedShadowRoot`

Plus Vite, Tailwind v4 and lucide (existing).

**Storage**: `chrome.storage.session` for per-tab form presence (`je_form:<tabId>`), so the panel and badge read one source.

**Testing**:
- Vitest unit tests: label reading, presence rule, host list, phone national number.
- Playwright MV3 e2e against new lab pages, served by the existing lab server with no real data.
- axe on panel states.

**Target Platform**: Chrome / Edge 114+ (Popover API).

**Project Type**: Browser extension (part of the web app monorepo).

**Performance Goals**:
- The presence probe takes under 15 ms on a 200-field page. It re-runs only when the set of visible controls changes (existing signature), at most every 500 ms.
- The panel shows the button within 1 s of a pop-up opening.

**Constraints**:
- Never submits.
- Consent, privacy and self-ID fields are never filled.
- No new permissions, so no new install prompt. `action` and `storage` are already granted.

**Scale/Scope**:
- About 9 source files touched.
- 4 new lab pages.
- About 25 new unit tests and 6 e2e tests.

## Constitution Check

| Principle | Status |
|---|---|
| I. Portfolio quality | ✅ Research-backed design (Chromium label inference, top-layer UI); documented in research.md |
| II. User-centric: "a first-time user can use it without instructions" | ✅ This feature's whole point (SC-005) |
| III. AI | ✅ Unchanged; no new AI |
| IV. Security/privacy | ✅ No new permissions; the probe returns counts only, never values; tests use invented data |
| V. Test-driven | ✅ Unit + e2e per story, CI extension job |
| VI. Clean architecture | ✅ One shared host list module; presence lives in the background like fill sessions |
| VII. Simplicity | ✅ No ML (research: rules + the user's own learned answers beat an untrainable model) |

**Gate: PASS.** The post-design re-check is also PASS: no violations, so no complexity table.

## Project Structure

### Documentation (this feature)

```text
specs/016-autofill-always-findable/
├── spec.md
├── plan.md            # this file
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
└── contracts/
    └── extension-messages.md
```

### Source Code

```text
extension/
├── src/
│   ├── autofill.entry.js          # pill removed; presence push, force run, progress events
│   ├── autofill/
│   │   ├── scan.js                # label order (after-label, table cell), presence rule
│   │   ├── hosts.js               # NEW: the one applicant-system list (page + panel)
│   │   ├── session.js             # résumé first + settle wait; hasForm()
│   │   └── classify/profileKeys.js# national phone beside a dial-code picker
│   ├── background.entry.js        # je_form:<tabId>, badge, clear on navigation
│   ├── ui/onpage.js               # pill styles removed (outlines stay)
│   └── manifest.json              # command key Alt+Shift+J
├── panel/src/
│   ├── lib/store.tsx              # form presence from storage.session + live message
│   ├── lib/context.ts             # uses hosts.js
│   └── views/ThisPage.tsx, Apply.tsx, NoForm (new small state)
├── test/
│   ├── fill-engine.spec.js        # + label styles, presence, phone
│   ├── panel-context.spec.js      # + new hosts
│   └── lab/                       # NEW: paycom-like.html, labels.html, covered.html, frame-form.html
└── e2e/
    └── autofill-find.spec.js      # NEW: Story 1–3 end to end
```

**Structure Decision:** extension-only change. The backend is untouched.

## Phases (for /speckit-tasks)

1. **Foundation:**
   - `hosts.js` shared list;
   - presence rule `hasForm()`;
   - the probe/presence messages;
   - background `je_form:<tabId>` + badge.
2. **US1, always there:**
   - panel shows the Autofill card from presence;
   - a no-form state;
   - remove the page pill;
   - the panel status line + progress events + 20 s watchdog;
   - the real-shortcut hint;
   - lab pages `paycom-like`, `covered`, `frame-form`;
   - e2e.
3. **US2, fills on real-shaped forms:**
   - label order;
   - forced frame runs;
   - résumé first + settle;
   - national phone;
   - lab `labels.html`;
   - unit + e2e.
4. **US3, one line:** a plain outcome line for every result (filled nothing, signed out, asleep, unreachable).
5. **Polish:**
   - version bump;
   - README "How to autofill" (3 lines);
   - full test run;
   - PR → independent review → CI → merge → build.

## Complexity Tracking

None.
