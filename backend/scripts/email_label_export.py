"""Phase 6 labeling export — real mailbox, read-only, resumable.

Reads the connected inbox + spam over IMAP (EXAMINE + BODY.PEEK only: nothing
is marked read, moved or deleted) and writes a seeded label sheet of about 500
rows — 350 emails the header filter kept and 150 it dropped — to
backend/email_exports/ (git-ignored; anything else is refused). Saved jobs and
the encrypted app password come from a LOCAL database (127.0.0.1 / localhost
only, opened read-only), never production.

Progress is saved after every batch in ``<name>.state.json``; if the
connection drops it retries, and if the script is stopped, running the same
command again resumes where it left off. It prints counts only — never email
contents, addresses or saved jobs.

Usage (from backend/):
    .venv/Scripts/python scripts/email_label_export.py --key-env ../../job_enhancer/backend/.env
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
# Settings need these to import; this script never uses them.
for _k, _v in {
    "SUPABASE_URL": "https://local.invalid",
    "NVIDIA_API_KEY": "unused",
    "ADZUNA_APP_ID": "unused",
    "ADZUNA_APP_KEY": "unused",
    "JSEARCH_API_KEY": "unused",
    "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
}.items():
    os.environ.setdefault(_k, _v)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402
from app.models.email_account import EmailAccount  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.email_prefilter import company_tokens  # noqa: E402
from app.services.email_scan import _candidate_jobs  # noqa: E402
from app.utils import crypto  # noqa: E402
from evals.email_export import (  # noqa: E402
    ExportRefused,
    ensure_git_ignored,
    jobs_path_for,
    write_jobs_file,
)
from evals.email_label_export import (  # noqa: E402
    DEFAULT_SEED,
    N_LIKELY,
    N_OTHER,
    ExportFailed,
    Mailbox,
    run_export,
    state_path_for,
)

EXPORT_DIR = Path(__file__).resolve().parent.parent / "email_exports"
LOCAL_DB = "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/postgres"


def _read_key(env_file: Path) -> str:
    """MAIL_ENC_KEY from an env file — read, never printed."""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        name, _, value = line.partition("=")
        if name.strip() == "MAIL_ENC_KEY":
            return value.strip().strip('"').strip("'")
    raise SystemExit(f"MAIL_ENC_KEY not found in {env_file}")


async def _load(db_url: str, user_email: str | None):
    host = urlsplit(db_url.replace("+asyncpg", "")).hostname
    if host not in ("127.0.0.1", "localhost"):
        raise SystemExit("refusing a non-local database: use the local copy")
    engine = create_async_engine(
        db_url,
        connect_args={
            "prepared_statement_cache_size": 0,
            "server_settings": {"default_transaction_read_only": "on"},
        },
    )
    try:
        async with async_sessionmaker(engine)() as db:
            # Only columns that exist on every schema revision.
            stmt = select(
                EmailAccount.user_id,
                EmailAccount.email_address,
                EmailAccount.imap_host,
                EmailAccount.imap_port,
                EmailAccount.secret_encrypted,
            )
            if user_email:
                stmt = stmt.join(User, User.id == EmailAccount.user_id).where(
                    User.email == user_email
                )
            account = (await db.execute(stmt.limit(1))).first()
            if account is None:
                raise SystemExit("no connected email account in that database")
            jobs = await _candidate_jobs(db, account.user_id)
    finally:
        await engine.dispose()
    return account, jobs


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--key-env", type=Path, required=True, help="env file with MAIL_ENC_KEY"
    )
    ap.add_argument("--db", default=LOCAL_DB, help="LOCAL database URL (read-only)")
    ap.add_argument("--user", default=None, help="account owner's email, if several")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--days", type=int, default=45)
    ap.add_argument("--likely", type=int, default=N_LIKELY)
    ap.add_argument("--other", type=int, default=N_OTHER)
    ap.add_argument(
        "--rebuild",
        action="store_true",
        help="re-read the same selected rows (keeps the selection, refetches bodies)",
    )
    args = ap.parse_args()

    out = (args.out or EXPORT_DIR / f"phase6-labels-seed{args.seed}.csv").resolve()
    try:  # before touching the mailbox: never fetch mail for a tracked path
        ensure_git_ignored(out, jobs_path_for(out), state_path_for(out))
    except ExportRefused as exc:
        raise SystemExit(f"EXPORT REFUSED: {exc}") from None

    settings.mail_enc_key = _read_key(args.key_env)
    account, jobs = asyncio.run(_load(args.db, args.user))
    print(f"saved jobs (local database): {len(jobs)}")
    write_jobs_file(jobs, jobs_path_for(out))
    box = Mailbox(
        account.imap_host,
        account.imap_port,
        account.email_address,
        crypto.decrypt(account.secret_encrypted),
    )
    try:
        summary = run_export(
            box,
            jobs,
            company_tokens([j["company"] for j in jobs]),
            out,
            seed=args.seed,
            days=args.days,
            n_likely=args.likely,
            n_other=args.other,
            rebuild=args.rebuild,
        )
    except ExportFailed as exc:
        raise SystemExit(
            f"export stopped: {exc} — run the same command to resume"
        ) from None
    print(json.dumps(summary, indent=2))
    print(
        f"sheet   : {out.name}\njob keys: {jobs_path_for(out).name}\n(in {out.parent})"
    )


if __name__ == "__main__":
    main()
