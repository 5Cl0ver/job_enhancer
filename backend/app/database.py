"""Async SQLAlchemy engine and session factory (Supabase PostgreSQL)."""

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

# Supavisor / PgBouncer (transaction mode) requires
# prepared_statement_cache_size=0. Pool settings only apply to Postgres —
# tests run on in-memory SQLite, which rejects them.
_engine_kwargs: dict[str, Any] = {"echo": settings.debug}
if settings.database_url.startswith("postgresql"):
    _engine_kwargs.update(
        connect_args={
            "ssl": "require",
            "prepared_statement_cache_size": 0,
        },
        pool_size=5,
        max_overflow=5,
        pool_timeout=30,
        pool_recycle=1800,
        pool_pre_ping=True,
    )

engine = create_async_engine(settings.database_url, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a database session."""
    async with AsyncSessionLocal() as session:
        yield session
