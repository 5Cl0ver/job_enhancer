"""Diagnostic dry-run of the email scanner — see EXACTLY what it decides.

Connects to a user's mailbox read-only and runs the same sync a scan does
(inbox + spam, headers first, bodies only for possible job emails) over the
last ``--days`` days, then prints the reasoning for each kept email —
classification, sender company, matched saved job, and whether a real scan
would create an event. It starts from empty cursors and saves none, writes
NOTHING to the database and moves NO cards.

Usage (from backend/, with .env pointing at your Supabase project):
    .venv/Scripts/python scripts/email_scan_debug.py                # first/only connected inbox
    .venv/Scripts/python scripts/email_scan_debug.py --user you@x.com
    .venv/Scripts/python scripts/email_scan_debug.py --limit 60     # at most 60 body downloads
    .venv/Scripts/python scripts/email_scan_debug.py --export --days 45

--export writes a label sheet to backend/email_exports/ (git-ignored) covering
inbox and spam for the window, in two groups: ``likely_job`` (every email the
header filter kept) and ``sample_other`` (a seeded random sample, default 150,
of what it dropped). Rows carry sender, subject, a short cleaned excerpt, the
filter reason, read issues, the current prediction, and blank
correct_label/correct_job columns. It refuses any path git would track, and in
export mode prints only counts and file paths — never email contents, the
address, or saved jobs.
"""

import argparse
import asyncio
import logging
import re
import sys
from datetime import datetime
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
from app.services import email_imap, email_sync  # noqa: E402
from app.services.email_classify import (  # noqa: E402
    UNKNOWN,
    classify,
    company_from_sender,
)
from app.services.email_match import sender_is_saved_company  # noqa: E402
from app.services.email_prefilter import company_tokens  # noqa: E402
from app.services.email_scan import (  # noqa: E402
    EmailMessage,
    _candidate_jobs,
    detect_events,
)
from app.utils import crypto  # noqa: E402
from evals.email_export import (  # noqa: E402
    LABEL_HELP,
    LIKELY_JOB,
    SAMPLE_OTHER,
    ExportRefused,
    ensure_git_ignored,
    jobs_path_for,
    write_label_export,
)

EXPORT_DIR = Path(__file__).resolve().parent.parent / "email_exports"

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


