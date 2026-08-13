"""Seed the development database with sample job listings.

Usage (from backend/, with .env pointing at your DEV Supabase project):
    .venv/bin/python scripts/seed_dev.py

Idempotent: existing listings (by content hash) are skipped.
"""

import asyncio
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.job_listing import JobListing  # noqa: E402
from app.services.dedup import job_content_hash, normalize  # noqa: E402

SAMPLE_JOBS = [
    (
        "Senior Python Developer",
        "Stripe",
        "New York, NY",
        False,
        150000,
        200000,
        "FULLTIME",
    ),
    ("Frontend Engineer (React)", "Linear", "Remote", True, 120000, 170000, "FULLTIME"),
    (
        "Full-Stack Developer",
        "Shopify",
        "Toronto, ON",
        True,
        100000,
        140000,
        "FULLTIME",
    ),
    ("Junior Data Analyst", "Spotify", "Boston, MA", False, 65000, 85000, "FULLTIME"),
    (
        "Staff Software Engineer",
        "Datadog",
        "New York, NY",
        False,
        190000,
        250000,
        "FULLTIME",
    ),
    (
        "Backend Engineer (Go)",
        "Cloudflare",
        "Austin, TX",
        True,
        130000,
        175000,
        "FULLTIME",
    ),
    (
        "Machine Learning Intern",
        "Hugging Face",
        "Remote",
        True,
        None,
        None,
        "INTERNSHIP",
    ),
    ("DevOps Engineer", "GitLab", "Remote", True, 110000, 160000, "CONTRACT"),
]


async def seed() -> None:
    created = 0
    async with AsyncSessionLocal() as db:
        for i, (title, company, location, remote, smin, smax, jtype) in enumerate(
            SAMPLE_JOBS
        ):
            tn, cn, ln = normalize(title), normalize(company), normalize(location)
            content_hash = job_content_hash(tn, cn, ln)

            exists = await db.scalar(
                select(JobListing.id).where(JobListing.content_hash == content_hash)
            )
            if exists:
                continue

            db.add(
                JobListing(
                    id=uuid.uuid4(),
                    external_id=f"seed_{i}",
                    source="manual",
                    title=title,
                    company=company,
                    location=location,
                    is_remote=remote,
                    description=f"Sample listing for local development: {title} at {company}.",
                    salary_min=smin,
                    salary_max=smax,
                    currency="USD",
                    job_type=jtype,
                    apply_url=f"https://example.com/jobs/{i}",
                    posted_at=datetime.now(UTC) - timedelta(days=i),
                    content_hash=content_hash,
                    title_normalized=tn,
                    company_normalized=cn,
                )
            )
            created += 1
        await db.commit()
    print(
        f"Seeded {created} sample listing(s) ({len(SAMPLE_JOBS) - created} already present)."
    )


if __name__ == "__main__":
    asyncio.run(seed())
