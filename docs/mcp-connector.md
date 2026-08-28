# The Claude Connector (MCP) — how it works & how to turn it on

This is the "no more pasting" feature. You add Job Enhancer to Claude **once** as a
custom connector. After that, inside any Claude chat you can say things like:

> "Tailor my résumé for the Acme backend role and mark it applied."

…and Claude pulls the job + your résumé **from the app itself**, writes the
result, and saves it **back into the app** — both directions, no copy/paste.

This doc explains what got built, teaches the concepts, and gives you the exact
steps to switch it on.

---

## 1. The big idea in one picture

There are three players in OAuth. Keep them straight and everything else clicks:

| Player | Who it is here | Job |
| --- | --- | --- |
| **Client** | Claude (claude.ai) | Wants to call our tools on your behalf |
| **Authorization Server (AS)** | **Supabase** | Logs *you* in and hands Claude a token |
| **Resource Server (RS)** | **our FastAPI backend** | Owns the tools; checks the token on every call |

The clever part: **Supabase is already what logs you into the app.** So when we
make Supabase the connector's Authorization Server, *connector login = app
login*. Same account, same you. We didn't have to build a login system or store
passwords — Supabase does it, and our backend just trusts the token Supabase
signed.

```
claude.ai ──1) POST /mcp (no token) ─────────────► 401 + "here's where to learn how to auth"
          ──2) GET  /.well-known/oauth-protected-resource/mcp ──► "the auth server is Supabase"
          ──3) talk to Supabase: register, log you in, PKCE ────► Supabase issues a signed JWT
          ──4) POST /mcp  (Bearer <JWT>) ──────────► FastMCP verifies JWT → tool runs as YOU
```

Steps 1–2 and 4's verification are handled by **FastMCP**. Step 3 is handled by
**Supabase**. The only screen we built is the little "Approve?" consent page.

---

## 2. The concepts (a 2-minute OAuth primer)

- **Bearer token / JWT** — a signed string that proves "this request is for user
  X." It's signed with Supabase's private key; anyone can verify it with
  Supabase's *public* key (the JWKS). Our REST API already does exactly this in
  `app/middleware/auth.py`; the connector reuses the same trust.
- **Resource Server (RS)** — a server that *checks* tokens but doesn't issue
  them. That's us. FastMCP's `SupabaseProvider` makes our `/mcp` endpoint an RS.
- **Protected-resource metadata (RFC 9728)** — a tiny JSON doc at
  `/.well-known/oauth-protected-resource/mcp` that tells Claude "to get a token,
  go ask Supabase." FastMCP serves this automatically.
- **Dynamic Client Registration / DCR (RFC 7591)** — instead of you manually
  creating an app ID/secret, Claude *registers itself* with Supabase on the fly.
  That's why you leave Client ID/Secret blank when adding the connector.
- **PKCE (RFC 7636)** — a proof step so that even if someone intercepts the
  one-time auth code, they can't exchange it for a token. Claude + Supabase do
  this; we don't write any of it.
- **JWKS** — the set of public keys Supabase publishes so token signatures can be
  verified. Key rotation is handled for us.

You didn't have to implement any of these — the point of the design is that
**Supabase is the AS and FastMCP is the RS**, so the whole dance is provided.

---

## 3. What got built (the code)

| File | What it does |
| --- | --- |
| `backend/app/mcp_server.py` | The MCP server: 11 tools + Supabase auth + identity resolution |
| `backend/app/main.py` | Mounts the MCP app at root, forwards its lifespan |
| `backend/app/config.py` | `MCP_PUBLIC_URL` setting (empty = connector disabled) |
| `backend/pyproject.toml` | Adds the `fastmcp` dependency |
| `frontend/src/routes/OAuthConsent.tsx` | The "Approve/Deny" screen at `/oauth/consent` |
| `frontend/src/router.tsx` | Registers the `/oauth/consent` route |

### The tools Claude gets

**Read:** `list_jobs`, `get_job`, `get_master_profile`, `get_pipeline`, `list_collections`
**Write:** `save_job` (add a job Claude found on the web), `save_draft`, `set_status`, `mark_emailed`, `flag_for_research`, `move_to_collection`

Collections are the user's folders. `save_job` takes an optional `collection`
name and `list_jobs` filters by one; both resolve the name case-insensitively
against the user's real collections and error with the actual list on a miss.
Claude can file jobs but never *creates* folders — that stays a deliberate act
in the app.

