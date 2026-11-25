# Tasks: Claude Scout keeps going

## Part A: keep going, Google, remote (PR `021-scout-keeps-going`)

- [X] T001 [US2] Write Google links as "near {place}" plus the window in words in backend/app/services/scout_runs.py (`_link`, `_google_window`)
- [X] T002 [US2] Add remote links for each board (LinkedIn US + f_WT=2, Indeed's Remote filter, ZipRecruiter's only_remote) in backend/app/services/scout_runs.py
- [X] T003 [US2] Add the place with its state (`_with_state`, `criteria["where"]`, `search_place`) in backend/app/services/scout_runs.py
- [X] T004 [US1] Add the keep-going ladder (`_keep_going`, `_left_out`, `base_count`, `_days_at`, `more`/`steps`) in check_jobs in backend/app/services/scout_runs.py
- [X] T005 [US1] Add the "looks" limit (200, range 50–500) in backend/app/services/scout_instructions.py
- [X] T006 [US1] Make the search the run is on win in `_link_of`; widen Google in `_widen_to`
- [X] T007 [US1] Add the finish line (`looked_line`, `links_line` capped at 8)
- [X] T008 [US3] Update the locked rules (backend/app/scout/rules.md) and playbook step 8 (backend/app/scout/playbook.md); bump `PLAYBOOK_VERSION`
- [X] T009 [P] Write tests in backend/tests/test_scout_keeps_going.py; update the existing tests whose expectations changed on purpose

## Part B: Local companies (PR `021-scout-local-companies`)

- [X] T010 [US4] Build title-based company searches, with IT-heavy kinds only to fill in, in backend/app/services/scout_runs.py
- [X] T011 [US4] Add the `not_checked` result, retried next run, in backend/app/models/scout.py, backend/app/services/scout_companies.py, backend/app/mcp_server.py and frontend/src/lib/scout.ts
- [X] T012 [US4] Update backend/app/scout/local_companies.md: leave out national companies, add not_checked, and never accept extra cookies
- [X] T013 [P] Write tests in backend/tests/test_scout_companies.py and frontend/tests/lib/scout.test.ts