async def main(
    user_email: str | None,
    limit: int | None,
    demo: bool,
    days: int,
    export: Path | None = None,
    sample: int = 150,
    seed: int = 1337,
) -> None:
    quiet = export is not None  # export mode prints counts and paths only
    if export is not None:
        # Check BEFORE touching the mailbox, so real mail is never fetched for an
        # export that would land somewhere git tracks.
        try:
            ensure_git_ignored(export, jobs_path_for(export))
        except ExportRefused as exc:
            print(_c(f"EXPORT REFUSED: {exc}", RED))
            return
    async with AsyncSessionLocal() as db:
        # 1. Find the connected inbox.
        # Only the columns this read-only tool needs, so it also runs against a
        # database that hasn't had the latest migration applied.
        stmt = select(
            EmailAccount.id,
            EmailAccount.user_id,
            EmailAccount.email_address,
            EmailAccount.provider,
            EmailAccount.imap_host,
            EmailAccount.imap_port,
            EmailAccount.secret_encrypted,
            EmailAccount.status,
        )
        if user_email:
            stmt = stmt.join(User, User.id == EmailAccount.user_id).where(
                User.email == user_email
            )
        account = (await db.execute(stmt.limit(1))).first()
        if account is None:
            print(_c("No connected email account found.", RED))
            print("Connect one in Settings → Connect Email first.")
            return

        print(_c("\n=== CONNECTION ===", BOLD))
        if not quiet:
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
        for j in [] if quiet else jobs:
            print(f"  • {j['company']}  —  {j['title']}")

        # 3. Read-only sync over inbox + spam: empty cursors, nothing saved.
        cap = "no cap" if limit is None else f"up to {limit} bodies"
        print(_c(f"\n=== SYNCING last {days} days, inbox + spam ({cap})… ===", BOLD))
        password = crypto.decrypt(account.secret_encrypted)
        opts = email_sync.SyncOptions(
            backfill_days=days,
            body_cap=limit,
            time_budget_s=None,
            recheck_days=0,
            saved_companies=company_tokens([j["company"] for j in jobs]),
            sample_filtered=sample if export is not None else 0,
            seed=seed,
        )
        try:
            result = await email_sync.sync_mailbox(
                account.imap_host,
                account.imap_port,
                account.email_address,
                password,
                {},
                opts,
            )
        except email_imap.ImapAuthError as exc:
            print(_c(f"  LOGIN FAILED: {exc}", RED))
            print("  Your app password is wrong or expired. Reconnect in Settings.")
            return
        except Exception as exc:  # noqa: BLE001
            print(_c(f"  COULD NOT REACH MAIL SERVER: {type(exc).__name__}", RED))
            return

        messages = result.messages
        for r in result.reports:
            flags = ", ".join(
                [*r.partial]
                + (["view_limited"] if r.view_limited else [])
                + (["uidvalidity_changed"] if r.uidvalidity_changed else [])
            )
            print(
                f"  {r.folder_role:<6}: {r.visible} visible, {r.headers_read} headers, "
                f"{r.filtered_out} filtered out, {r.kept} kept, "
                f"{r.bodies_fetched} bodies, {r.out_of_window} outside window, "
                f"{r.carried_over} not reached, status {r.status}"
                + (f" [{flags}]" if flags else "")
            )
        if result.interrupted:
            print(_c(f"  STOPPED EARLY: {result.interrupted}", YELLOW))
        print(f"  read {len(messages)} likely job emails")
        rs = email_imap.read_stats(messages)
        print(
            f"  read: {rs.failed} failed, {rs.blank} blank "
            f"({rs.blank_unexplained} unexplained), {rs.charset_fallback} charset "
            f"fallback, {rs.quote_fallback} quote fallback, {rs.html_converted} "
            f"from HTML, {rs.hidden_removed} with hidden text removed"
        )

        if export is not None:
            rows = [
                (m, LIKELY_JOB, result.keep_reasons.get((m.folder, m.uid), ""))
                for m in messages
            ] + [(m, SAMPLE_OTHER, reason) for m, reason in result.sampled_other]
            counts = write_label_export(rows, jobs, export)
            print(_c("\n=== EXPORT ===", BOLD))
            print(
                f"  wrote {sum(counts.values())} rows "
                f"({counts.get(LIKELY_JOB, 0)} {LIKELY_JOB}, "
                f"{counts.get(SAMPLE_OTHER, 0)} {SAMPLE_OTHER}) : {export}"
            )
            print(f"  job keys      : {jobs_path_for(export)}")
            print(f"  {LABEL_HELP}")
            print(_c("  (git-ignored; nothing written to the database)\n", DIM))
            return

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

        # 4. The REAL scan decision (detect_events), in a transaction that is
        # always rolled back: what a scan would store, and why (spec 027). It
        # skips emails already stored, exactly like a scan.
        detected = await detect_events(db, account, messages)
        stored = {}
        for ev in [
            *detected.created,
            *detected.review,
            *detected.hidden,
            *detected.unsaved,
            *detected.contacts,
            *detected.noted,
            *detected.looked_at,
        ]:
            stored[(ev.folder, ev.message_uid)] = ev
        await db.rollback()
        known = 0
        for i, msg in enumerate(messages, 1):
            tag = _c(" [DEMO]", CYAN) if msg.uid.startswith("demo-") else ""
            ev = stored.get((msg.folder, msg.uid))
            subj = (msg.subject or "(no subject)")[:70]
            if ev is None:
                event = classify(
                    msg.subject,
                    msg.classify_text,
                    msg.from_addr,
                    bulk=msg.list_mail,
                    job_sender=sender_is_saved_company(
                        jobs, msg.from_addr, msg.reply_to
                    ),
                ).event
                if event == UNKNOWN:
                    continue  # spam: a scan never stores it
                known += 1
                continue  # already stored by an earlier scan
            print(f"{_c(f'[{i}]', DIM)}{tag} {_c(subj, CYAN)}")
            print(f"     from      : {msg.from_addr[:70]}")
            print(
                f"     sender co.: {company_from_sender(msg.from_addr) or '(relay/unknown)'}"
            )
            colour = GREEN if ev.status in ("pending", "noted") else YELLOW
            what = {
                "pending": f"waits for you: move to {ev.target_stage}",
                "noted": f"kept on the job, no move needed ({ev.target_stage})",
                "needs_review": "asks you which job",
                "hidden": "kept, hidden (unclear)",
                "unsaved": "important, but not one of your saved jobs",
                "contact": "a recruiter reaching out",
                "skipped": f"looked at, not shown ({ev.skip_reason})",
            }.get(ev.status, ev.status)
            print(f"     type      : {ev.event_type}  (evidence: {ev.match_evidence})")
            print(f"     result    : {_c(what, colour)}")
            print()

        print(_c("=== SUMMARY ===", BOLD))
        print(f"  messages read         : {len(messages)}")
        print(f"  saved-job candidates  : {len(jobs)}")
        print(f"  already stored        : {known}")
        print(
            f"  a real scan would store: {len(detected.created)} waiting, "
            f"{len(detected.noted)} kept on jobs, {len(detected.review)} questions, "
            f"{len(detected.looked_at)} looked at, {len(detected.hidden)} hidden, "
            f"{len(detected.contacts)} contacts, {len(detected.unsaved)} unsaved"
        )
        print(_c("  (dry run — rolled back: nothing written, no cards moved)\n", DIM))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Dry-run the email scanner.")
    parser.add_argument("--user", help="Filter to this user's email", default=None)
    parser.add_argument(
        "--limit", type=int, default=None, help="Max body downloads (default: no cap)"
    )
    parser.add_argument(
        "--days", type=int, default=45, help="Window: mail from the last N days"
    )
    parser.add_argument(
        "--sample", type=int, default=150, help="Export: size of the sample_other group"
    )
    parser.add_argument("--seed", type=int, default=1337, help="Export: sample seed")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Inject synthetic application emails from your saved jobs",
    )
    parser.add_argument(
        "--export",
        nargs="?",
        const="",
        default=None,
        metavar="PATH",
        help="Write a label sheet (default: email_exports/labels-<date>-<time>.csv)",
    )
    args = parser.parse_args()
    export = None
    if args.export is not None:
        if args.demo:
            parser.error("--export can't be combined with --demo")
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
        export = Path(args.export or EXPORT_DIR / f"labels-{stamp}.csv")
        export = export.resolve()
    asyncio.run(
        main(
            args.user, args.limit, args.demo, args.days, export, args.sample, args.seed
        )
    )
