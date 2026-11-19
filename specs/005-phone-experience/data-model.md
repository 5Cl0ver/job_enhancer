# Data model: Phone experience

No new tables and no migration. This feature is layout; what it stores is a
few per-device choices and the install manifest.

## Per-device preferences (browser `localStorage`)

Read and written through one small module (`lib/prefs.ts`) so keys, defaults
and parsing live in one place. A missing or unreadable value means the default.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `ui.hideScout` | `"1"` or absent | absent (shown) | Claude Scout is hidden on this device (slice 4) |
| `ui.scoutPhoneNote` | `"seen"` or absent | absent | The one-line "Scout runs on your computer" note was dismissed |
| `ui.jobsStage` | stage id or `"all"` | `"all"` | Last stage chip chosen on My Jobs (phone) |
| `theme` | `light` · `dark` · `system` | `system` | Existing; unchanged |

Rules:
- Per device on purpose: hiding Scout on the phone must not hide it on the
  computer ([research R8](research.md)).
- `ui.jobsStage` naming a stage that no longer exists falls back to `"all"`.
- Nothing here is personal data; clearing the browser only resets the layout.

## URL state (so Back works and screens can be linked)

| Param | Where | Meaning |
|---|---|---|
| `?stage=<id>` | `/jobs` | Stage chip (overrides `ui.jobsStage` when present) |
| `?q=` | `/jobs` | Search text (already supported by the board) |
| `?email=<event id>` | `/email-updates` | The email sheet is open; Back closes it |
| `?tab=scout`, `?view=` | `/search` | Existing. With Scout hidden, `tab=scout` shows a "Claude Scout is hidden · Show" notice instead of a blank page |

Filter choices on My Jobs stay in page state (as today); they reset when the
page is left.

## Install manifest (`frontend/public/manifest.webmanifest`)

| Field | Value |
|---|---|
| `name` / `short_name` | Job Enhancer / Jobs |
| `start_url` | `/` (which opens My Jobs on a phone) |
| `display` | `standalone` |
| `theme_color` / `background_color` | the app's dark background token |
| `icons` | 192, 512 and a 512 maskable PNG |

Plus in `index.html`: `viewport-fit=cover`, `theme-color` for light and dark,
`apple-touch-icon` (180 px), `apple-mobile-web-app-capable`.

## Server

Unchanged. The Email tab's count comes from `GET /v1/attention`, defined in
[004's REST contract](../004-ux-overhaul/contracts/rest-api.md); if 004's
to-dos slice hasn't shipped it yet, this feature adds the endpoint with the
`email_review` count only ([contracts/rest-api.md](contracts/rest-api.md)).
