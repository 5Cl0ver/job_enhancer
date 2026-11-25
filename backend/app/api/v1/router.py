"""Aggregate all v1 API routers."""

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    ai,
    analytics,
    apply,
    attention,
    autofill,
    collections,
    email,
    extension,
    jobs,
    onboarding,
    saved_jobs,
    saved_searches,
    scout,
    tracker,
    usage,
    users,
)

api_router = APIRouter(prefix="/v1")

api_router.include_router(jobs.router, prefix="/jobs", tags=["Jobs"])
api_router.include_router(saved_jobs.router, prefix="/saved-jobs", tags=["SavedJobs"])
api_router.include_router(
    saved_searches.router, prefix="/saved-searches", tags=["SavedSearches"]
)
api_router.include_router(
    collections.router, prefix="/collections", tags=["Collections"]
)
api_router.include_router(tracker.router, prefix="/pipeline-stages", tags=["Tracker"])
api_router.include_router(ai.router, prefix="/ai", tags=["AI"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(admin.router, prefix="/admin", tags=["Admin"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
api_router.include_router(email.router, prefix="/email", tags=["Email"])
api_router.include_router(attention.router, prefix="/attention", tags=["Attention"])
api_router.include_router(scout.router, prefix="/scout", tags=["Scout"])
api_router.include_router(autofill.router, prefix="/autofill", tags=["Autofill"])
api_router.include_router(extension.router, prefix="/extension", tags=["Job Catcher"])
api_router.include_router(onboarding.router, tags=["Onboarding"])
api_router.include_router(usage.router, tags=["Usage"])
api_router.include_router(apply.router, prefix="/apply", tags=["Apply with Claude"])
api_router.include_router(
    apply.facts_router, prefix="/profile-facts", tags=["Apply with Claude"]
)
