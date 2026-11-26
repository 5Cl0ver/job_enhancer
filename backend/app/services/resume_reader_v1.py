"""The job section as the reader read it before spec 029 (frozen, never changed).

Only used to tell whether a résumé's stored jobs are still exactly what this
old reader made, i.e. the user never edited them. Such jobs carry the old
reader's broken PDF lines and are read again once with today's reader
(``resume_history.upgrade``). Jobs the user edited never match and are left
alone.
"""

import re

from app.services.resume_reader import (
    _PLACE,
    MAX_TEXT,
    _dates,
    _job_from,
    _join_split_dates,
    _pieces,
    _sections,
)

_BULLET = re.compile(r"^\s*(?:[-•*▪◦●·‣–]|\d+\.)\s+")


def work(text: str) -> list[dict]:
    """The jobs the pre-029 reader found in a résumé's text."""
    if not text or not text.strip():
        return []
    lines = _join_split_dates(_sections(text[:MAX_TEXT]).get("work", []))
    jobs: list[dict] = []
    pending: list[str] = []
    in_bullets = False
    for line in lines:
        if _BULLET.match(line):
            if jobs:
                text = _BULLET.sub("", line)
                desc = jobs[-1]["description"]
                jobs[-1]["description"] = (f"{desc}\n{text}" if desc else text)[:2000]
                in_bullets = True
            pending.clear()
            continue
        dates = _dates(line)
        if dates:
            a, b = dates["span"]
            head = (line[:a] + " " + line[b:]).strip(" |·•,–—-\t")
            candidates = _pieces(head)
            named = lambda c: [x for x in c if not _PLACE.match(x)]  # noqa: E731
            for prev in reversed(pending[-2:]):
                if len(named(candidates)) >= 2:
                    break
                candidates = _pieces(prev) + candidates
            job = _job_from(candidates, dates)
            if job:
                jobs.append(job)
            pending.clear()
            in_bullets = False
            continue
        if jobs and in_bullets and line[:1].islower():
            jobs[-1]["description"] = (jobs[-1]["description"] + " " + line)[:2000]
            continue
        if jobs and len(line) > 70:
            desc = jobs[-1]["description"]
            jobs[-1]["description"] = (f"{desc}\n{line}" if desc else line)[:2000]
            in_bullets = True
            continue
        in_bullets = False
        pending.append(line)
        if len(pending) > 2:
            pending.pop(0)
    return jobs[:12]
