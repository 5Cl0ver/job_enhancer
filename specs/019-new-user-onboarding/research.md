# Research: New-user onboarding and Job Catcher download (019)

Each decision lists what was chosen, why, and what else was considered. Facts about today's code come from a full survey on 2026-11-23 (sign-up, AI, email, connector, quotas, extension, admin, frontend, hosting).

## R1. Where the Job Catcher download lives

**Decision**:
- A GitHub Actions workflow on `main` publishes a **GitHub Release** whenever `extension/manifest.json`'s version has no release yet. The release tag is `job-catcher-v<version>`.
- The release assets are `job-catcher.zip` and `latest.json` (version, notes, date).
- The app links to the stable URL `https://github.com/5Cl0ver/job_enhancer/releases/latest/download/job-catcher.zip`.

**Rationale**:
- The repo is public, and GitHub Releases are free, permanent and versioned.
- The workflow already builds and tests the extension in CI.
- The "latest" URL never changes, so the app needs no redeploy per version.
- There's no hosting cost and nothing new to run.

**Alternatives considered**:
- **The zip in `frontend/public/`:** a binary committed per version bloats git, and Vercel only rebuilds the frontend.
- **Serve it from the backend:** Render's Docker build roots at `backend/`, so it can't see `extension/`. It would also add cold starts to a download.
- **Supabase Storage:** unused today, and it adds a bucket, a policy and a service key to CI.
- **Chrome Web Store:** out of scope (later, per the owner).

## R2. Never publish a zip that points at the wrong server

**Decision**:
- The workflow writes `config.js` from repository **variables**: `JC_API_BASE`, `JC_APP_URL`, `JC_SUPABASE_URL`, `JC_SUPABASE_ANON_KEY`. These are public values; the anon/publishable key is public by design.
- The workflow then **fails** if any of them is empty, isn't `https://`, or contains `localhost`, `127.0.0.1` or `0.0.0.0`.
- A smoke step unzips the result and checks that every manifest-referenced file exists.

**Rationale**: this is a past failure mode (memory: "extension config.js must ALWAYS point at live Render/Vercel"). A hard gate in the release workflow makes it impossible to repeat.

**Alternatives considered**:
- Commit a production `config.js`. It is gitignored for good reasons: local dev differs.

## R3. "Update available": knowing the latest version

**Decision**:
- A backend endpoint `GET /v1/extension/latest` reads the GitHub API `releases/latest` for the repo, picks the `job-catcher-v*` release and its `latest.json`, and caches the result in memory for 10 minutes. With no network it returns the last known value.
- Job Catcher sends its version on every sign-in and at most hourly while in use (`POST /v1/extension/hello`).
- The app compares the version (and so does the panel, from the same endpoint).

**Rationale**:
- A single cached call keeps everyone well under GitHub's unauthenticated rate limit (60/hour per IP), from one server IP.
- Both the app and the panel already talk to the backend.

**Alternatives considered**:
- Browser calls to `api.github.com`: rate-limited per user IP, and leaks app usage to GitHub.
- Baking the version into the frontend build: Vercel's root is `frontend/`, so reading `../extension` there is fragile.

## R4. One-press "Connect to Job Enhancer" (works for GitHub sign-ups)

**Decision**: a backend-brokered device-style flow, with Supabase minting a **separate** session for the panel. Confirmed in Supabase Auth docs (Context7, `/supabase/auth`): `POST /admin/generate_link` with `type: "magiclink"` returns `hashed_token`, and `POST /verify` with `{type, token_hash}` returns `access_token` + `refresh_token`.

1. The panel calls `POST /v1/extension/connect/start` and gets back `{code, poll_token, expires_in: 300}`.
   - `code`: 8 characters, shown in the app and the panel so the person can confirm they match.
   - `poll_token`: 32 random bytes. It is kept only by the panel; the server stores just its hash.
2. The panel opens `APP_URL/connect?code=…`.
   - Signed out: Login, which now honours `?redirect=` (R7), and back.
   - The page names the account and "Job Catcher on this computer", with **Connect** and **Cancel**.
