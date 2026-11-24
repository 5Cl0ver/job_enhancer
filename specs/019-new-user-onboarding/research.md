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
- A smoke step unzips the result and checks that every manifest-referenced file exists, and that nothing like `.env`, `.pem` or source maps ships.
- **Hardening:**
  - `permissions: {}` at the top; `contents: write` only on the release job.
  - Third-party actions are pinned to full commit SHAs.
  - Only `GITHUB_TOKEN` is used, and `set -euo pipefail` everywhere.
  - The commit subject reaches the notes through an environment variable, never interpolated into the script.
  - The zip's **SHA-256** goes into `latest.json` and the release notes; `/job-catcher` shows it under "Check the download".

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

**Decision (revised 2026-11-23, built in PR A)**: Job Catcher gets **its own pass** from our backend, a `jcx_` token, instead of a Supabase session. **No Supabase secret is needed**, so the owner has no setup to do.

1. **Start.** The panel makes a random **proof** (32 bytes) and sends only its sha256 to `POST /v1/extension/connect/start`. It gets back an 8-character `code` and a secret `poll_token` (32 bytes). The server stores only the hashes.
2. **Open the app.** The panel opens `APP_URL/connect?code=…`.
   - Signed out: Login, which now honours a safe `?redirect=`, then back here.
   - The page asks **the Job Catcher in the same Chrome** for the proof, via `chrome.runtime.sendMessage(PINNED_ID, {type:"connectProof", code})`.
   - Job Catcher's manifest `externally_connectable` lists **only the app's address**. The background also checks `sender.origin === APP_URL origin` and answers **only** for the code it is waiting on.
3. **Approve.** **Connect** calls `POST /v1/extension/connect/approve {code, proof}` with the person's app session (a JWT, never a `jcx_` pass). The server checks `sha256(proof) == proof_hash` with `hmac.compare_digest`.
4. **Collect the pass.** The panel polls `POST /v1/extension/connect/poll {poll_token}` every 2 s (plus on each panel check and a 30-second alarm). Once approved, it receives `jcx_` + 43 random characters **exactly once**: an atomic `approved → used` update. The server stores only its sha256.
5. **Use it.** `get_current_user` accepts `Bearer jcx_…` (looked up by hash), alongside Supabase JWTs.

**Rationale**:
- It works for every account, GitHub included.
- There's no shared refresh token (Supabase's reuse detection would sign both out).
- No service-role key exists anywhere.
- Passes are revocable per computer.

**Security notes** (owner: "make sure everything is very secure"):
- **Device-code phishing is blocked.**
  - The attack: someone starts a Connect and sends you their `/connect` link; you approve, and their Job Catcher gets your account.
  - Approval needs the proof, which only the Job Catcher that started the request holds, and it only hands it to the app's own page in **the same browser**, for **its own** code.
  - If the page can't reach that Job Catcher, it refuses in plain words: "Open this link in the same Chrome where Job Catcher is installed, by pressing Connect in Job Catcher." It can never be approved from another browser.
- **Secrets stay out of URLs, logs and disk.**
  - Codes, poll tokens, proofs and passes travel only in request **bodies**, never in URLs (so never in access logs), and are never logged.
  - Only sha256 hashes are stored server-side.
  - The panel keeps the proof and poll token in `chrome.storage.session` (trusted extension contexts only, never on disk). The connect state is removed once connected.
- **No oracle.**
  - Codes come from a 31-character alphabet with no 0/O/1/I/L.
  - Every bad case (unknown, expired, used, cancelled, wrong proof) returns the same 404.
  - Rate limits: start 10/hour per IP, approve 10/hour per user, status and cancel 30/minute, poll 60/minute.
- **Requests** last 5 minutes and are single-use.
- **Passes:**
  - They stop after **90 days unused**, and after **one year** regardless.
  - At most **10** per account; the oldest is disconnected.
  - **Sign out** in Job Catcher revokes its pass on the server first (`DELETE /v1/extension/tokens/current`).
  - **Disconnect** on the app's Job Catcher page revokes one at once; the next call gets 401 and the panel shows signed out.
  - A pass can't approve a Connect or list or revoke connections (403: "Do this in the Job Enhancer app"). Revoking only ever touches the owner's own passes.
  - Rate limiting keys a pass as `ext:` + 12 hex characters of its hash, never the pass itself.

