"""Pytest fixtures for the Job Enhancer backend test suite.

Each test gets a fresh in-memory SQLite database. The `client` fixture is
authenticated as a regular user (auth dependency overridden); use
`admin_client` for admin routes and `anon_client` to test 401 behavior.
"""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.middleware.auth import get_current_user
from app.models import Base
from app.models.user import User
from app.services.users import create_user

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def engine():
    """Fresh in-memory database per test — full isolation."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Regular user with default collection + 8 default stages seeded."""
    return await create_user(db_session, email="user@test.dev", name="Test User")


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession) -> User:
    return await create_user(
        db_session,
        email="admin@test.dev",
        name="Admin",
        admin_email="admin@test.dev",
    )


def _make_client(db_session: AsyncSession, user: User | None):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


@pytest_asyncio.fixture
async def client(db_session: AsyncSession, test_user: User):
    """HTTP client authenticated as a regular user."""
    async with _make_client(db_session, test_user) as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_client(db_session: AsyncSession, admin_user: User):
    """HTTP client authenticated as the admin."""
    async with _make_client(db_session, admin_user) as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def anon_client(db_session: AsyncSession):
    """HTTP client with NO authentication — for 401 tests."""
    async with _make_client(db_session, None) as ac:
        yield ac
    app.dependency_overrides.clear()