3. **Connect** calls `POST /v1/extension/connect/approve {code}` with the user's JWT.
4. The panel polls `POST /v1/extension/connect/poll {poll_token}` every 2 seconds.
   - Once approved, the server calls Supabase `generate_link` (magiclink) for the user's email with the **service-role key**, and returns the `hashed_token` exactly once.
   - The request is then marked used.
5. The panel calls Supabase `POST /auth/v1/verify {type:"magiclink", token_hash}` itself and stores the session. This is the same storage and refresh path as password sign-in today.

**Rationale**:
- It gives the panel its **own** session, so no refresh token is shared with the web app. Shared refresh tokens would trip Supabase's refresh-token reuse detection and sign both out.
- It works for any identity (GitHub, email).
- It needs no extension ID or `externally_connectable`.
- No email is sent, because `generate_link` doesn't send one.
- `token_hash` is single-use and short-lived on the Supabase side too.

**Security**:
- The code alone can't sign anything in.
- Only the holder of `poll_token` (the panel that started the request) receives the token hash.
- Approve requires the user's JWT.
- A request is single-use, expires after 5 minutes, and is rate-limited (start: 10/hour per IP; approve: 10/hour per user).
- The service-role key lives only in Render env (`SUPABASE_SERVICE_ROLE_KEY`) and is never logged or sent to clients.

**Alternatives considered**:
- **The app posts its own session to the extension** (`externally_connectable` + a pinned extension ID): this shares one refresh token, which leads to reuse detection and surprise sign-outs.
- **Backend-issued API tokens for the extension:** the auth middleware, MCP and the panel's Supabase calls would all need a second token type.
- **OAuth PKCE inside the extension** (`chrome.identity.launchWebAuthFlow` with GitHub via Supabase): needs per-install redirect URLs registered in Supabase. Unpacked IDs differ per path unless pinned, and it doesn't cover email users without passwords.

## R5. Keep Job Catcher's identity stable across updates

**Decision**:
- Add a fixed public `"key"` to `extension/manifest.json`. That gives every unpacked install the same extension ID.
- Update instructions say: "replace the files in the same folder, then press reload".

**Rationale**:
- Unpacked IDs are derived from the folder path. A person who unzips an update into a new folder would otherwise get a new ID, losing sign-in, Super autofill (`storage.sync`), saved Not-this-job choices and so on.
- A pinned ID keeps `chrome.storage.sync` consistent across the person's computers.
- The private key is not needed for unpacked installs; it is generated once and not committed.

**Alternatives considered**: tell people never to change folders. Fragile.

## R6. Onboarding state and the checklist

**Decision**:
- A new table `user_onboarding` (one row per user): `welcome_step`, `welcome_done_at`, `profile_reviewed_at`, `checklist_hidden`, `claude_seen_at`.
- `GET /v1/onboarding` returns stored fields plus **derived** ticks:
  - résumé exists;
  - profile reviewed (stored), or treated as reviewed for pre-existing users with a non-empty profile;
  - Job Catcher seen (from `extension_installs`);
  - at least one saved job;
  - an email account connected;
  - Claude connected (`claude_seen_at`, set by the MCP server on any authenticated tool call).
- The migration inserts a row with `welcome_done_at = now()` for **every existing user**, so nobody is forced through it.

**Rationale**:
- Derived ticks can't drift from reality ("ticks when actually done", FR-005).
- A separate table keeps `users` lean and is easy to export and delete.

**Alternatives considered**:
- Store every tick as a boolean: drifts when things are deleted.
- localStorage: doesn't follow the person across devices (FR-004).

## R7. Sign-in fixes: redirect and forgot password

**Decision**:
- **Redirect:** `Login` reads `?redirect=` or `location.state.from` and navigates there after sign-in, **only** if it's a same-origin path starting with `/` and not `//`.
- **Forgot password:** `supabase.auth.resetPasswordForEmail(email, {redirectTo: APP_URL + "/reset-password"})`, then a new `/reset-password` page calls `updateUser({password})`. The message is always "If that email has an account, a reset link is on its way."
- **Ops:** add `/reset-password` and `/connect` to Supabase Auth → URL Configuration → Redirect URLs.

**Rationale**: these are standard Supabase flows, and both fix real gaps (connector consent and Connect both depend on redirect working).

