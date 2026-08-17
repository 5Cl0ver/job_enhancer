"""Diagnostic dry-run of the email scanner — see EXACTLY what it decides.

Connects to a user's mailbox (read-only, exactly like a real scan), fetches
recent messages, and prints the full reasoning for each one — classification,
who it thinks the sender is, which saved job it matched (and the score), and
whether a real scan would create an event. It writes NOTHING to the database and
moves NO cards: a safe way to build trust and tune the rules.

Usage (from backend/, with .env pointing at your Supabase project):
    .venv/Scripts/python scripts/email_scan_debug.py                # first/only connected inbox
    .venv/Scripts/python scripts/email_scan_debug.py --user you@x.com
    .venv/Scripts/python scripts/email_scan_debug.py --limit 60     # scan more messages
"""

import argparse
import asyncio
import logging
import re
import sys
from pathlib import Path

# Windows terminals default to cp1252 and choke on emojis in email subjects;
# force UTF-8 and replace anything unprintable rather than crash.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# Quiet the SQL echo so the diagnostic output is readable.
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.email_account import EmailAccount  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import email_imap  # noqa: E402
from app.services.email_classify import (  # noqa: E402
    UNKNOWN,
    classify_email,
    company_from_sender,
    match_email_to_job,
    stage_for_event,
)
from app.services.email_scan import EmailMessage, _candidate_jobs  # noqa: E402
from app.utils import crypto  # noqa: E402

# ANSI colors — muted so the output stays readable in any terminal.
DIM = "\033[2m"
BOLD = "\033[1m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
RESET = "\033[0m"


def _c(text: str, color: str) -> str:
    return f"{color}{text}{RESET}"


# Synthetic "real application response" templates, filled from your saved jobs.
_DEMO_TEMPLATES = [
    (
        "Update on your application to {company}",
        "Thank you for applying. Unfortunately, we have decided to move forward "
        "with other candidates at this time.",
    ),
    (
        "Interview with {company} — {title}",
        "We'd like to schedule a call to discuss the {title} role. What's your "
        "availability next week?",
    ),
    (
        "We received your application — {company}",
        "Thank you for applying to the {title} position. Your application has "
        "been received and is under review.",
    ),
]


def _demo_messages(jobs: list[dict]) -> list[EmailMessage]:
    """Build fake application emails from your real saved companies, so you can
    watch the classify+match logic work without waiting for a real email."""
    demos: list[EmailMessage] = []
    for idx, job in enumerate(jobs[: len(_DEMO_TEMPLATES)]):
        subj_t, body_t = _DEMO_TEMPLATES[idx]
        company, title = job["company"], job["title"]
        domain = re.sub(r"[^a-z0-9]", "", company.lower())[:18] or "company"
        demos.append(
            EmailMessage(
                uid=f"demo-{idx}",
                from_addr=f"careers@{domain}.com",
                subject=subj_t.format(company=company, title=title),
                body=body_t.format(company=company, title=title),
            )
        )
    return demos


async def main(user_email: str | None, limit: int, demo: bool) -> None:
    async with AsyncSessionLocal() as db:
        # 1. Find the connected inbox.
        stmt = select(EmailAccount)
        if user_email:
            stmt = stmt.join(User, User.id == EmailAccount.user_id).where(
                User.email == user_email
            )
        account = await db.scalar(stmt)
        if account is None:
            print(_c("No connected email account found.", RED))
            print("Connect one in Settings → Connect Email first.")
            return

        print(_c("\n=== CONNECTION ===", BOLD))
        print(f"  inbox     : {account.email_address}")
        print(f"  provider  : {account.provider}")
        print(f"  imap      : {account.imap_host}:{account.imap_port}")
        print(f"  status    : {account.status}")

        # 2. Show the saved jobs the matcher can match against. This is usually
        #    why a scan "finds nothing" — the email must match a job you SAVED.
        jobs = await _candidate_jobs(db, account.user_id)
        print(_c(f"\n=== SAVED JOBS (match candidates): {len(jobs)} ===", BOLD))
        if not jobs:
            print(
                _c(
                    "  You have no active saved jobs — so NOTHING can match. "
                    "Save the jobs you applied to, then rescan.",
                    YELLOW,
                )
            )
        for j in jobs:
            print(f"  • {j['company']}  —  {j['title']}")

        # 3. Fetch the inbox (read-only), exactly like a real scan.
        print(_c(f"\n=== FETCHING last {limit} messages… ===", BOLD))
        password = crypto.decrypt(account.secret_encrypted)
        try:
            messages = await email_imap.fetch_recent(
                account.imap_host,
                account.imap_port,
                account.email_address,
                password,
                limit=limit,
            )
        except email_imap.ImapAuthError as exc:
            print(_c(f"  LOGIN FAILED: {exc}", RED))
            print("  Your app password is wrong or expired. Reconnect in Settings.")
            return
        except Exception as exc:  # noqa: BLE001
            print(_c(f"  COULD NOT REACH MAIL SERVER: {exc!r}", RED))
            return

        print(f"  fetched {len(messages)} messages")

        # Optionally prepend synthetic application emails built from real saved
        # jobs, so the happy path is visible even with a spam-only inbox.
        if demo:
            demos = _demo_messages(jobs)
            messages = demos + messages
            print(
                _c(
                    f"  + {len(demos)} DEMO emails injected (synthetic, from your "
                    "saved companies)",
                    CYAN,
                )
            )
        print()

        # 4. Run each message through the real classify + match logic and explain.
        would_create = 0
        for i, msg in enumerate(messages, 1):
            tag = _c(" [DEMO]", CYAN) if msg.uid.startswith("demo-") else ""
            event = classify_email(msg.subject, msg.body, msg.from_addr)
            hint = company_from_sender(msg.from_addr)
            match = (
                None
                if event == UNKNOWN
                else match_email_to_job(jobs, company_hint=hint, subject=msg.subject)
            )

            subj = (msg.subject or "(no subject)")[:70]
            print(f"{_c(f'[{i}]', DIM)}{tag} {_c(subj, CYAN)}")
            print(f"     from      : {msg.from_addr[:70]}")
            print(f"     sender co.: {hint or '(relay/unknown)'}")

            if event == UNKNOWN:
                print(f"     verdict   : {_c('UNKNOWN', DIM)} — no job signal, skipped")
            elif not match:
                print(
                    f"     classify  : {_c(event.upper(), YELLOW)} "
                    f"→ would move to {stage_for_event(event)}"
                )
                print(
                    f"     match     : {_c('NONE', YELLOW)} "
                    "— no saved job cleared the confidence bar, skipped"
                )
            else:
                would_create += 1
                print(
                    f"     classify  : {_c(event.upper(), GREEN)} "
                    f"→ move to {stage_for_event(event)}"
                )
                print(
                    f"     match     : {_c(match['company'] + ' / ' + match['title'], GREEN)}"
                )
                print(f"     result    : {_c('WOULD CREATE a pending update', GREEN)}")
            print()

        print(_c("=== SUMMARY ===", BOLD))
        print(f"  messages scanned      : {len(messages)}")
        print(f"  saved-job candidates  : {len(jobs)}")
        print(f"  updates a real scan   : {_c(str(would_create), GREEN)} would create")
        print(_c("  (dry run — nothing was written, no cards moved)\n", DIM))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dry-run the email scanner.")
    parser.add_argument("--user", help="Filter to this user's email", default=None)
    parser.add_argument("--limit", type=int, default=40, help="Messages to fetch")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Inject synthetic application emails from your saved jobs",
    )
    args = parser.parse_args()
    asyncio.run(main(args.user, args.limit, args.demo))
