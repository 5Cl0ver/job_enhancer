# API contracts: 019

All endpoints are under `/v1`. They require the Supabase JWT (`Authorization: Bearer …`) unless marked **public**. Errors use the existing `{detail}` shape.

## Onboarding

### `GET /onboarding`

Creates the row if it is missing.

```json
{
  "welcome": { "step": 1, "done": false },
  "checklist_hidden": false,
  "items": [
    { "key": "resume", "done": true, "required": true },
    { "key": "profile", "done": false, "required": true },
    { "key": "job_catcher", "done": false, "required": true },
    { "key": "first_job", "done": false, "required": true },
    { "key": "email", "done": false, "required": false },
    { "key": "claude", "done": false, "required": false }
  ],
  "required_done": 1,
  "required_total": 4
}
```

### `PATCH /onboarding`

Request body, every field optional:

```json
{ "welcome_step": 2, "welcome_done": true, "profile_reviewed": true, "checklist_hidden": false }
```

- `welcome_done: true` sets `welcome_done_at`; `false` clears it (Settings → "Show the welcome again").
- `profile_reviewed: true` sets `profile_reviewed_at`.
- Returns the same shape as `GET`.

## Usage (fair use)

### `GET /usage`

```json
{
  "exempt": false,
  "resets_at": "2026-11-24T08:00:00Z",
  "kinds": {
    "ai_document": { "used": 2, "limit": 10, "left": 8 },
    "ai_read": { "used": 0, "limit": 5, "left": 5 },
    "ai_autofill": { "used": 14, "limit": 100, "left": 86 },
    "live_search": { "used": 1, "limit": 5, "left": 4 }
  },
  "shared": { "jsearch_month": { "used": 37, "cap": 200, "reserve": 40 } }
}
```

### Over the allowance

The AI endpoints (`/ai/generate`, `/ai/autofill-map`, `/ai/work-history`, `/users/me/application-profile/from-resume`) and live search (`/jobs/search?refresh=true`) return this when over the allowance:

```http
429 {"detail": {"code": "ALLOWANCE", "kind": "ai_document", "limit": 10,
               "resets_at": "...", "message": "You've used today's 10 free AI documents. They come back at midnight (Pacific).",
               "alternatives": ["my_claude"]}}
```

- Nothing is spent.
- A live search over the allowance instead falls back to the cached pool and returns `200` with `"live": false, "note": "..."`. It never errors, because searching saved jobs is never limited.

## Job Catcher

### `GET /extension/latest` (public, cached 10 minutes)

```json
{ "version": "0.35.0", "notes": "Connect with one press; update notes", "published_at": "2026-11-24T…",
  "download_url": "https://github.com/5Cl0ver/job_enhancer/releases/latest/download/job-catcher.zip" }
```

If GitHub can't be reached, it returns the last known value, or `{version: null}`.

### `POST /extension/hello`

Request:

```json
{ "install_id": "c3f…(≤64)", "version": "0.35.0", "browser": "Chrome 142" }
```

Response: `{ "latest": "0.35.0", "update_available": false }`

Upserts `extension_installs`. The panel sends it on sign-in and at most hourly.

### `POST /extension/connect/start` (public)

- Rate limit: 10/hour per IP.
- Response: `{ "code": "K7QM-3XPD", "poll_token": "<43-char base64url>", "expires_in": 300, "connect_url": "https://<app>/connect?code=K7QM-3XPD" }`

### `GET /extension/connect/{code}`

Used by the app's approval page. Response: `{ "status": "pending", "expires_in": 241 }`. Returns 404 if the code is unknown or expired.

### `POST /extension/connect/approve`

- Request: `{ "code": "K7QM-3XPD" }`
- Rate limit: 10/hour per user.
- Responses:
  - `200 {"status":"approved"}`
  - `409` if the request is not pending
  - `404` if the code is unknown or expired

### `POST /extension/connect/cancel`

- Request: `{ "code": "…" }`
- Response: `200 {"status":"cancelled"}`

### `POST /extension/connect/poll` (public)

- Request: `{ "poll_token": "…" }`
- Rate limit: 60/minute per IP.
- Responses:
  - `200 {"status":"pending"}`
  - `200 {"status":"approved", "email":"…", "token_hash":"…", "type":"magiclink"}`. Returned once; the request becomes `used`.
  - `200 {"status":"cancelled"|"expired"|"used"}`
  - `404` if the token is unknown
- The panel then calls Supabase `POST {SUPABASE_URL}/auth/v1/verify` with `{type:"magiclink", token_hash}` and the anon key, and stores the returned session.
- If minting fails (service key missing or Supabase down), the response is `503 {"detail":"Connect isn't available right now. Sign in with your password instead."}`.

## Admin

### `GET /admin/users`

This existing endpoint adds per row:

```json
{ "last_active_at": "…", "onboarding": { "welcome_done": true, "resume": true, "profile": true,
  "job_catcher": { "version": "0.35.0", "last_seen_at": "…", "outdated": false }, "first_job": true, "email": false, "claude": false },
  "usage_today": { "ai_document": 2, "ai_read": 0, "ai_autofill": 14, "live_search": 1 }, "usage_month": { "…": 0 } }
```

### `GET /admin/allowances`, `PUT /admin/allowances`

- Body: the `allowances` object (see data-model).
- Validated; returns the stored value.
- Admin only (403 otherwise).

### `GET /admin/stats`

Its active 7d/30d counts now use `last_active_at`.

## MCP server

Any authenticated tool call sets `user_onboarding.claude_seen_at` (throttled to once an hour). Tool behaviour is unchanged.
