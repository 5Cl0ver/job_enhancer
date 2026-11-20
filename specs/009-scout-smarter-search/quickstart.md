# Quickstart: validating 009

## Automated checks

```bash
cd backend && .venv/Scripts/python -m pytest -q          # all, incl. the new 009 tests
cd backend && .venv/Scripts/python -m ruff check . && .venv/Scripts/python -m ruff format --check .
cd frontend && npx tsc --noEmit -p . && npx eslint src tests && npx vitest run && npx vite build
```

## Database checks (trial Postgres copy only, port 55322)

1. Migration: `alembic_scout.py upgrade head`, `downgrade f4a5b6c7d8e0`, then
   `upgrade head`, all against the trial copy.
2. Run a script inside a rolled-back transaction to check the following (the
   shapes are in [data-model.md](data-model.md)):
   - A broad mission is created and queued.
   - `set_search_titles` applies Always, Never and the cap, and the
     `scout_titles` rows go up.
   - `check_jobs` skips an Avoid word.
   - `report_job` with `resume_type` sets `closest_track_id` and
     `search_title`.
   - A title with 3 empty runs is resting, and an Always title isn't.
   - The `RunOut.titles` counts are right.

## By hand, after deploy (with the user)

1. **Scoring (US1):** run an existing IT Admin search. In the review, "why it
   fits" names something from the resume.
2. **Broad (US2):**
   - Make a LinkedIn search with Resume type set to **Anything I'd be good
     at**, press Start and say the usual line.
   - Claude reads the resume, sets its titles and searches.
   - History shows "Claude searched for: …" with counts, and each good fit
     shows its closest resume type.
3. **Overrides (US3):** add a Never title and an Avoid word. The next run
   doesn't search the title, and "had a word you skip" counts the word.
4. **Visibility (US4):** on a phone, open the run in History and tap Add to
   resume type on a title. It appears in that resume type.
5. **No resume:** with no active resume, Start on a broad search says to
   upload one first.

The connector and REST shapes are in [contracts/](contracts/).
