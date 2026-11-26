"""Job Catcher's pass opens only what Job Catcher does (spec 019, security).

Every route is app-session only unless it opts in with ``get_user_or_pass``.
This test walks the whole route table, so a new route that quietly accepts a
pass fails here until it's added to the allowlist on purpose.
"""

import hashlib
import secrets

import pytest
from fastapi.routing import APIRoute
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.middleware.auth import get_current_user, get_user_or_pass
from app.models.extension import ExtensionToken
from app.models.user import User

# Every (method, path) Job Catcher's background or panel calls. Keep in step
# with extension/src and extension/panel (grep "/v1/").
PASS_ROUTES = {
    ("GET", "/v1/users/me"),
    ("PATCH", "/v1/users/me/claude-project"),
    ("GET", "/v1/users/me/application-profile"),
    ("PUT", "/v1/users/me/application-profile"),
    ("PUT", "/v1/users/me/custom-answers"),
    ("POST", "/v1/users/me/custom-answers/used"),
    ("DELETE", "/v1/users/me/custom-answers/{question_key:path}"),
    ("GET", "/v1/saved-jobs/"),
    ("GET", "/v1/saved-jobs/summary"),
    ("POST", "/v1/saved-jobs/manual"),
    ("POST", "/v1/saved-jobs/check"),
    ("POST", "/v1/saved-jobs/backfill"),
    ("POST", "/v1/saved-jobs/mark-applied"),
    ("POST", "/v1/saved-jobs/sync-applications"),
    ("GET", "/v1/autofill/bundle"),
    ("POST", "/v1/autofill/taught"),
    ("GET", "/v1/autofill/taught"),
    ("DELETE", "/v1/autofill/taught/{taught_id}"),
    ("GET", "/v1/autofill/resumes/{resume_id}/details"),
    ("POST", "/v1/autofill/resumes/{resume_id}/read"),
    ("POST", "/v1/autofill/promoted"),
    ("GET", "/v1/autofill/resumes/{resume_id}/file"),
    # The job's cover letter, for Job Catcher to attach or paste (spec 031).
    ("GET", "/v1/autofill/cover-letters/{letter_id}"),
    ("PUT", "/v1/saved-jobs/{saved_job_id}/resume"),
    ("GET", "/v1/ai/resumes"),
    ("GET", "/v1/ai/resumes/active/file"),
    ("POST", "/v1/ai/prompt"),
    ("POST", "/v1/ai/autofill-map"),
    ("POST", "/v1/ai/work-history"),
    ("POST", "/v1/ai/documents/manual"),
    ("POST", "/v1/ai/generate"),
    ("GET", "/v1/ai/documents/{doc_id}/pdf"),
    ("GET", "/v1/scout/runs/active"),
    ("POST", "/v1/scout/captures"),
    ("GET", "/v1/apply/active"),
    ("POST", "/v1/apply/requests/{request_id}/claim"),
    ("POST", "/v1/apply/requests/{request_id}/photo"),
    ("POST", "/v1/apply/requests/{request_id}/result"),
    ("POST", "/v1/apply/runs/{run_id}/event"),
    ("POST", "/v1/apply/runs/{run_id}/live"),
    ("POST", "/v1/extension/hello"),
    # Job Catcher's own failures, kept with no user (spec 032).
    ("POST", "/v1/bugs/caught"),
    # The owner's "Report a problem here": a report and its picture. The
    # route itself still refuses anyone but the owner (spec 032).
    ("POST", "/v1/admin/bugs"),
    ("POST", "/v1/admin/bugs/{report_id}/shots"),
    ("DELETE", "/v1/extension/tokens/current"),
}


def _uses(dependant, fn) -> bool:
    return any(d.call is fn or _uses(d, fn) for d in dependant.dependencies)


def _all_routes():
    """Every API route with its full path (FastAPI 0.140 wraps included
    routers; their effective contexts carry the prefixed path)."""
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route.path, route.methods, route.dependant
        elif hasattr(route, "effective_route_contexts"):
            for ctx in route.effective_route_contexts():
                yield ctx.path, ctx.methods, ctx.dependant


def test_the_route_walk_sees_the_api():
    paths = {path for path, _m, _d in _all_routes()}
    assert "/v1/users/me/export" in paths and len(paths) > 100


def test_only_the_allowlisted_routes_accept_a_pass():
    accepting = set()
    for path, methods, dependant in _all_routes():
        if _uses(dependant, get_user_or_pass):
            accepting |= {(m, path) for m in methods}
    assert accepting == PASS_ROUTES


def test_no_route_uses_both():
    for path, _methods, dependant in _all_routes():
        both = _uses(dependant, get_user_or_pass) and _uses(dependant, get_current_user)
        assert not both, path


async def _a_pass(db: AsyncSession, user: User) -> str:
    token = "jcx_" + secrets.token_urlsafe(32)
    db.add(
        ExtensionToken(
            user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest()
        )
    )
    await db.commit()
    return token


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("DELETE", "/v1/users/me"),
        ("GET", "/v1/users/me/export"),
        ("PATCH", "/v1/users/me"),
        ("GET", "/v1/admin/stats"),
        ("GET", "/v1/admin/users"),
        ("GET", "/v1/email/account"),
        ("POST", "/v1/email/connect"),
        ("GET", "/v1/extension/tokens"),
        ("POST", "/v1/extension/connect/approve"),
    ],
)
async def test_a_pass_is_refused_for_account_admin_email_and_connections(
    anon_client: AsyncClient,
    db_session: AsyncSession,
    admin_user: User,
    method: str,
    path: str,
):
    """Even the owner's own pass can't delete, export, administer, connect
    email or manage Job Catcher connections."""
    token = await _a_pass(db_session, admin_user)
    kwargs = {"json": {}} if method in ("POST", "PATCH") else {}
    r = await anon_client.request(
        method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs
    )
    assert r.status_code == 401, (path, r.status_code, r.text)
    assert "Job Enhancer app" in r.text


@pytest.mark.asyncio
async def test_a_pass_works_on_job_catcher_routes(
    anon_client: AsyncClient, db_session: AsyncSession, test_user: User
):
    token = await _a_pass(db_session, test_user)
    auth = {"Authorization": f"Bearer {token}"}
    assert (await anon_client.get("/v1/users/me", headers=auth)).status_code == 200
    assert (
        await anon_client.get("/v1/saved-jobs/summary", headers=auth)
    ).status_code == 200
    r = await anon_client.patch(
        "/v1/users/me/claude-project",
        json={"claude_project_url": "https://claude.ai/project/abc"},
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["claude_project_url"] == "https://claude.ai/project/abc"
    for bad_url in (
        "javascript:alert(1)",
        "https://evil.example/project",
        "http://claude.ai/project/x",
        "https://claude.ai.evil.example/",
        "https://claude.ai/ x",
    ):
        bad = await anon_client.patch(
            "/v1/users/me/claude-project",
            json={"claude_project_url": bad_url},
            headers=auth,
        )
        assert bad.status_code == 422, bad_url
    cleared = await anon_client.patch(
        "/v1/users/me/claude-project", json={"claude_project_url": ""}, headers=auth
    )
    assert cleared.json()["claude_project_url"] is None


@pytest.mark.asyncio
async def test_the_apps_own_settings_take_only_claude_links(client: AsyncClient):
    ok = await client.patch(
        "/v1/users/me", json={"claude_project_url": "https://claude.ai/project/abc"}
    )
    assert ok.status_code == 200
    bad = await client.patch(
        "/v1/users/me", json={"claude_project_url": "https://evil.example/x"}
    )
    assert bad.status_code == 422
