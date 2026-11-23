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
| `src/extract/util.js` | `clean`, `stripHtml`, `textFrom`, `mergeJob`, remote detection |

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

## Autofill (`src/autofill/`, spec 015 Stories 1–2)

One press fills every field the app knows, **instantly** (from the copy of the user's details the
background holds — never a server wait), checks each one took, then the app's AI answers what's left.
Never submits; never overwrites the user; never touches self-ID, agreements, essays.

| File | Purpose |
|---|---|
| `src/autofill.entry.js` | Content script, every frame of every https page: the pill (only on pages that look like an application), run, messages from the panel (Fix / Undo / Show / Remember), submit tracking |
| `src/autofill/scan.js` | Every field a person would fill — including inside shadow DOM (open and closed) — and the question it asks (label, aria, legend, nearby text, placeholder) |
| `src/autofill/classify/profileKeys.js` | Which profile answer a question wants (autocomplete first, then words), the guards (self-ID, consent, essays, noise), and the profile's answers in the forms dropdowns use ("OR"/"Oregon") |
| `src/autofill/classify/answers.js` | Remembered-answer matching (with the country / number / "not" guard) and option matching ("Yes" ↔ "Yes, I am authorized") |
| `src/autofill/resolve.js` | Field + copy → what to write and where it came from, or why not |
| `src/autofill/widgets.js` | One writer per kind (text, dates, selects, radios, Yes/No buttons, checkbox lists, search dropdowns incl. typeaheads, files) that acts like a person and **reads back**; snapshot/restore for Undo |
| `src/autofill/session.js` | A frame's fill: known answers, then one AI request; Fix (custom fixes are remembered), Undo, Show, typed answers |
| `src/autofill/workday.js` | Workday's Work Experience blocks from the résumé (read once, held in the copy) |
| Keep filling (`autofill.entry.js`) | After one press, each later step of the same application (same tab, same site) fills as it appears — the step's questions are its fingerprint; switchable in the panel |
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
| `panel/src/views/ThisPage.tsx` | Applying → **Autofill this page**, Mark applied, Write for this job · a posting → **Save this job** (read → check details → save, duplicate warning) · Indeed My jobs → read, choose stages, **Sync** · elsewhere → what Job Catcher is for |
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

**How it connects:** the **background** worker is the single API caller (Supabase Auth
with token refresh → `POST /v1/saved-jobs/manual`, Bearer). The content script and side
panel only message the background — no CORS, one source of truth. Capture is a shared
**pure, tested** function used by both the on-page button and the panel, so a green test
suite corresponds to real capture working. A Chrome **Side Panel** (not a popup) keeps
the UI open while you browse.
