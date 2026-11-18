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
the brief. *Superseded in part by R8–R10: the prompt is now one fixed line, the
brief carries no skip lists, and the extension captures the listing.*

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

## R8. Context budget: the real cost is the browsing, not the prompt (revised 2026-11-18)

**Problem found in review**: the first design handed Claude the whole "already
seen" list in the brief (grows forever) and had Claude echo each full job
description back through `report_job` (doubles the tokens and lets the model
reword the listing). The biggest cost was never modelled at all: what the
browsing itself puts into the chat.

**Findings**:
- A screenshot costs ~1,000–1,800 input tokens; a 200k window "can fill up in
  well under 100 screenshots", and old screenshots stay in the chat and are
  re-read every turn ([Anthropic: best practices for computer and browser
  use](https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude);
  [claude-code #27869](https://github.com/anthropics/claude-code/issues/27869)).
- Measured over 7,500+ Claude in Chrome calls: screenshot calls median 1,855
  tokens vs 373 for text-only calls; the 23% of calls that were screenshots were
  49% of all tokens ([dev.to analysis](https://dev.to/vousmeevoyez/your-browser-agent-pays-to-look-at-pictures-opencli-vs-claude-in-chrome-token-use-52ae)).
- Anthropic's context-engineering guidance: keep "lightweight identifiers" and
  load data just in time through tools; keep durable state in notes outside the
  context window; split work so each context stays small and hands off a short
  summary ([Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

**Decision**: the app is the memory and the planner; each chat does one small,
bounded piece of work, and nothing important lives in the chat.
1. **Tiny brief** (about 1–1.5k tokens): rules, the track, the progress, the
   start URL. No lists of saved jobs, findings or companies, ever.
2. **Just-in-time dedupe**: `check_jobs` takes the rows of one results page and
   returns the positions worth opening. Cost is per page and flat, however big
   the tracker gets.
3. **The app builds the search URL** (LinkedIn `keywords`, `f_TPR=r604800` for a
   week, `sortBy=DD`, location, `f_WT=2` for remote; Indeed `q`, `l`,
   `fromage`). Claude doesn't spend screenshots clicking filters. LinkedIn's
   salary filter is unreliable, so the app applies min pay to the captured pay.
4. **Text first**: the playbook tells Claude to read pages as text and take a
   screenshot only when something has to be seen.
5. **Claude never sends job text back** (R9): `report_job` is a link plus an
   opinion, about 150 tokens.
6. **Small, resumable runs**: a run is at most 5 saved jobs (board) or 5
   companies (local). Progress lives in the app, so if a chat gets long or drops,
   a new chat with the same one line continues it. Local runs hand out companies
   one at a time (`log_company` returns the next one).

**Budget target** (measured in the end-to-end test): a 5-job board run under
~60k tokens of context, with the brief plus all app replies under 5k of that.

**Alternatives**: a big generated prompt (the original fallback): dropped.
Claude Code with a fresh sub-agent per job page (clean context per job): good
for later scheduled runs, but it needs a terminal, and the user's tool is the
Chrome side panel.

## R9. The exact listing comes from the page, never from Claude (revised 2026-11-18)

**Decision**: the saved job is a faithful copy of the posting. Nothing in it is
written by AI.
- The **Job Catcher extension** is already in the same Chrome and already has a
  tested extractor (`extension/src/extract/`: JSON-LD → LinkedIn / Indeed /
  ZipRecruiter selectors → generic) that reads the full description, company,
  location and link off the page. While a Scout run is open, its content script
  captures each job page Claude opens and posts it to `POST /v1/scout/captures`,
  keyed by canonical URL. It learns a run is open from
  `GET /v1/scout/runs/active` (cached 60 s, asked only on job pages).
- Company sites on **Greenhouse, Lever or Ashby**: the app fetches the posting
  from their public job-board APIs by job id, which is the employer's own data.
- Other company sites: most hiring-system pages carry JSON-LD `JobPosting`; the
  content script reads those too during an open run.
- No copy → the job is not saved; the run page lists it with "Open and press
  Save". The app never falls back to Claude's version of the text.
- Claude's own words (fit, why, gaps) are stored separately and labelled as
  Claude's.

**Rationale**: the user tailors applications from the description, so it must
be exact. A model relaying 1–3k words can drop or reword lines, and it costs
output tokens and time. The extractor is already tested against saved pages.

## R10. One line, every time

**Decision**: Start puts a run in a queue; the prompt is always the same line
("Do my next Job Scout run with the Job Enhancer connector"), so the user can
save it as a Claude in Chrome shortcut. Shortcuts can be scheduled, but Chrome
has to be open and the computer awake, so scheduling comes later.
