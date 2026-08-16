"""SQLAlchemy ORM models.

Import order matters for Alembic to detect all tables:
all models must be imported here before alembic env.py
calls Base.metadata.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import all models so Alembic can discover them
from app.models.application_profile import ApplicationProfile  # noqa: E402, F401
from app.models.collection import Collection  # noqa: E402, F401
from app.models.custom_answer import CustomAnswer  # noqa: E402, F401
from app.models.detected_event import DetectedEvent  # noqa: E402, F401
from app.models.email_account import EmailAccount  # noqa: E402, F401
from app.models.generated_document import GeneratedDocument  # noqa: E402, F401
from app.models.job_listing import JobListing  # noqa: E402, F401
from app.models.pipeline_stage import PipelineStage  # noqa: E402, F401
from app.models.resume import Resume  # noqa: E402, F401
from app.models.saved_job import SavedJob  # noqa: E402, F401
from app.models.saved_search import SavedSearch  # noqa: E402, F401
from app.models.user import User  # noqa: E402, F401

__all__ = [
    "Base",
    "ApplicationProfile",
    "CustomAnswer",
    "DetectedEvent",
    "EmailAccount",
    "User",
    "JobListing",
    "Collection",
    "PipelineStage",
    "SavedJob",
    "Resume",
    "GeneratedDocument",
    "SavedSearch",
]
