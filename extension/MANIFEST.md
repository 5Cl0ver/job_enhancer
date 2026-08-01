# Extension Manifest (`extension/`)

Chrome MV3 **"Job Catcher"** — saves jobs to the tracker via a **Save button on
Indeed/LinkedIn job pages** *and* a persistent **side panel** that captures any page.
Product context: [docs/FEATURES.md](../docs/FEATURES.md); install/use/test: [README.md](README.md).

## Extraction (the core, and where the reliability lives)

| File | Purpose |
|---|---|
| `src/extract/index.js` | `extractJob(document, url)` — orchestrator: JSON-LD → site selectors → generic, merged first-non-empty-wins. **Pure function** (no `chrome.*`) so it's unit-testable |
| `src/extract/jsonld.js` | Primary: parse schema.org `JobPosting` JSON-LD (handles arrays / `@graph`). Works across most boards |
| `src/extract/indeed.js` / `linkedin.js` | Per-site detail-page selector fallbacks |
| `src/extract/generic.js` | Universal `og:title` / `h1` fallback; refuses page chrome (search/home titles) |
| `src/extract/util.js` | `clean`, `stripHtml`, `textFrom`, `mergeJob`, remote detection |

## Runtime files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 config: `side_panel` + `background` worker + `content_scripts` (`dist/content.js` on Indeed/LinkedIn); permissions + `host_permissions` |
| `src/content.entry.js` → `dist/content.js` | Injects **one** floating `#je-fab` "Save to Job Enhancer" button; runs `extractJob` and messages the background |
| `src/capture.entry.js` → `dist/capture.js` | Injected on demand by the panel's **Capture this page**; runs `extractJob`, stashes result in `chrome.storage` |
| `background.js` | Service worker — the **only** caller of Supabase Auth + the API. Login, **token refresh**, `saveJob`; broadcasts saves to the panel |
| `sidepanel.html` / `sidepanel.js` | Persistent UI: sign-in, **Capture this page**, **Pick manually**, review form, "saved this session", tracker link. Fills the form when a capture lands in storage |
| `picker.js` | **Pick manually** mode — hover-highlight + click an element to capture |
| `config.example.js` / `config.js` | Public client config (`config.js` **gitignored**): `API_BASE`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `icons/` | Toolbar/store icons (16/48/128) |

## Build & test

| File | Purpose |
|---|---|
| `build.mjs` | esbuild: bundles `src/*.entry.js` (+ `src/extract/*`) → `dist/`. `npm run build` / `npm run dev` |
| `test/extract.spec.js` + `test/fixtures/` | Vitest unit tests: extractors vs saved HTML. `npm test` |
| `e2e/extension.spec.js` | Playwright: loads the built extension in real Chromium, asserts capture → storage. `npm run test:e2e` |

**How it connects:** the **background** worker is the single API caller (Supabase Auth
with token refresh → `POST /v1/saved-jobs/manual`, Bearer). The content script and side
panel only message the background — no CORS, one source of truth. Capture is a shared
**pure, tested** function used by both the on-page button and the panel, so a green test
suite corresponds to real capture working. A Chrome **Side Panel** (not a popup) keeps
the UI open while you browse.
