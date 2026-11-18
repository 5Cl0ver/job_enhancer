# Research: Job Scout

## R1. How the browser agent and the app talk

**Decision**: The app never drives a browser. The user runs Claude in Chrome; the
agent reads and writes app state through the app's existing MCP connector
(`backend/app/mcp_server.py`, FastMCP + Supabase OAuth), extended with scout
tools. The pasted prompt is two lines: which run to do, and to start with
`get_scout_brief(run_id)`.

**Rationale**: The connector already authenticates as the user and already
saves jobs (`save_job`) and lists them (`list_jobs`) for Claude in Chrome. Keeping
state server-side is what makes dedupe and the company log work across runs; a
pasted "COMPANY LOG" block (today's approach) is lost, truncated or stale.
A short prompt also can't drift from the rules, because the rules come back in
the brief.

**Alternatives considered**:
- *Long generated prompt containing everything* (criteria + every saved job +
  company log): breaks past a few hundred jobs, and the agent can't write back.
  Kept only as a fallback "copy full prompt" for when the connector isn't on.
- *App-side scraping/headless browser*: against board terms, blocked by
  CAPTCHAs, and needs paid hosting. Rejected.
- *Our own Chrome extension doing the search*: the extension exists for saving
  and autofill, but writing a reliable browsing agent is exactly what Claude in
  Chrome already is. Rejected.

## R2. Job boards' terms

**Decision**: Treat boards (LinkedIn especially) as "the user browsing with an
assistant": small counts (default 5, max 15 per run), user present, normal
pacing, no bulk export. The UI says so plainly next to the board sources.

**Rationale**: LinkedIn's user agreement forbids bots and automated access; the
risk is to the user's own account. Low volume, user-supervised runs keep it close
to normal use. The app's own code never touches the boards. Local company
career pages and their ATS feeds (Greenhouse, Lever, Ashby, Workday JSON) are
public and meant to be read.

## R3. Dedupe key

**Decision**: Two keys, either one counts as "seen":
1. `norm(company) + norm(title)` — lowercased, punctuation stripped, company
   suffixes (inc, llc, corp, co, ltd) and seniority noise kept (Senior vs not is
   a different job).
2. Canonical posting URL — scheme/host lowercased, tracking params (`utm_*`,
   `trk`, `refId`, `gh_src`…) stripped; LinkedIn `/jobs/view/{id}`, Indeed `jk=`,
   Greenhouse/Lever/Ashby/Workday job ids extracted where present.

Checked against `saved_jobs` (via `job_listings`) **and** `scout_findings`
(every job any run reported, including below-bar and dismissed).

**Rationale**: The same job is posted on LinkedIn and the company site with
different URLs; title+company catches that. Different roles at one company stay
distinct. Reuses the normalisation ideas in `app/services/dedup.py`/email match.

## R4. Fit score

**Decision**: The agent scores 0–10 against the track's rubric, returned in the
brief: skills match (4), years/degree met (2), title/level fit (2), recency (1),
pay/location (1). It must send `why_fit` and `gaps`. The app stores the score and
reasons as given and labels them (8–10 Strong, 6–7 Good, below min = not saved).

**Rationale**: The agent has the full posting in front of it; a server-side
re-score would need the LLM again (cost) for little gain. The rubric is
versioned with the playbook (constitution III). A cheap server-side sanity check
(e.g. "requires bachelor's" with no "or equivalent" when the track says skip)
can lower a score, never raise it.

## R5. Company "due" logic

**Decision**: `due = not blocked and (last_checked is null or last_checked <
now - 3 days or (hot and last_checked < now - 1 day))`. The brief returns up to
15 due companies (hot first, oldest first) plus a request for ~10 new ones in
the track's rotation of employer types, and the names to avoid (all known
companies), so "new" really is new.

## R6. Resumes per track

**Decision**: A track links to an existing `resumes` row (upload stays as is);
`resumes.is_active` keeps meaning "default". Scout jobs carry `track_id`, so the
job page, AI Quick Apply and the extension's autofill pick that track's resume.

**Alternatives**: a separate file store per track — duplicates what `resumes`
already does.

## R7. Live run status on the page

**Decision**: Poll `GET /v1/scout/runs/{id}` every 5 s while a run is open
(TanStack Query `refetchInterval`), stop when done. Free-tier friendly, no
websockets; matches the side panel's cheap-poll pattern.
