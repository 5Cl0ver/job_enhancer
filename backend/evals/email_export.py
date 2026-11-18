"""Write real scanned emails to a local CSV for hand-labeling.

The export contains real mail, so it only ever goes to a path git ignores
(``ensure_git_ignored`` refuses anything else). Each row has the current
prediction plus blank ``correct_label`` / ``correct_job`` columns for the user;
a companion ``-jobs`` file maps the short job keys to saved jobs. Two groups:
``likely_job`` (every email the header filter kept) and ``sample_other`` (a
random sample of what it dropped, to measure what the filter misses).
``folder``, ``uidvalidity`` and ``uid`` let a later scoring run re-fetch the
same messages instead of keeping raw mail on disk.
"""

from __future__ import annotations

import csv
import hashlib
import subprocess
from pathlib import Path

from app.services.email_scan import EmailMessage
from evals.email_pipeline import EVENT_LABELS, excerpt, predict_message

EXPORT_COLUMNS = [
    "id",
    "group",  # likely_job | sample_other
    "folder",
    "uidvalidity",
    "uid",
    "date",
    "sender",
    "subject",
    "excerpt",
    "filter_reason",
    "read_issues",
    "predicted_event",
    "predicted_job",
    "correct_label",
    "correct_job",
    "notes",
]
LABEL_HELP = (
    f"correct_label: one of {', '.join(EVENT_LABELS)}. "
    "correct_job: a job_key from the -jobs file, or 'none'."
)


class ExportRefused(Exception):
    """The target path is not git-ignored, so real mail could be committed."""


def jobs_path_for(path: Path) -> Path:
    return path.with_name(f"{path.stem}-jobs{path.suffix}")


def ensure_git_ignored(*paths: Path) -> None:
    """Raise unless git confirms every path is ignored (and so never tracked)."""
    for p in paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            res = subprocess.run(
                ["git", "check-ignore", "-q", "--", p.name],
                cwd=p.parent,
                capture_output=True,
            )
        except OSError as exc:
            raise ExportRefused(f"git unavailable, can't verify {p}: {exc}") from exc
        if res.returncode != 0:
            raise ExportRefused(
                f"{p} is not git-ignored; write exports under backend/email_exports/"
            )


def _cell(value: str) -> str:
    """Neutralize spreadsheet formulas — email text is untrusted input."""
    value = (value or "").replace("\r", " ").replace("\n", " ")
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t") else value


def _row_id(msg: EmailMessage) -> str:
    key = "|".join([msg.folder, str(msg.uidvalidity), msg.uid, msg.message_id]).encode()
    return hashlib.sha256(key).hexdigest()[:12]


def job_keys(jobs: list[dict]) -> dict[str, str]:
    """Stable short keys (J01, J02…) for saved jobs, ordered by company/title."""
    ordered = sorted(jobs, key=lambda j: ((j["company"] or "").lower(), j["title"]))
    return {str(j["id"]): f"J{i:02d}" for i, j in enumerate(ordered, 1)}


LIKELY_JOB = "likely_job"  # everything the header filter kept
SAMPLE_OTHER = "sample_other"  # random sample of what it dropped


def write_jobs_file(jobs: list[dict], path: Path) -> dict[str, str]:
    """Write the job-key file (J01 → company, title); return the keys."""
    keys = job_keys(jobs)
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig so Excel opens accented names correctly.
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["job_key", "company", "title", "saved_job_id"])
        for j in sorted(jobs, key=lambda j: keys[str(j["id"])]):
            w.writerow(
                [keys[str(j["id"])], _cell(j["company"]), _cell(j["title"]), j["id"]]
            )
    return keys


def write_label_export(
    rows: list[tuple[EmailMessage, str, str]],
    jobs: list[dict],
    path: Path,
) -> dict[str, int]:
    """Write the label sheet + its jobs file from ``(message, group,
    filter_reason)`` rows; return the row count per group."""
    keys = write_jobs_file(jobs, jobs_path_for(path))
    counts: dict[str, int] = {}
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(EXPORT_COLUMNS)
        for msg, group, reason in rows:
            counts[group] = counts.get(group, 0) + 1
            p = predict_message(msg, jobs)
            w.writerow(
                [
                    _row_id(msg),
                    group,
                    _cell(msg.folder),
                    msg.uidvalidity if msg.uidvalidity is not None else "",
                    msg.uid,
                    msg.date.isoformat() if msg.date else "",
                    _cell(msg.from_addr),
                    _cell(msg.subject),
                    _cell(excerpt(msg.body)),
                    reason,
                    " ".join(msg.read_issues),
                    p.event,
                    keys.get(str(p.job_id), "") if p.job_id else "",
                    "",
                    "",
                    "",
                ]
            )
    return counts
