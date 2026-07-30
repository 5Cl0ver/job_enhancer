# Middleware Manifest (`backend/app/middleware/`)

| File | Purpose |
|---|---|
| `auth.py` | Supabase JWT auth dependency. Verifies **asymmetric (ES256) access tokens** against the project **JWKS** (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached in-process, refreshed on a key-id miss). Exposes two FastAPI dependencies: `CurrentUser` (resolves the User from the token's email, auto-creating on first login; grants `admin` role when email == `ADMIN_EMAIL`) and `AdminUser` (adds a `role == "admin"` check → 403). |

**How this folder connects:** `CurrentUser` / `AdminUser` are used as
dependencies throughout `api/v1/*`. Reads `models/User` and `config.settings`
(needs `SUPABASE_URL`). Replaced the earlier HS256-shared-secret approach.