**Security review fixes (2026-11-24)**:
- **Pass refused by default.** `get_current_user` is app-session only; `get_user_or_pass` opts in only Job Catcher's own routes, enforced by a route-table test. The Claude Project link moved to `PATCH /users/me/claude-project`, so `PATCH /users/me` stays app-only.
- **Real client IP for the public Connect limits.** These use the rightmost X-Forwarded-For entry, and only when the peer is Render's private proxy. We don't use uvicorn `--forwarded-allow-ips='*'`, because that trusts the leftmost entry, which a client can fake.
- **Load:** a global cap of 500 waiting requests; indexes on `created_at` and `(status, expires_at)`; cleanup on the scheduler.
- **After a password reset,** the app revokes every pass and says Job Catcher must connect again.
- **Login redirects** re-check the tidied path, so `/.//evil.com` and `/a/..//evil.com` fall back to `/`.
- **Release workflow:** the token only on the two steps that use it, and `npm ci --ignore-scripts` (verified: esbuild and vite still build).
- **Robustness:**
  - One poller in the background (2 s, ≤ 30 a minute), resumed by an alarm. The panel only reads state.
  - Connect calls use the wake-up retry for Render's cold start.
  - A sign-out revoke that fails is kept and retried at the next start or every 30 minutes.
  - A dead refresh token (400/401) is forgotten instead of retried forever.

**Security re-review fixes (2026-11-24)**:
- **Client address on Render:** Render sits behind Cloudflare and appends Cloudflare's edge to X-Forwarded-For. Behind a private peer, the order is CF-Connecting-IP, then True-Client-IP, then the second-from-right X-Forwarded-For entry, then the peer. Values are validated; IPv6 is bucketed by /64; the leftmost entry is never used.
- **Per-address cap:** at most 3 Connects may wait from one address (stored as a hash), on top of the global 500.
- **Password reset:** the app retries revoke-all while the server wakes. If it still fails, the page says so and points to Connected computers; it never claims success.
- **Claude Project link:** only `https://claude.ai/…` (or empty to clear), in the app, the Job Catcher endpoint and wherever it's opened.
- **Release:** three jobs. `check` uses a read-only token; `build` has no token (`npm ci --ignore-scripts`, zip, SHA-256, artifact); `publish` has `contents: write` and runs no npm. It verifies the artifact's SHA-256 against build's output, then releases. Actions are pinned by SHA.

**Alternatives considered**:
- **Supabase admin `generate_link` + `verify`.** It gives a separate Supabase session, confirmed in the Supabase Auth docs. But it needs the service-role key on Render, which the owner wanted no setup for, and that key is far more powerful than needed.
- **The app posts its own session to the extension:** shares one refresh token, leading to reuse detection and surprise sign-outs.
- **OAuth PKCE in the extension:** needs per-install redirect URLs in Supabase, and doesn't cover password-less email users.

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
- **No dashboard change needed:** if `/reset-password` isn't on Supabase's Redirect URL list, Supabase falls back to the Site URL. `lib/recovery.ts` then sees `type=recovery` or the `PASSWORD_RECOVERY` event and opens `/reset-password` wherever the link lands. New passwords need at least 8 characters, and the forgot page always shows the same message.
- **Redirect safety:** `safeRedirect` refuses absolute URLs, `//host`, backslashes, encoded slashes or backslashes (decoded twice), `javascript:` and other schemes, and control characters. GitHub sign-in keeps the target in sessionStorage across the round trip.

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

## R13. Parts B and C with no AI (amendment, 2026-11-24)

**Decision (the owner, 2026-11-24):** "no AI at all … we do AI later. Right now it's gotta be perfect without." The free AI's model was retired on 2026-11-05 and stays off until the AI phase. Parts B and C are built to work fully without it:

- **The Welcome's résumé step uses no AI.**
  - The upload is read by the built-in reader from spec 020 (jobs, schools, skills, links).
  - The contact fields (name, email, phone, city and state, links) come from an extended **built-in** contact reader in `profile_extract.py`: the first lines, email, phone, "City, ST" and link patterns.
  - The model call in `extract_profile` is skipped while `settings.ai_in_profile_fill` is false (the default). The review form is the safety net, so nothing is guessed silently.
- **The wording never promises the free AI.**
  - The résumé step says "Reading your résumé…".
  - The bubbles describe AI Apply as "AI writing is paused for now; you can still upload résumés and write your own".
  - SC-007's "free AI" is read as "what the app does for them".
- **Fair use (part C) is still built in full,** because the live-search allowance protects a real shared limit today (JSearch at 200 a month).
  - The AI kinds are counted and limited only when an AI call actually happens. With AI off, nothing is spent.
  - The "left today" labels show only for kinds that are switched on.
