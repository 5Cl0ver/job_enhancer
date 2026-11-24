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

Codes, poll tokens, proofs and passes travel only in request **bodies**. Every way a code can be wrong answers the **same 404**: `{"detail": "That Connect link has expired. Press Connect in Job Catcher again."}`.

### `GET /extension/latest` (public, cached 10 minutes)

```json
{ "version": "0.35.0", "notes": "…", "published_at": "…", "sha256": "<64 hex>",
  "download_url": "https://github.com/5Cl0ver/job_enhancer/releases/latest/download/job-catcher.zip" }
```

### `POST /extension/hello`

- Request: `{ "install_id": "[A-Za-z0-9_-]{8,64}", "version": "0.35.0", "browser": "Chrome 142" }`
- Response: `{ "latest": "0.35.0", "update_available": false }`

### `POST /extension/connect/start` (public, 10/hour per IP)

- Request: `{ "proof_hash": "<sha256 hex of the panel's proof>" }`
- Response: `{ "code": "K7QM-3XPD", "poll_token": "<43 chars>", "expires_in": 300 }`

### `POST /extension/connect/status` (app session, 30/minute)

- Request: `{ "code" }`
- Response: `{ "status": "pending", "expires_in": 241 }`, or the 404.

### `POST /extension/connect/approve` (app session only, never a pass; 10/hour)

- Request: `{ "code", "proof" }`
- Response: `200 {"status":"approved"}`, or the 404 (including a wrong proof).

### `POST /extension/connect/cancel` (30/minute)

- Request: `{ "poll_token" }` (from Job Catcher) or `{ "code" }` (from the approval page).

### `POST /extension/connect/poll` (public, 60/minute)

- Request: `{ "poll_token" }`
- Responses:
  - `{"status":"pending"|"expired"|"cancelled"|"used"}`
  - `{"status":"approved","token":"jcx_…","email":"…"}`, returned **once**
  - The 404 for an unknown token

### `GET /extension/tokens` (app session only)

Lists live connections: `[{id, browser, version, created_at, last_used_at}]`.

### `DELETE /extension/tokens/{id}` (app session only)

Disconnects one of the person's own computers. Returns 404 for anyone else's.

### `DELETE /extension/tokens/current` (the pass itself)

Job Catcher's sign-out. Returns 204.

### `POST /extension/tokens/revoke-all` (app session only)

Disconnects every Job Catcher. The app calls it right after a password reset. Returns `{"revoked": n}`.

### `GET /extension/installs` (app session only)

Lists the Job Catchers that said hello on this account, newest first: `[{version, browser, last_seen_at}]`. A password sign-in shows here too, so the status chip works for every kind of sign-in.

### Auth: the pass opens only what Job Catcher does

- **Session only by default.** `get_current_user` refuses a `jcx_` pass with 401 "Sign in to the Job Enhancer app to do this." Only routes that opt in with `get_user_or_pass` accept one.
- **The allowlist** is `PASS_ROUTES` in `backend/tests/api/test_pass_routes.py`. A test walks the whole route table and fails if any other route accepts a pass, so new routes are session-only unless added on purpose. It holds exactly the calls Job Catcher makes:
  - `GET /users/me`, `PATCH /users/me/claude-project`;
  - application profile read and update;
  - custom-answers save, used and delete;
  - saved-jobs list, summary, manual, check, backfill, mark-applied and sync-applications;
  - autofill bundle, and taught add, list and delete;
  - AI: resumes, active résumé file, prompt, autofill-map, work-history, manual documents, generate, document PDF;
  - scout active run and captures;
  - extension hello and `tokens/current`.
- **Never with a pass:** account delete, export, `PATCH /users/me`, all `/admin`, email, Connect approve and status, and the token list, revoke and revoke-all.
- Revoked, idle (90 days), old (365 days) or unknown passes get 401.

### Rate limits and the client's address

- The public Connect endpoints are limited by the **client's IP only**, ignoring Authorization:
  - start: 10 an hour;
  - poll: 90 a minute (Job Catcher polls 30 a minute);
  - cancel: 30 a minute.
- Behind Render (a private peer, with Cloudflare in front), the client is taken from the first valid one of: CF-Connecting-IP, True-Client-IP, the second-from-right X-Forwarded-For entry, the peer. It is never the leftmost entry, and IPv6 is bucketed by /64. A public peer is used as-is.
- At most **3** Connects may wait from one address (`429 "Too many Connects waiting from here…"`), and **500** across everyone (`503 "Busy right now. Try again in a minute."`).
- `PATCH /users/me/claude-project` and `PATCH /users/me` accept only `https://claude.ai/…` or empty; anything else is a 422.
- Old requests are deleted by a scheduled job every 6 hours, never during a request.

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
