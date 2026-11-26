"""Counts for the navigation badges."""

from pydantic import BaseModel


class AttentionOut(BaseModel):
    """How many things are waiting on the user. Counts only, never content."""

    # Reserved for job to-dos; 0 until those exist, so clients don't change.
    tasks_open: int = 0
    tasks_overdue: int = 0
    # Email updates waiting for a click or an answer.
    email_review: int = 0
    # Jobs Claude Scout picked that are waiting to be ticked and saved.
    scout_review: int = 0
    # New bugs in Bugs & ideas, for the owner only (spec 032); 0 for anyone else.
    bugs_new: int = 0
