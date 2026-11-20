# Quickstart: validating 010

## Automated checks

```bash
cd backend && .venv/Scripts/python -m pytest -q && .venv/Scripts/python -m ruff check . && .venv/Scripts/python -m ruff format --check .
cd frontend && npx tsc --noEmit -p . && npx eslint src tests && npx vitest run && npx vite build
```

## Trial Postgres copy (port 55322 only)

1. Run the migration up, down and up with `alembic_scout.py`.
2. Run a script in a rolled-back transaction that checks:
   - Edit the main steps; queue a run. The brief has the edit, then the
     rubric line, then the locked rules.
   - Reset. A second run gets the original, and the first run's brief still
     has the edit.
   - Limits `pages=2`: `check_jobs` stops after page 2.
   - Connector calls through the `mcp_server` tools write `scout_run_events`.
     A refused call is logged with `ok=false`. The brief event carries no
     instruction text, and no resume text appears anywhere.
   - RLS is on for both tables.

## By hand, after deploy

1. Find Jobs → Claude Scout → **Instructions**, on a phone: every section is
   there, and the locked ones show a lock.
2. Edit the main steps, then Preview a search: the edit shows, followed by the
   locked rules. Reset, and the original is back.
3. Run a search. In History, open the run → **Log**: each step shows in order,
   and "Read your resume" appears without the resume.

Shapes are in [contracts/rest-api.md](contracts/rest-api.md) and
[data-model.md](data-model.md).
