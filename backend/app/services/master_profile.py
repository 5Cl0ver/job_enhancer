"""The master profile Claude writes from (spec 022).

One grounded text block: the application profile, saved answers, the things
the user told Claude, and the **master résumé** (the big "everything I've
done" one the user picked in Settings › Résumés; none picked = the usual one).
Claude must tailor ONLY from this — never invent facts.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application_profile import ApplicationProfile
from app.models.apply import ProfileFact
from app.models.custom_answer import CustomAnswer
from app.models.resume import Resume
from app.models.user import User

MAX_FACTS = 200


async def master_resume(db: AsyncSession, user_id: uuid.UUID) -> Resume | None:
    """The master résumé, else the usual (active) one."""
    rows = list(
        await db.scalars(
            select(Resume).where(
                Resume.user_id == user_id,
                (Resume.is_master.is_(True)) | (Resume.is_active.is_(True)),
            )
        )
    )
    master = next((r for r in rows if r.is_master), None)
    return master or next((r for r in rows if r.is_active), None)


async def facts(db: AsyncSession, user_id: uuid.UUID) -> list[ProfileFact]:
    return list(
        await db.scalars(
            select(ProfileFact)
            .where(ProfileFact.user_id == user_id)
            .order_by(ProfileFact.created_at)
            .limit(MAX_FACTS)
        )
    )


async def profile_text(db: AsyncSession, user: User) -> str:
    p = await db.scalar(
        select(ApplicationProfile).where(ApplicationProfile.user_id == user.id)
    )
    answers = list(
        await db.scalars(select(CustomAnswer).where(CustomAnswer.user_id == user.id))
    )
    resume = await master_resume(db, user.id)
    told = await facts(db, user.id)

    tri = lambda v: "Yes" if v is True else "No" if v is False else None  # noqa: E731
    pairs = [
        (
            "Name",
            " ".join(x for x in [p and p.first_name, p and p.last_name] if x) or None,
        ),
        ("Email", user.email),
        ("Phone", p and p.phone),
        ("Location", ", ".join(x for x in [p and p.city, p and p.state] if x) or None),
        ("LinkedIn", p and p.linkedin_url),
        ("GitHub", p and p.github_url),
        ("Portfolio", p and p.portfolio_url),
        ("Authorized to work", tri(p and p.authorized_to_work)),
        ("Needs visa sponsorship", tri(p and p.requires_sponsorship)),
        ("Willing to relocate", tri(p and p.willing_to_relocate)),
        ("Desired salary (USD/yr)", p and p.desired_salary),
        ("Earliest start / notice", p and p.notice_period),
    ]
    lines = [f"- {k}: {v}" for k, v in pairs if v not in (None, "")]
    if answers:
        lines.append("\nPreviously answered application questions:")
        lines += [f'- "{a.question_text}" -> {a.answer}' for a in answers]
    if told:
        lines.append(
            "\nThings I told Claude that my résumé doesn't say (true, use them):"
        )
        lines += [f'- "{f.question}" -> {f.answer}' for f in told]
    text = resume.extracted_text if resume else None
    if text and text.strip():
        lines.append(
            "\nRésumé (source of truth — job titles, employers, dates, "
            "education, skills):"
        )
        lines.append(text.strip())
    return "\n".join(lines) or "(no profile or résumé saved yet)"
