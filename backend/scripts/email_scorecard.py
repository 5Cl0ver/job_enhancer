"""Score the email pipeline on the seeded synthetic corpus.

Offline and read-only: no database, no network, no real mail. The numbers show
how the current rules handle known synthetic cases — they are NOT real-world
accuracy (that needs the hand-labeled export from email_scan_debug.py).

Usage (from backend/):
    .venv/Scripts/python scripts/email_scorecard.py                 # dev + holdout + all
    .venv/Scripts/python scripts/email_scorecard.py --split holdout
    .venv/Scripts/python scripts/email_scorecard.py --seed 7 --n 2000
"""

import argparse
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from evals.email_pipeline import predict_raw  # noqa: E402
from evals.email_scorecard import Scored, format_scorecard, score  # noqa: E402
from evals.email_synthetic import (  # noqa: E402
    DEFAULT_N,
    DEFAULT_SEED,
    SyntheticEmail,
    generate,
    saved_jobs_as_dicts,
    split,
)


def score_synthetic(
    emails: list[SyntheticEmail], *, header_filter: bool = False
) -> list[Scored]:
    jobs = saved_jobs_as_dicts()
    rows = []
    for e in emails:
        p = predict_raw(e.id, e.raw, jobs, header_filter=header_filter)
        rows.append(
            Scored(
                id=e.id,
                template_id=e.template_id,
                expected_event=e.expected_event,
                expected_job=e.expected_job,
                predicted_event=p.event,
                predicted_job=p.job_id,
                surfaced=p.surfaced,
                body_blank=p.body_blank,
                expected_action=e.expected_action,
                predicted_action=p.action,
                read_issues=p.read_issues,
                filtered=p.filtered,
                filter_reason=p.filter_reason,
                match_status=p.match_status,
                match_evidence=p.match_evidence,
            )
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--n", type=int, default=DEFAULT_N)
    parser.add_argument(
        "--split", choices=["dev", "holdout", "all", "every"], default="every"
    )
    parser.add_argument("--templates", type=int, default=12, help="worst-N to list")
    parser.add_argument(
        "--filter",
        choices=["off", "on", "both"],
        default="both",
        help="apply the scan's header filter before classifying",
    )
    args = parser.parse_args()

    emails = generate(n=args.n, seed=args.seed)
    dev, holdout = split(emails, seed=args.seed)
    sets = {"dev": dev, "holdout": holdout, "all": emails}
    chosen = list(sets) if args.split == "every" else [args.split]

    print("SYNTHETIC scorecard — known cases only, not real-world accuracy.")
    print(f"seed={args.seed}  n={args.n}  (split by template family)\n")
    modes = {"off": [False], "on": [True], "both": [False, True]}[args.filter]
    for name in chosen:
        for use in modes:
            card = score(score_synthetic(sets[name], header_filter=use))
            label = f"{name}, header filter {'ON' if use else 'OFF'}"
            print(format_scorecard(card, title=label, templates=args.templates))
            print()


if __name__ == "__main__":
    main()
