# Tasks: Job Catcher overhaul (015)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

Tests are required: the spec asks for lab browser tests, and the constitution (V) does too. Within each story the tests come first.

Delivery is three PRs, as in [plan.md](plan.md):
- **PR A**: Phases 1–3
- **PR B**: Phase 3b (Story 7, the new look)
- **PR C**: Phases 4–6 (Stories 1–2, the MVP)
- **PR D**: Phases 7–9 (Stories 3–5)
- Phase 10 is the polish for each PR.

## Phase 1: Setup — the test lab harness (PR A)

- [X] T001 Create the fake app server, with configurable per-route delay, failure and AI answers plus recorded calls, in extension/e2e/support/fake-api.js
- [X] T002 Create the launcher in extension/e2e/support/launch.js. It copies the built extension to a temp dir, writes a test config.js pointing at the fake API, and adds http://localhost/* and http://127.0.0.1/* to the autofill and Scout script matches, in the copy only. It seeds a signed-in token and returns {context, worker, extensionId}.
- [X] T003 Create the lab static server (two origins: localhost and 127.0.0.1) serving extension/test/lab/ in extension/e2e/support/lab-server.js
- [X] T004 Move the existing extension/e2e/extension.spec.js onto the shared launcher, so Scout and bridge tests use the test copy and never the repo config.js
- [X] T005 Add an `extension` job (npm ci → build → vitest → playwright install chromium → xvfb-run playwright test) to .github/workflows/ci.yml

## Phase 2: Foundational (PR A)

- [X] T006 Add a per-version orphan guard (`window.__jeLoaded`, removal of stale `#je-*` nodes and hosts) as a shared helper in extension/src/orphan.js, and call it first in every *.entry.js content script

## Phase 3: User Story 6 (part) — updates never strand you + Save anyway (P1, PR A)

**Independent test**: with a tab open on a board fixture, reload the extension, then start a Scout run. The page is copied with no refresh. Save anyway on a no_copy finding creates a thin saved job.

