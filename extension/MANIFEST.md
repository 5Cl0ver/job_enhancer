# Extension Manifest (`extension/`)

Chrome MV3 **"Job Catcher"** — saves jobs to the tracker via **on-page "+ Save"
buttons** on job cards *and* a persistent **side panel**. Plain HTML/JS, no build.
Product context: [docs/FEATURES.md](../docs/FEATURES.md); install/use: [README.md](README.md).

| File | Purpose |
|---|---|
| `manifest.json` | MV3 config: `side_panel` + `background` worker + `content_scripts` (Indeed/LinkedIn/Glassdoor); `permissions` (sidePanel, storage, scripting, activeTab) + `host_permissions`; icons |
| `background.js` | Service worker — the **only** caller of Supabase Auth + the API. Handles login, **token refresh**, and `saveJob`; broadcasts card saves to the panel. Opens the side panel on toolbar click |
| `sidepanel.html` / `sidepanel.js` | The persistent side-panel UI: sign-in, **Pick from page**, manual form, "saved this session" list, tracker link. Fills instantly when a pick lands in storage |
| `content.js` / `content.css` | Injects **"+ Save"** buttons onto job cards (per-site selectors, re-scans SPA feeds); on click, messages the background to save |
| `picker.js` | "Pick from page" mode — hover-highlight + click any element to capture the job; stashes to storage, which the panel reads live |
| `config.example.js` / `config.js` | Public client config (`config.js` **gitignored**): `API_BASE`, `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `icons/` | Toolbar/store icons (16/48/128) |
| `README.md` | Install (load unpacked) + usage |

**How it connects:** the **background** worker is the single API caller — it
verifies via Supabase Auth (with token refresh) and saves via
`POST /v1/saved-jobs/manual` (Bearer). The **content script** and **side panel**
both just message the background, so there are no CORS issues and one source of
truth. A Chrome **Side Panel** (not a popup) means the UI never closes when you
click the page.
