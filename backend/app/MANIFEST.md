# Backend Application Manifest (`backend/app/`)

The FastAPI application — the backend's root. It's **layered**: requests enter
through `api/`, which calls `services/` (business logic), which read/write
`models/` (the database). `schemas/` define the typed request/response contract;
`middleware/` handles auth. Each layer has its own `MANIFEST.md`.

See [docs/architecture.md](../../docs/architecture.md) for the end-to-end request
lifecycle.

## Top-level files
| File | Purpose |
|---|---|
| `main.py` | Builds the FastAPI app: CORS, rate limiting, exception handlers, mounts the `/v1` routers, and starts the APScheduler background jobs (in the lifespan) |
| `config.py` | Settings loaded from `.env` (Pydantic `BaseSettings`): `DATABASE_URL`, `SUPABASE_URL`, external API keys, CORS origins, `ADMIN_EMAIL` |
| `database.py` | Async SQLAlchemy engine + session factory; `get_db` dependency (Supabase Postgres, SSL, pooler-safe) |
| `__init__.py` | Package marker |

## Layers (each folder has its own MANIFEST)
| Folder | Responsibility |
|---|---|
| `api/` | HTTP endpoints (FastAPI routers), grouped under `/v1` |
| `schemas/` | Pydantic request/response models — the API contract |
| `services/` | Business logic (async functions). `services/sources/` = pluggable job-source adapters |
| `models/` | SQLAlchemy ORM models (database tables) |
| `middleware/` | Auth dependency — verifies Supabase JWTs via JWKS |
| `utils/` | Small helpers (e.g. `rate_limit.py`) |

## How a request flows
```
HTTP request
  → api/ router        (validates with schemas/, auth via middleware/)
  → services/ logic    (may call services/sources/ for external job data)
  → models/ via database.py   (read/write Postgres)
  → schemas/ serialize the response → JSON
```

## Sibling directories (outside `app/`)
| Dir / file | Purpose |
|---|---|
| `alembic/` | Database migrations (`versions/`); run `alembic upgrade head` |
| `tests/` | pytest suite (runs on in-memory SQLite) |
| `scripts/` | Dev utilities (e.g. `seed_dev.py` loads sample jobs) |
| `pyproject.toml` | Dependencies + tooling (ruff, pytest) |
| `Dockerfile` | Container image for the Render deploy |