## R8. The ⓘ bubbles

**Decision**:
- **Web app:** a small `InfoBubble` component on **Base UI `Popover`**, which is already installed (`@base-ui/react` 1.6.0; `popover` present). It uses `Popover.Trigger openOnHover delay={150}` plus click/tap, and `Positioner collisionAvoidance` so it fits phone screens.
  - Confirmed in the Base UI docs (Context7, `/mui/base-ui`): Trigger supports `openOnHover`/`delay`, click toggles, touch opens on press, Esc and outside press close.
- **Bubble text:** lives in one file, `frontend/src/lib/help.ts` (`{what, why, needs, more?}` per key), so the wording can be reviewed in one place.
- **Job Catcher's panel:** its own tiny `Info` component (the panel has its own UI kit) with a copied subset of keys in `extension/panel/src/lib/help.ts`.

**Rationale**:
- No new dependency (Principle VII).
- Base UI handles accessibility: focus, `aria-expanded`, Esc.
- A popover rather than a tooltip, because a tooltip isn't reachable by tap on phones.

**Alternatives considered**:
- Radix Tooltip: no tap on touch devices.
- A guided product tour library: heavier, and the 004 research already rejected tours in favour of checklists and empty states.

## R9. Fair-use allowances

**Decision**:
- **Counters:** table `usage_counters (user_id, kind, period, count)` with a unique `(user_id, kind, period)`.
  - `period` is a US-Pacific date string (`2026-11-23`) for daily kinds, or `2026-11` for the shared monthly one, with `user_id` NULL.
  - Kinds: `ai_document`, `ai_read`, `ai_autofill`, `live_search`, and the shared `jsearch_month`.
- **Limits:** table `app_settings (key, value jsonb)`, editable by admins. Defaults live in code: 10 / 5 / 100 / 5 per day; `jsearch_month_cap` 200; `jsearch_owner_reserve` 40.
- **Enforcement** is a service `allowance.spend(db, user, kind)`, called **before** the paid call:
  - It returns remaining, or raises `AllowanceExceeded` (HTTP 429 with `{kind, limit, resets_at, alternatives}`). Nothing is spent when over.
  - If the call then fails, `allowance.refund(...)` decrements.
  - Admins are exempt: counted, never blocked.
- **JSearch:** the source increments `jsearch_month` per actual API request. Non-admins are refused when `count >= cap - reserve`, and the source then quietly skips JSearch (other sources still run).
- **Display:** `GET /v1/usage` returns remaining per kind for "left today" labels.

**Rationale**:
- Postgres upsert counters are simple and exact at this scale (developer plus friends).
- Spend-then-refund prevents two concurrent requests from both passing at the limit edge.
- The existing slowapi per-minute limits stay as burst protection.

**Alternatives considered**:
- Redis: not in the stack, and not free on Render.
- Counting only successes: races past the limit.
- Per-minute limits only: they don't protect a monthly quota.

## R10. Real "last active"

**Decision**:
- `users.last_active_at`, updated in `get_current_user` when it is older than 15 minutes (one cheap UPDATE at most per user per 15 minutes).
- The admin "active 7d/30d" stats switch from `updated_at` to it.

**Rationale**: the survey found "active" is based on profile edits only, which is wrong for the owner view (FR-022).

## R11. The install guide's pictures

**Decision**:
- Hand-drawn, theme-aware **inline SVG illustrations** of each step: the Developer mode toggle, the Load unpacked button, the pin icon, the side panel.
- Short captions, with the step number large.

**Rationale**:
- No screenshots of anyone's browser, so no personal data.
- Works in light and dark themes.
- Doesn't go stale every time Chrome tweaks its UI.

**Alternatives considered**:
- Real screenshots: personal data risk, and they go out of date.
- A video: heavy, and can't be skimmed.

## R12. Phones and the extension

**Decision**:
- On a phone (narrow screen or touch-only), the Get Job Catcher page shows "Job Catcher works in Chrome on a computer", with **Share link** (`navigator.share`) and **Copy link**. The spec was updated from "email it" because the app has no email sender.
- Every other onboarding step works on a phone.

**Rationale**: browser extensions don't run on mobile Chrome. The share sheet reaches email and notes for free.