- [X] T007 [P] [US6] Browser test: open a LinkedIn-shaped fixture, reload the extension in the worker, then check the Scout copy still reaches the fake API without a tab refresh, in extension/e2e/reinject.spec.js
- [X] T008 [P] [US6] pytest: Save anyway (no_copy → thin saved job that needs details; still 409 without anyway; 404 for another user's finding; second save is `already`) in backend/tests/api/test_scout_save_anyway.py
- [X] T009 [P] [US6] Vitest: Save anyway shows only when !can_save, sends anyway:true and toasts, in frontend/tests/components/ScoutSaveAnyway.test.tsx
- [X] T010 [US6] Re-inject the content scripts into open tabs on install/update (with the MAIN world for the bridge) in extension/src/background/reinject.js, wired from extension/src/background.entry.js
- [X] T011 [US6] Add `anyway` to SaveFindingIn in backend/app/schemas/scout.py, and save from the finding's own fields when there's no copy in backend/app/services/scout_review.py
- [X] T012 [US6] Add a Save anyway button and mutation option in frontend/src/components/scout/ScoutResults.tsx and frontend/src/hooks (the Scout save hook)

## Phase 3b: User Story 7 — it looks and feels like the app (P1, PR B)

**Independent test**: open the new panel in every context and theme against the fake API. Every old action is reachable and works, there are no page errors, and contrast passes.

- [X] T053 [P] [US7] Browser tests for every panel context (signed out, application, posting, Indeed My jobs, elsewhere) x (light, dark), every old action (save + edit + duplicate warning, Pick manually, saved list + Mark applied + retry, Indeed sync, Write with both engines + PDF + use for upload, Claude Project link, sign out), and axe-core contrast, in extension/e2e/panel.spec.js
- [X] T054 [P] [US7] Token drift test (extension/panel/src/theme.css vs frontend/src/globals.css) in extension/test/theme-drift.spec.js
- [X] T055 [US7] Panel scaffold: Vite + React 19 + Tailwind v4 + lucide in extension/panel/ (index.html, vite.config.ts, src/main.tsx, src/theme.css); `npm run build` builds content scripts and the panel, in extension/package.json and extension/build.mjs
- [X] T056 [US7] UI kit (Button, Card, Input, Textarea, Select, Switch, Tabs, Badge) in extension/panel/src/ui/
- [X] T057 [US7] Typed background messaging + the context detector (moved from sidepanel.js detectContext) in extension/panel/src/lib/
- [X] T058 [US7] Views: SignIn, ThisPage (SaveJob with the capture/edit/duplicate warning, IndeedSync, Elsewhere, and an Apply placeholder until PR C), MyJobs (the savedSync change check), Write (generate / bridge / PDF / stage for upload), Settings, in extension/panel/src/views/
- [X] T059 [US7] ~~Pick manually~~ — dropped: picker.js was already gone before 015; highlighting the description before **Save this job** covers it
- [X] T060 [US7] Shared on-page stylesheet + shadow-root host helper in extension/src/ui/; move the board Save button (extension/src/content.entry.js) onto it
- [X] T061 [US7] Point manifest side_panel at dist/panel/index.html; remove sidepanel.html, sidepanel.js and picker.js; update MANIFEST.md

## Phase 4: Foundational for autofill (PR C)

- [ ] T013 (moved to PR D, with the résumé reading) Migration l0a1b2c3d4e6, adding resumes.parsed_history (JSON) and parsed_history_at, in backend/alembic/versions/ and backend/app/models/resume.py
- [X] T014 [P] pytest for the bundle (full, unchanged, version changes, isolation, history_pending, 401) in backend/tests/api/test_autofill_bundle.py
- [X] T015 Bundle service + version in backend/app/services/autofill_bundle.py; router GET /v1/autofill/bundle in backend/app/api/v1/autofill.py; registered in backend/app/main.py
- [ ] T016 (PR D) parse_resume_history (work + education) in backend/app/services/ai_service.py; run it on résumé upload and lazily from the bundle; serve /v1/ai/work-history from the cache, in backend/app/api/v1/ai.py
- [X] T017 The background autofill copy (change check, résumé bytes, wipe on sign-out or account change, refresh on panel open and on press, at most every 60 s) in extension/src/background/autofillCopy.js
- [X] T018 The session relay (storage.session per tab/frame, merge, sessionChanged broadcast, frame-addressed panel actions) in extension/src/background/sessions.js

## Phase 5: User Story 1 — one press fills the page, right, instantly (P1, PR C)

**Independent test**: lab pages classic, react-form, shadow, embed-host, noise, prefilled and sensitive. Check the page's own data, the time from press to filled (under 1 s), and a 30 s server delay.

- [X] T019 [P] [US1] Lab pages: classic.html, buttons-typeahead.html, embed-host.html, shadow.html, noise.html, prefilled.html, sensitive.html in extension/test/lab/
- [X] T020 [P] [US1] Lab React app (react-select-style search dropdown, location typeahead, yes/no buttons, date, controlled inputs; React state exposed as window.__formData) in extension/test/lab/react-form/, built by extension/test/lab/build.mjs
- [X] T021 [P] [US1] Browser tests for Story 1 scenarios 1–8 in extension/e2e/autofill-fill.spec.js
- [X] T022 [P] [US1] Unit tests for the deep walk, labels, controls and page detection in extension/test/scan.spec.js
- [X] T023 [P] [US1] Unit tests for profile keys, guards, resolve and matchOption in extension/test/resolve.spec.js; the existing autofill.spec.js and workday.spec.js are moved over and kept green
- [X] T024 [US1] Deep walk (shadow roots via an injected getter, same-origin frames) in extension/src/autofill/scan/walk.js
- [X] T025 [US1] Question resolution (R4) in extension/src/autofill/scan/label.js
- [X] T026 [US1] Control → Field (kinds, groups, options, sections) in extension/src/autofill/scan/controls.js; looksLikeApplication + stepFingerprint in extension/src/autofill/scan/page.js
- [X] T027 [US1] Profile keys and guards (moved from mapper.js and extended per R6) in extension/src/autofill/classify/profileKeys.js; normalizeQuestion, matchAnswer and matchOption in extension/src/autofill/classify/answers.js
- [X] T028 [US1] resolve(field, copy) → Decision or Skip in extension/src/autofill/resolve.js
- [X] T029 [US1] Writers with read-back, snapshot and restore: events.js, text.js, select.js, combobox.js, choice.js, date.js, file.js, index.js in extension/src/autofill/widgets/
- [X] T030 [US1] The session's instant tier (scan → resolve → write → verify → report) in extension/src/autofill/session.js
- [X] T031 [US1] The shadow-root pill + per-root outline styles in extension/src/autofill/ui/pill.js
- [X] T032 [US1] Rewrite extension/src/autofill.entry.js as a thin boot: pill only on looksLikeApplication, runAutofill in every frame, orphan guard. Delete src/autofill/mapper.js, fill.js and workday.js once their logic has moved.
- [X] T033 [US1] Manifest: `commands.autofill` (Alt+Shift+F), `unlimitedStorage`, `match_origin_as_fallback` on autofill; the background handles the command, in extension/manifest.json and extension/src/background.entry.js

## Phase 6: User Story 2 — review everything in one place (P1, PR C)

**Independent test**: autofill a lab form, open Review, then Fix, Undo, Undo all, and check the page's data after each.

- [X] T034 [P] [US2] Browser tests for Review (list, Fix, Show, Undo, Undo all, step change refresh, openReview opens the panel) in extension/e2e/autofill-review.spec.js
- [X] T035 [US2] Frame handlers for applyFix, undo, show, useSuggestion and setKeepFilling in extension/src/autofill/session.js
- [X] T036 [US2] Side panel Apply view (Need you, Check these, collapsed Filled, Undo all, keep-filling switch) in extension/panel/src/views/Apply.tsx, replacing the PR B placeholder
- [X] T037 [US2] openReview → chrome.sidePanel.open({tabId}) in extension/src/background.entry.js

## Phase 7: User Story 3 — it learns (P2, PR D)

**Independent test**: an empty profile; fill a lab form by hand, press Next, Save; a different lab form fills profile fields and the reworded custom question.

- [ ] T038 [P] [US3] Browser tests for learning (answers + profile, nothing saved without Save, the pivot guard, option matching) in extension/e2e/autofill-learn.spec.js
- [ ] T039 [US3] Notice answers and profile values on Next/Continue/Submit/pagehide (including Chrome-autofilled values) in extension/src/autofill/session.js
- [ ] T040 [US3] answersNoticed, profileNoticed, savePendingAnswers and savePendingProfile (merge PUT) in extension/src/background/sessions.js and extension/src/background.entry.js
- [ ] T041 [US3] "New answers to remember" + "Save to my profile" (old → new) cards in extension/panel/src/views/Apply.tsx

## Phase 8: User Story 4 — multi-step + Workday (P2, PR D)

**Independent test**: the lab Workday 4-step app; one press; each step fills; 3 experience blocks + education; self-ID untouched; keyboard shortcut.

- [ ] T042 [P] [US4] Lab Workday-shaped 4-step app + Easy-Apply pop-up in extension/test/lab/workday/ and extension/test/lab/easy-apply.html
- [ ] T043 [P] [US4] Browser tests for keep-filling, Workday blocks and dates, education, the shortcut and the Easy-Apply steps in extension/e2e/autofill-steps.spec.js
- [ ] T044 [US4] Keep-filling (observer, fingerprint, same-site, per-tab flag) in extension/src/autofill/session.js
- [ ] T045 [US4] Workday adapter (experience + education blocks, Add Another, date sections, listbox buttons), moved from workday.js, in extension/src/autofill/sites/workday.js and extension/src/autofill/sites/index.js

## Phase 9: User Story 5 — AI fills what's left (P3, PR D)

- [ ] T046 [P] [US5] pytest for autofill-map confidence (new shape, old shape, option check, failure) in backend/tests/api/test_ai_autofill_map.py
- [ ] T047 [P] [US5] Browser tests for the AI (confident → purple, unsure → suggestion + Use, AI down → no change, one request per step) in extension/e2e/autofill-ai.spec.js
- [ ] T048 [US5] Confidence in the map_fields prompt, parsing and response, in backend/app/services/ai_service.py, backend/app/api/v1/ai.py and backend/app/schemas/
- [ ] T049 [US5] The AI tier per step fingerprint in extension/src/autofill/session.js

## Phase 10: Polish & regression (every PR)

- [ ] T050 [P] Regression browser tests (board Save button + Already saved, capture, Pick manually, Scout copy, submit → markApplied, staged résumé uploaded by autofill) in extension/e2e/regression.spec.js
- [ ] T051 [P] Update extension/MANIFEST.md, extension/README.md (Testing, the lab), backend/app/services/MANIFEST.md and docs/FEATURES.md
- [ ] T052 Bump the extension version in extension/manifest.json; run quickstart.md; run an independent review before each PR

## Dependencies

- Phase 1 → everything else. The harness comes first.
- PR A (Phases 1–3) is independent of the engine.
- PR B (Phase 3b) comes before the Apply view (T036), which lives in the new panel.
- Phase 4 → Phases 5–9.
- US1 → US2 → (US3, US4, US5 in any order).

## Parallel examples

- PR A: T007, T008 and T009 together; then T010, T011 and T012 (different files).
- US1: lab pages T019 and T020, and tests T021, T022 and T023, all in parallel before the engine tasks.

## MVP

PR A, PR B (the new look) and PR C (Stories 1–2): instant, verified fill plus review in the redesigned panel.
