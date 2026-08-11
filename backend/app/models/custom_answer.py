"""CustomAnswer ORM model — the "learn-as-you-go" autofill memory.

When an application form asks a question we can't map to the profile vault
(e.g. "Years of React experience?", "Desired start date?"), the user answers
it once and the extension remembers the answer keyed by a NORMALIZED version
of the question text. Next time any site asks the same question, autofill
reuses the answer.

One row per (user, question_key). Synced across the user's devices, included
in their data export, and deleted with the account (FK cascade) — same
self-managed model as the rest of their data.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class CustomAnswer(Base):
    __tablename__ = "custom_answers"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Normalized question (lowercased, punctuation stripped) — the match key.
    question_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    # The original question, shown back to the user so they recognize it.
    question_text: Mapped[str] = mapped_column(String(500), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<CustomAnswer user_id={self.user_id} key={self.question_key!r}>"
