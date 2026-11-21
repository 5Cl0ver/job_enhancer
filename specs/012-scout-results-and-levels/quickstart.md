# Quickstart: checking 012 works

## Automated

```bash
# backend (SQLite)
cd backend && .venv/Scripts/python -m pytest -q && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
# frontend
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint . && npx vite build
# extension (copying company pages)
cd extension && npx vitest run && npx playwright test e2e/scout-company.spec.js
```

### Trial Postgres (port 55322, `scout_trial`)

Migrate with `alembic_scout.py`. Then run the rolled-back flow script with
these checks:

1. Queue a LinkedIn IT Admin run with Entry + Mid. Its start_urls carry
   `f_E=2%2C3%2C4`.
2. Report a fit-9 senior job. It's lowered to `min_fit − 1` with an app_note.
   Report a job with `in_area=false`: its outcome is `too_far`.
3. Run check_jobs with `total_results=12` on a 1-day search. The next link is
   the same search with `f_TPR=r259200`.
4. For a type with no related titles, the brief has `suggest_titles: 4`, and
   `set_search_titles` returns new start_urls.
5. GET /findings returns best, possible and long-shot groups with counts. Pass
   a job: it moves to passed.

## By hand (after deploy)

1. Reload the extension in `chrome://extensions` and refresh open tabs.
2. Scout → Resume types → IT Admin:
   - Level is Entry + Mid.
   - Press "Use recommended settings": it lists the changes, then applies them.
   - Press "Fill skills from your resume".
3. Start: each search shows one plain line, e.g. "Entry–mid IT Admin jobs ·
   Beaverton, OR + 25 mi · past week · fit 6+".
4. Run the LinkedIn IT Admin search with Claude.
   - The Last run card shows its numbers and **See results**.
   - Results opens on that run, with Best, Possible and Long shots.
5. Save a Best job (it lands in My Jobs) and pass another (it leaves New).
6. Run Local companies.
   - Company jobs are copied, and the Results rows have titles.
   - Each company lists the openings Claude saw.
   - Jobs outside the area are hidden as Too far.
7. Repeat steps 3–5 on a phone. Every feature is there, with no sideways
   scrolling.