Every tool resolves *which account* from the token's `email` claim — the exact
same key `app/middleware/auth.py` uses — so the connector always acts as the
right user. The server's instructions tell Claude to **ground everything in your
real résumé and never invent facts**, and to never mark things
applied/emailed unless you say so.

### Why the MCP app is mounted at `/` (not `/mcp`)

Per RFC 9728, the metadata must live at the **origin root**:
`https://<host>/.well-known/oauth-protected-resource/mcp`. If we mounted the MCP
app under `/mcp`, that doc would end up at `/mcp/.well-known/...` and Claude
wouldn't find it. So we mount at root **after** the REST routes — the specific
`/v1/*` and `/health` routes match first, and only `/mcp` + the well-known doc
fall through to FastMCP. `MCP_PUBLIC_URL` is the bare origin; FastMCP appends
`/mcp` itself.

---

## 4. Turn it on — the runbook

### Step 1 — Enable Supabase's OAuth server
In the Supabase dashboard for your project:
1. **Authentication → OAuth Server** (a.k.a. "OAuth 2.1 server" / "Sign in with
   Supabase"). Turn it **on**.
   *(We confirmed the feature is available on your project — it currently returns
   `"OAuth server is disabled"`, which means it's supported, just off.)*
2. Set the **authorization URL path** to `/oauth/consent` (our consent page).
3. Enable **Dynamic Client Registration** (`allow_dynamic_registration`).

Verify it worked (should now return JSON with `registration_endpoint` and
`code_challenge_methods_supported: ["S256"]`):
```
curl https://<your-ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

### Step 2 — Set the backend env var (Render)
Add to the backend service:
```
MCP_PUBLIC_URL = https://<your-backend-host>       # bare origin, NO /mcp
```
Deploy. On boot you'll see a harmless warning about RFC 8707 resource indicators
(Supabase limitation — fine at our scale).

### Step 3 — Keep it awake
Render free sleeps after ~15 min; Claude's OAuth calls time out at **10s**. Add
the MCP origin to the existing `.github/workflows/keep-alive.yml` ping so a cold
start never lands mid-handshake.

### Step 4 — Add the connector in Claude
claude.ai → **Settings → Connectors → Add custom connector** → paste:
```
https://<your-backend-host>/mcp
```
Leave Client ID/Secret **blank** (DCR handles it). Click through the login →
you'll land on **our** `/oauth/consent` page → Approve.

### Step 5 — Try it
In a chat: *"List my saved jobs"* → then *"Draft a cover letter for job <id> and
save it."* Check the draft appears in the app.

---

## 5. Verify checklist (curl)

```bash
# 1) endpoint refuses anonymous calls and points at the metadata
curl -i -X POST https://<host>/mcp -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
#   → 401 + WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"

# 2) that metadata resolves and names Supabase as the auth server
curl https://<host>/.well-known/oauth-protected-resource/mcp
#   → {"resource":"https://<host>/mcp","authorization_servers":["https://<ref>.supabase.co/auth/v1"],...}

# 3) Supabase advertises DCR + PKCE
curl https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1
#   → has registration_endpoint and code_challenge_methods_supported:["S256"]
```

All three green = the handshake will work. (1 and 2 are already verified locally;
3 goes green once you flip the Supabase switch in Step 1.)

---

## 6. Gotchas we already hit (so you don't have to)

1. **URL exactness** — `MCP_PUBLIC_URL` is the **bare origin**; the connector URL
   is that **+ `/mcp`**. Getting this wrong doubles the path (`/mcp/mcp`) or
   hides the metadata. Verified fixed.
2. **Mount at root, REST first** — see §3. If a request to `/v1/...` ever 404s
   after this change, the mount got registered before the routers.
3. **Cold starts** — the #1 cause of "couldn't reach the connector." Keep-alive
   is mandatory, not optional.
4. **Lifespan forwarding** — `main.py` enters `mcp_app.lifespan(app)`; without it
   the MCP session manager never starts and every call errors.
5. **Not logged in during consent** — the consent page asks you to sign into the
   app first, then re-approve from Claude. You'll normally already be signed in.

---

## 7. What this is worth (portfolio note)

"I built a remote MCP server with full OAuth 2.1 (Supabase as the authorization
server, FastMCP as the resource server) so a user's own Claude can read and write
their data through a claude.ai custom connector" is a strong, current talking
point — it shows you understand OAuth, MCP, and clean service boundaries. The
code is small precisely *because* the boundaries are right.
