# Extension Manifest (`extension/`)

Chrome MV3 **"Job Catcher"** — saves jobs to the tracker via a **Save button on
Indeed/LinkedIn/ZipRecruiter job pages** *and* a persistent **side panel** (React + Tailwind, the web app's
design system) built around the tab beside it: **This page** (fill an application, save a posting, sync
Indeed), **My jobs**, **Write** (cover letter / tailored résumé), **Settings**.
Product context: [docs/FEATURES.md](../docs/FEATURES.md); install/use/test: [README.md](README.md).

## Extraction (the core, and where the reliability lives)

| File | Purpose |
|---|---|
| `src/extract/index.js` | `extractJob(document, url)` — orchestrator: JSON-LD → site selectors → generic, merged first-non-empty-wins. **Pure function** (no `chrome.*`) so it's unit-testable |
| `src/extract/jsonld.js` | Primary: parse schema.org `JobPosting` JSON-LD (handles arrays / `@graph`). Works across most boards |
| `src/extract/indeed-embedded.js` | Indeed's reliable path: parses the job from its embedded JSON (`_initialData` on job pages, `mosaic-provider-jobcards` on feeds, open job by `?vjk=`), read from the bridge attribute or static `<script>` text |
| `src/bridge.entry.js` → `dist/bridge.js` | **MAIN-world** content script (Indeed) — mirrors `window._initialData`/`window.mosaic` onto `<html data-je-embedded>` so the isolated extractor can read the page's own JS data |
| `src/extract/indeed.js` / `linkedin.js` / `ziprecruiter.js` | Per-site selector fallbacks (ZipRecruiter: the open job in the search page's right pane) |
| `src/extract/generic.js` | Universal `og:title` / `h1` fallback; refuses page chrome (search/home titles) |
| `src/extract/util.js` | `clean`, `stripHtml`, `textFrom`, `mergeJob`, remote detection; `cleanTitle` (drops "- Indeed.com" and the tab's place), `cleanDescription` (drops "… more" button text), `isBoardName`, `tidyJob` (the same tidy-up for the panel's reads) |
| `src/extract/expand.js` | `expandMore(document)` — presses a description's own "See more" / "Read more" button before a Save (self-contained: the panel injects it too) |

## Runtime files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 config: `side_panel` + `background` worker + `content_scripts` (`dist/content.js` on Indeed/LinkedIn/ZipRecruiter); permissions + `host_permissions` |
| `src/content.entry.js` → `dist/content.js` | Injects the **Save** button on Indeed/LinkedIn/ZipRecruiter job pages (`#je-save-btn`); re-syncs when you switch jobs; asks the background `checkSaved` to show **blue "✓ Already saved"** proactively; falls back to a floating `#je-fab` if no header is found. While a **Claude Scout** run is open, sends each job page word for word (`scoutCapture`) |
| `src/scoutCapture.js` | Pure: `scoutPayload` (the capture to send, or null while the description is a snippet), `scoutDone`; for companies' own sites `withPageFallback` (company from the site's name, description from the page's main text, only on a page that looks like a posting), `pageText`, `siteName`, `looksLikePosting` |
| `src/scoutpage.entry.js` → `dist/scoutpage.js` | On other https sites (not the three boards, Google, Claude, the app or webmail): only while a Google Jobs or Local companies run is going (the background's cached `scoutAnySite`), sends the open job page word for word. The app refuses copies from other sites at any other time |
| `src/orphan.js` | After an update: each content script claims the page (`claimPage`), stops when a newer copy takes over, and sweeps buttons left by copies from 0.27 and older |
| `src/background/reinject.js` | On install/update, injects the current content scripts into already-open tabs (`matchesPattern`/`scriptsForUrl` honour the manifest's matches + exclusions; the page-world bridge is skipped) |
| `src/inject.js` | Pure DOM helpers (title selectors, `findTitleEl`, `headingFor`) for anchoring the button — unit-tested against fixtures |
| `src/background.entry.js` → `dist/background.js` | Service worker (bundled) — the **only** caller of Supabase Auth + the API. Login, **serialized token refresh**, `saveJob`, `checkSaved`, `listSaved`; on a thin Indeed save it fetches the `/viewjob` page and **enriches** with the full description/salary/type before storing |
| `src/enrich.js` | Pull description/salary/job-type from a listing page's raw HTML (worker-safe, no DOM) via `src/extract/jsonld-map.js` |
| `src/ui/onpage.js` | Everything drawn ON job sites (Save button, Indeed apply badge, My jobs Sync + review) lives in one shadow root per script, in the app's colors, light/dark — sites can't restyle it |
| `config.example.js` / `config.js` | Public client config (`config.js` **gitignored**): `API_BASE`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `icons/` | Toolbar/store icons (16/48/128) |

## Autofill (`src/autofill/`, specs 015 and 016)

One press fills every field the app knows, **instantly** (from the copy of the user's details the
background holds — never a server wait), checks each one took, then the app's AI answers what's left.
Never submits; never overwrites the user; never touches self-ID, agreements, essays.

| File | Purpose |
|---|---|
| `src/autofill.entry.js` | Content script, every frame of every https page. Draws nothing but the filled-field outlines (spec 016: everything is managed from the panel). Reports whether the frame holds a form (`formPresence`) and its progress (`fillStatus`), fills on a press (`runAutofill`), résumé first; only the open pop-up's fields while one is open; messages from the panel (Fix / Undo / Show / Remember); submit tracking |
| `src/autofill/visible.js` | On screen = drawn on screen (spec 017): `checkVisibility` + size, never `aria-hidden`/`inert` on an ancestor (MUI v4 pop-ups put it on themselves — the Paycom zero-field bug) |
| `src/autofill/report.js` | "Copy what Job Catcher saw": per frame, boxes found / kept / left out and why, each field's label, kind, hints and decision — never a value |
| `src/autofill/pick.js` | **Point at a box**: started from the panel; the hovered box is outlined (an outline that ignores the pointer), a click picks it and the page never gets that click; reaches inside closed page components and frames; Esc stops |
| `src/autofill/fingerprint.js` | A taught box remembered by what it is (label, stable name/id, kind, section, place in the form), never a CSS path; matched only when sure (≥ 0.75 and clearly ahead of the next box) |
| `panel/src/views/Point.tsx` | "Click the box on the page" → "What goes here?" (profile answers, or typed text) → fills, remembers it for the site in the account, points again; Settings › Boxes you taught |
| `panel/src/views/Trouble.tsx` | On every failure: Read the page again · Point at a box · Copy what Job Catcher saw |
| `panel/src/lib/help.ts` · `InfoBubble` in `panel/src/ui` | The ⓘ notes (spec 019) on Super autofill, Point at a box and Write: open right below, Esc or a press elsewhere closes |
| `src/autofill/hosts.js` | The one list of applicant systems (Workday, Greenhouse, Lever, Paycom, Paylocity, UKG, ADP, Dayforce, BambooHR, iCIMS, JazzHR, Rippling…), used by the page and the panel |
| `src/background/fillPresence.js` | **Read the page again** (a fresh reader via `chrome.scripting` in every frame that has none) and the scan report; a press that sees no field reads the page again and presses once more before reporting. Per tab: which frames hold a form, the status line's state, the toolbar badge (⚡ / filled count / !), and the press — every frame with a form, from the panel button, the toolbar or Alt+Shift+J |
| `src/autofill/scan.js` | Every field a person would fill (and upload boxes hidden behind their own button) — including inside shadow DOM (open and closed) — and the question it asks (label, aria, floating label after the box, legend, nearby text, table cell, placeholder); "is there a form here" (`hasFormHere`: 3+ fields, no sign-in box); a phone box beside a country-code picker |
| `src/autofill/classify/profileKeys.js` | Which profile answer a question wants (autocomplete first, then words), the guards (self-ID, consent, essays, noise), and the profile's answers in the forms dropdowns use ("OR"/"Oregon") |
| `src/autofill/classify/answers.js` | Remembered-answer matching (with the country / number / "not" guard) and option matching ("Yes" ↔ "Yes, I am authorized") |
| `src/autofill/resolve.js` | Field + copy → what to write and where it came from, or why not |
| `src/autofill/widgets.js` | One writer per kind (text, dates, Workday month/year boxes, selects, radios, Yes/No buttons, checkbox lists, search dropdowns incl. typeaheads, search prompts' chips, files) that acts like a person and **reads back**; snapshot/restore for Undo. Dropdowns **one at a time** (spec 020): lists left open are closed first, a long list is scrolled, the choice is checked and the list confirmed closed — never the first option as a guess |
| `src/autofill/session.js` | A frame's fill: known answers, then one AI request; Fix (custom fixes are remembered), Undo, Show, typed answers |
| `src/autofill/sections/` | "Retype your résumé" sections (spec 020): `workday.js` fills Workday's Work Experience / Education / Languages / Websites / Certifications rows and Skills from the chosen résumé (rows added with the section's Add button, Workday's wrong values corrected with Undo, the user's edits never touched); `generic.js` adds job and school blocks on other sites (Greenhouse, SuccessFactors, any "Add another"); `index.js` runs them before the general fill |
| `src/autofill/classify/languages.js` | Language levels 1–5 picked from a site's own wording ("5 - Fluent", "Native or bilingual", "Advanced"), never guessed |
| Super autofill (`autofill.entry.js`, panel) | One checkbox under Autofill, **on by default**, kept in `chrome.storage.sync` (spec 018). On: after the first press, each later step of the same application (same tab, same site) fills as it appears — the step's questions are its fingerprint. Off: nothing fills without a press |
| `src/autofill/classify/jobHistory.js` | "Retype your résumé" sections (spec 018, 020): a box in an Employment / Education / References section never gets the user's own details; past-job boxes get the résumé's jobs and school boxes its schools, one block each (title, company, location, dates, description, "I currently work here") |
| Saved as you go (background `autoSaveAnswers` / `autoSaveProfile`) | When the user moves on, answers to unknown questions are saved at once: everyday ones for every application, company-specific ones as `site|question` (that site only), essays as `essay|question` (offered with **Use saved answer**, never filled). The profile's empty fields are filled; a different value waits for one tap. The panel's **Saved N answers** has Edit / Undo |
| Learning (`autofill.entry.js` → background `answersNoticed` / `profileNoticed`) | On Next / Continue / Submit / leaving the page: answers typed into unknown questions, and profile answers the profile lacks, are offered in the panel (**New answers to remember**, **Save to my profile**) — saved only on the user's press |
| `src/autofill/track.js` | Submit → the saved job moves to Applied |
| `src/background/autofillCopy.js` | The copy autofill fills from (`GET /v1/autofill/bundle` with a version check, résumé bytes, the staged tailored résumé); wiped on sign-out / another account |
| `panel/src/views/Apply.tsx` | The review: Needs you, Check these (AI answers + **Suggested · Use** for unsure ones), Filled (collapsed) — Fix with the page's real options, Show, Undo, Undo all, Keep filling switch, Remember what I typed, New answers to remember, Save to my profile |

## Side panel (`panel/`, spec 015 Story 7)

Vite + React 19 + Tailwind v4 + lucide, the same stack and tokens as `frontend/`; built to
`dist/panel/` (manifest `side_panel`). It never calls the API: every request goes to the background.

| File | Purpose |
|---|---|
| `panel/src/App.tsx` | Shell: header, the four views, bottom bar; sign-in gate |
| `panel/src/views/ThisPage.tsx` | Any page with a form → **Autofill this page** (first on an application, under Save otherwise) with its status line and real shortcut; no form → says so, with **Fill anyway** · Mark applied, Write for this job · a posting → **Save this job** (read → check details → save, duplicate warning) · Indeed My jobs → read, choose stages, **Sync** · elsewhere → what Job Catcher is for |
| `panel/src/views/MyJobs.tsx` | Saved jobs (search, Mark applied, open) from the cheap change check |
| `panel/src/views/Write.tsx` | Cover letter / tailored résumé by the free AI or **My Claude** (prompt copied → paste answer back → PDF); a tailored résumé is uploaded by the next Autofill |
| `panel/src/views/Settings.tsx` · `SignIn.tsx` | Account, Claude Project link (synced with the app), version · sign-in |
| `panel/src/lib/store.tsx` | Auth, saved jobs (`src/savedSync.js`), the tab beside the panel (`?tab=<id>` in tests) |
| `panel/src/lib/context.ts` | Pure: page kind from the URL, best saved-job match, duplicate check, document file names |
| `panel/src/lib/extractPage.js` | Self-contained page reader injected on sites without the content script |
| `panel/src/theme.css` · `panel/src/ui/` | The app's tokens (drift-tested) and components |

## Build & test

| File | Purpose |
|---|---|
| `build.mjs` | esbuild: bundles `src/*.entry.js` (+ `src/extract/*`) → `dist/`. `npm run build` / `npm run dev` |
| `test/extract.spec.js` + `test/fixtures/` | Vitest unit tests: extractors vs saved HTML. `npm test` |
| `e2e/support/` | `launch.js` (test copy of the built extension + test `config.js`, never the repo's), `fake-api.js` (fake app server, invented applicant, recorded calls), `lab-server.js` (serves `test/lab/` + `test/fixtures/` on two origins) |
| `e2e/*.spec.js` | Playwright in real Chromium against the fake server: the panel in every context + WCAG AA in both themes (`panel.spec.js`), the on-page Save button, bridge, Scout copies, a real 0.27 → current upgrade (`reinject.spec.js`). `npm run test:e2e`; CI runs them under xvfb |
| `test/theme-drift.spec.js` | Fails if the panel's color tokens drift from the app's |
| `src/background/applyRun.js` · `src/autofill/applyMode.js` · `src/autofill/applyPage.js` | Apply with Claude (spec 022): the background finds the open application (`GET /v1/apply/active`, 2 s while open, 60 s otherwise), claims each request once, takes photos screen by screen (`captureVisibleTab`, shrunk to JPEG under 400 KB, at most 8, scroll put back) with every question and answer, or fills like the panel's press; pages block an application's final Submit until the user's OK and report a press once allowed. Needs the `<all_urls>` host permission (Chrome's rule for tab photos) |
| spec 023 in `applyRun.js` / `applyMode.js` / `applyPage.js` | "Screen now" (`peek` requests: one photo, never scrolled, the same tab checks); after a Submit in the application's tab (or while Claude is pressing it) the page looks for the thank-you words (`confirmationIn` over `readableText`, never buttons or labels, never words already there) and sends `applyConfirmed`; `clean()` decodes HTML entities; the panel never treats Job Enhancer's own pages as an application |
| spec 026 in `applyRun.js` / `scan.js` / `session.js` | On a page of an open run, the run's own résumé (`resumeFor`, from `resume_id` in `/v1/apply/active`), never a URL guess; upload boxes hidden behind a "Select files" button or a drop zone named by `data-automation-id` (Workday) are found (`uploadZone`); the fill result says what happened to the résumé (`attached` / `no_box` / `no_file` / `failed`); photos show the run's tab for a moment (a minimised window restored) and put the user's tab back, with plain reasons when Chrome can't take one (`idle`: locked / hidden); the live view reads the run's tab every 3 s while filling and sends its boxes only when they changed (`POST /v1/apply/runs/{id}/live`), never passwords or card numbers. Needs the `idle` permission (no install warning) |

**How it connects:** the **background** worker is the single API caller (Supabase Auth
with token refresh → `POST /v1/saved-jobs/manual`, Bearer). The content script and side
panel only message the background — no CORS, one source of truth. Capture is a shared
**pure, tested** function used by both the on-page button and the panel, so a green test
suite corresponds to real capture working. A Chrome **Side Panel** (not a popup) keeps
the UI open while you browse.
