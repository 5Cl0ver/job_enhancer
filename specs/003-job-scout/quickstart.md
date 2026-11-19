# Quickstart: validating Job Scout

## Prerequisites

- Backend + frontend running (local or the trial stack), migrations at head.
- The Job Enhancer connector added in Claude (claude.ai → Connectors) and
  enabled for Claude in Chrome.

## Automated checks

```bash
cd backend && pytest tests/services/test_scout_*.py tests/api/test_scout.py tests/test_mcp_scout.py -q
cd frontend && npx vitest run tests/lib/scout.test.ts tests/components/Scout*.test.tsx && npx vite build
```

They must prove:
1. Dedupe: a report matching a saved job (company+title, or the same posting
   under a LinkedIn and a company URL) returns `duplicate`; a dismissed finding
   blocks the job forever. ([data-model](data-model.md) `scout_findings`)
2. `report_job` rejects search-page URLs and below-bar scores without saving.
3. Run lifecycle pending → running → done; reports after `done` are refused.
4. Company due logic: 2-day-old non-hot company not due; hot one due after 1 day;
   blocked never.
5. Every scout tool rejects another user's run id (404, no leak).
6. The connector cannot change a stage or mark applied.

## Manual end-to-end (the demo)

1. Find Jobs → Claude Scout → Resume types: create "IT Admin" and "Business Analyst", attach a resume to each.
2. Find Jobs → Claude Scout → Start: LinkedIn · IT Admin · 5 · last 7 days · $70K · fit ≥ 6.
   Launch → copy the prompt (under 30 s, SC-002).
3. Paste into Claude in Chrome. On the Claude Scout tab the run turns *running* and the
   jobs appear one by one with fit scores.
4. Launch the same mission again → the agent's `check_job` calls say "seen";
   **0 new duplicates** (SC-001).
5. Mission "Local companies · IT Admin": the run logs ~25 companies; Companies tab
   shows them with last-checked dates; block one → it is in the next brief's
   `avoid` list and never `due`.
6. Open a scout job → it shows track, fit, why/gaps and offers the track's resume.
