# Implementation Plan: Claude Scout keeps going

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

## Technical context

- **Backend only** for part A: FastAPI and SQLAlchemy, in `app/services/scout_runs.py`, `app/services/scout_instructions.py` and `app/scout/*.md`.
- **No migration:** the added searches and steps live in the run's `criteria` snapshot (JSON), and the new limit in the existing limits JSON.
- **Part B** also touches `scout_companies.py`, `mcp_server.py`, `local_companies.md` and `frontend/src/lib/scout.ts` (one label).

## Design

- **Criteria:**
  - `where`: the place with its state, from `_with_state()` at queue time.
  - `more`: the added searches (`title`, `words`, `days`, `remote`, `step`).
  - `steps`: the steps taken.
- **Searches:** `search_links(c)` = the first searches + `more`. `_link(c, words, days, remote=)` builds each one. `base_count(c)` is how many the run started with.
- **Keep going:** in `check_jobs`, when the last search is done and the run is short, `_keep_going(c, stats)` returns the next step's searches. Within the added searches, `_looked_enough` skips the rest once past the "looks" limit.
- **Windows:**
  - `_days_at(c, link)` gives each search's window, so widening works for added searches too.
  - `_widen_to` now includes Google.
- **Matching pages:** `_link_of(c, url, at)` prefers the current search.
- **Finish line:** `looked_line()` adds the jobs looked through and the steps taken; `links_line` names at most 8 searches.
- **Instructions:**
  - The locked rules: one job never ends a run.
  - Playbook step 8: keep going with check_jobs' next_page_url.
  - `PLAYBOOK_VERSION` 2026.11.11.

## Constitution check

- **Simplicity:** no new tables. The ladder is three fixed steps.
- **Tests first:** existing tests were updated where the behavior intentionally changed; new `tests/test_scout_keeps_going.py`.
- **Security:** no new routes, and no user text goes into the links except as URL-encoded query values (as before).
