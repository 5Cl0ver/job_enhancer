"""FastAPI application entry point."""

import logging
from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack, asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router
from app.config import settings
from app.database import AsyncSessionLocal
from app.mcp_server import build_mcp_app
from app.utils.rate_limit import rate_limit_key

logger = logging.getLogger(__name__)

# The Claude custom-connector MCP app (None when MCP_PUBLIC_URL is unset).
mcp_app = build_mcp_app()


@asynccontextmanager
async def _scheduler_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Start/stop the background job scheduler."""
    from app.services.notifications import send_follow_up_reminders
    from app.services.users import purge_deleted_users

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        send_follow_up_reminders,
        trigger="interval",
        hours=1,
        args=[AsyncSessionLocal],
        id="follow_up_reminders",
        replace_existing=True,
    )
    scheduler.add_job(
        purge_deleted_users,
        trigger="interval",
        hours=24,
        args=[AsyncSessionLocal],
        id="purge_deleted_users",
        replace_existing=True,
    )
    from app.services.saved_searches import refresh_saved_searches

    scheduler.add_job(
        refresh_saved_searches,
        trigger="interval",
        hours=24,
        args=[AsyncSessionLocal],
        id="refresh_saved_searches",
        replace_existing=True,
    )
    from app.services.job_search import ingest_curated_jobs, mark_expired_listings

    scheduler.add_job(
        mark_expired_listings,
        trigger="interval",
        hours=24,
        args=[AsyncSessionLocal],
        id="mark_expired_listings",
        replace_existing=True,
    )
    scheduler.add_job(
        ingest_curated_jobs,
        trigger="interval",
        hours=6,
        args=[AsyncSessionLocal],
        id="ingest_curated_jobs",
        replace_existing=True,
    )
    scheduler.start()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """App lifespan. Forwards the MCP session-manager lifespan (required for the
    connector to work) and runs the scheduler."""
    async with AsyncExitStack() as stack:
        if mcp_app is not None:
            # MUST enter the MCP app's lifespan or its session manager never
            # initializes and every connector request errors.
            await stack.enter_async_context(mcp_app.lifespan(app))
        await stack.enter_async_context(_scheduler_lifespan(app))
        yield


# Rate limiter — 60 requests/minute per authenticated user (IP fallback)
limiter = Limiter(key_func=rate_limit_key, default_limits=["60/minute"])

app = FastAPI(
    title="Job Enhancer API",
    version="1.0.0",
    description="Job Search Assistant MVP — FastAPI backend",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    lifespan=lifespan,
)

# Rate limiting error handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

# CORS — only allow configured origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.exception_handler(422)
async def validation_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": str(exc)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort 500 handler — logs the error, never leaks internals."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


@app.get("/health", tags=["Health"], include_in_schema=False)
async def health() -> dict:
    return {"status": "ok"}


# Mount all v1 routes
app.include_router(api_router)

# Mount the Claude connector (MCP) at ROOT when configured — registered LAST so
# the REST routes above match first; only the MCP endpoint (/mcp) and its OAuth
# metadata (/.well-known/oauth-protected-resource/mcp) fall through to it, at the
# origin root where Claude expects them. FastMCP owns auth on those paths
# (Supabase OAuth), independent of the REST Bearer-token dependency.
if mcp_app is not None:
    app.mount("/", mcp_app)
