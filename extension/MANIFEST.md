# Extension Manifest (`extension/`)

Chrome MV3 **"Job Catcher"** — saves any job page to the tracker in one click.
Plain HTML/JS, no build step. Product context: [docs/FEATURES.md](../docs/FEATURES.md)
(Browser Extension); install/use steps: [README.md](README.md).

| File | Purpose |
|---|---|
| `manifest.json` | MV3 config: permissions (`activeTab`, `scripting`, `storage`), `host_permissions` (API + Supabase), popup action |
| `popup.html` | Popup UI — sign-in form + capture form (title/company/location/remote) |
| `popup.js` | Logic: Supabase login (token in `chrome.storage`), read the page via `chrome.scripting`, `POST /v1/saved-jobs/manual` |
| `config.example.js` | Template for `config.js` |
| `config.js` | Local config (**gitignored**): `API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public values) |
| `README.md` | Install (load unpacked) + usage |

**How it connects:** signs in against **Supabase Auth** (REST) to get the same
access token the web app uses, then saves via the backend
`POST /v1/saved-jobs/manual` (Bearer auth). **No backend changes** — the
extension's `host_permissions` make its requests privileged (no CORS needed).
