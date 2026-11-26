"""A résumé read without AI (spec 020, R2).

The free AI model was retired on 2026-11-05 and every résumé reading failed
silently, so Job Catcher had no jobs or schools to fill. This reader turns a
résumé's text into the same shape the AI returns, from its section headings and
the usual ways a job line is written:

    Title | Company | Sep 2024 - Aug 2026
    Title · Company    Mar 2023 – Present
    Company — Title          (dates on the next line)

It's used when the AI is unavailable, and always for skills, certifications
and websites (they're plain lists). Only what's written is kept: a line it
can't place is left out, never guessed.
"""

import re

_MONTHS = {
    m: i + 1
    for i, names in enumerate(
        [
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ]
    )
    for m in names
}

_MONTH = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
    r"sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?"
)
# One end of a date range: "Sep 2024", "09/2024", "2024", "Present".
_POINT = rf"(?:{_MONTH}\s+\d{{4}}|\d{{1,2}}/\d{{4}}|\d{{4}}|present|current|now|today)"
_RANGE = re.compile(
    rf"(?P<start>{_POINT})\s*(?:-|–|—|to)\s*(?P<end>{_POINT})", re.IGNORECASE
)
_YEAR_ONLY = re.compile(r"\b(19|20)\d{2}\b")

# Section headings, by what they hold.
_HEADINGS = [
    (
        "work",
        r"(?:professional |work |relevant |employment |career )?(?:experience|history|"
        r"employment)(?: history)?",
    ),
    (
        "education_certs",
        r"certifications?\s*(?:&|and)\s*education|education\s*(?:&|"
        r"and)\s*certifications?",
    ),
    ("education", r"education(?:al background)?|academic background"),
    (
        "skills",
        r"(?:technical |core |key )?skills(?: (?:&|and) (?:tools|technologies|"
        r"abilities))?|skill bank|(?:core |key )?competencies|technologies|"
        r"areas of expertise|expertise",
    ),
    (
        "certifications",
        r"certifications?|licenses?(?: (?:&|and) certifications?)?|credentials",
    ),
    ("languages", r"languages?"),
    ("websites", r"links|websites?|online presence|portfolio|profiles?|social"),
    (
        "other",
        r"summary|profile|objective|projects?|awards?|volunteer(?:ing)?|interests|"
        r"references|publications",
    ),
]
_HEADING = [
    (kind, re.compile(rf"^\s*{pat}\s*:?\s*$", re.IGNORECASE)) for kind, pat in _HEADINGS
]
# "Skills: Python, SQL" — a heading and its content on one line.
_INLINE = re.compile(
    r"^\s*(skills|technical skills|core skills|certifications?|languages?)\s*:\s*(.+)$",
    re.IGNORECASE,
)

# A bullet: a dash or star with a space after it, a number ("2. "), or a bullet
# glyph, which a PDF often runs straight into its text ("•Built") or writes in
# a symbol font's private character (U+F0B7).
_BULLET = re.compile(r"^\s*(?:[•▪◦●‣∙⁃\uf0b7\uf0a7\uf076\uf0d8]\s*|[-*·–]\s+|\d+\.\s+)")
# A bullet glyph alone on its line: the text is on the next line.
_LONE_MARK = re.compile(r"^\s*[•▪◦●‣∙⁃\uf0b7\uf0a7\uf076\uf0d8*·–-]\s*$")
# Bounded on purpose (spec 020 security review): no unbounded runs, so a long
# line of "a-a-a-…" can't make the search slow.
_URL = re.compile(
    r"(?<![\w-])(?:https?://)?(?:www\.)?(?:linkedin\.com/in/[\w-]{1,100}|"
    r"github\.com/[\w-]{1,100}|[\w-]{1,100}\.(?:dev|io|me|com|net|org)/[\w/-]{0,100})",
    re.IGNORECASE,
)

# The reader only ever looks at this much (spec 020 security review): a résumé
# is a page or two, and every pattern runs on one short line at a time.
MAX_TEXT = 50_000
MAX_LINE = 400
YEARS = range(1950, 2101)


def _year(value: str) -> int | None:
    n = int(value)
    return n if n in YEARS else None


_SCHOOLISH = re.compile(
    r"\b(university|college|school|institute|academy|polytechnic|community college|"
    r"bootcamp)\b",
    re.IGNORECASE,
)
_DEGREE = re.compile(
    r"\b(associate(?:'s)?(?: of [a-z ]+)?|bachelor(?:'s)?(?: of [a-z ]+)?|"
    r"master(?:'s)?(?: of [a-z ]+)?|ph\.?d\.?|doctorate|a\.?a\.?s?\.?|a\.?s\.?|"
    r"b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|mba|diploma|certificate|ged)\b",
    re.IGNORECASE,
)
_SEPARATORS = re.compile(r"\s+(?:\||·|•|—|–|-|@|\bat\b)\s+|\s{3,}|\t+")


def _point(text: str) -> tuple[int | None, int | None, bool]:
    """(month, year, is_current) of one end of a range."""
    t = text.strip().lower().rstrip(".")
    if t in ("present", "current", "now", "today"):
        return None, None, True
    m = re.match(rf"({_MONTH})\s+(\d{{4}})", t, re.IGNORECASE)
    if m:
        return _MONTHS.get(m.group(1).lower().rstrip(".")), _year(m.group(2)), False
    m = re.match(r"(\d{1,2})/(\d{4})", t)
    if m:
        month = int(m.group(1))
        return (month if 1 <= month <= 12 else None), _year(m.group(2)), False
    m = re.match(r"(\d{4})", t)
    if m:
        return None, _year(m.group(1)), False
    return None, None, False


# A line starting like a sentence about work done ("Migrated …", "Led …",
# "Building …"): prose with years in it, not a job's header line.
_PROSE_START = re.compile(
    # (Company words that look like verbs — United, Advanced… — are names.)
    r"^(?!(?:united|limited|advanced|applied|integrated|linked|consolidated|"
    r"allied|associated|distinguished|wing|king|spring|ring)\b)"
    r"(?:led|ran|built|grew|cut|won|drove|owned|made|set up|helped|worked|"
    r"supported|managed|created|designed|developed|implemented|improved|reduced|"
    r"increased|launched|delivered|maintained|handled|trained|wrote|"
    r"[a-z]+ed|[a-z]+ing)\b",
    re.IGNORECASE,
)
_HAS_MONTH = re.compile(rf"{_MONTH}\s+\d{{4}}|\b\d{{1,2}}/\d{{4}}", re.IGNORECASE)
_HEAD_MARK = re.compile(r"\||·|•|—|–|@|\bat\b|,|\s{3,}|\t")


def _dates(line: str) -> dict | None:
    """A job's date range on this line, or None. Years alone ("2019 - 2021")
    count only on a short line that names something next to them — never a
    sentence, a shift ("0800-1700") or prose that mentions years."""
    m = _RANGE.search(line)
    if not m:
        return None
    sm, sy, _ = _point(m.group("start"))
    em, ey, current = _point(m.group("end"))
    if sy is None or (ey is None and not current):
        return None
    if not _HAS_MONTH.search(m.group(0)):
        trim = " |·•,–—-\t()"
        before = line[: m.start()].strip(trim)
        after = line[m.end() :].strip(trim)
        head = f"{before} {after}".strip()
        marked = bool(_HEAD_MARK.search(line[: m.start()]))
        # A dated header line: the years at one end, a few words naming the
        # job — never prose ("Managed migration of 2019-2020 records").
        header = (
            (not before or not after)
            and len(head.split()) <= 8
            and not head[:1].islower()
            and not _PROSE_START.match(head)
        )
        if head.endswith(".") or not (not head or marked or header):
            return None
    return {
        "start_month": sm,
        "start_year": sy,
        "end_month": None if current else em,
        "end_year": None if current else ey,
        "current": current,
        "span": m.span(),
    }


def _sections(text: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    kind = "top"
    for raw in text[:MAX_TEXT].splitlines():
        line = raw.strip()[:MAX_LINE]
        if not line:
            continue
        inline = _INLINE.match(line)
        if inline:
            word = inline.group(1).lower()
            key = (
                "skills"
                if "skill" in word
                else "certifications"
                if "cert" in word
                else "languages"
            )
            out.setdefault(key, []).append(inline.group(2))
            continue
        heading = next(
            (k for k, rx in _HEADING if len(line) <= 48 and rx.match(line)), None
        )
        if heading:
            kind = heading
            continue
        out.setdefault(kind, []).append(line)
    return out


def _tidy(part: str) -> str:
    """Trim spaces and commas, and a bracket left over from removed dates."""
    part = part.strip(" ,")
    while part.endswith("(") or (
        part.endswith(")") and part.count(")") > part.count("(")
    ):
        part = part[:-1].rstrip(" ,")
    while part.startswith(")") or (
        part.startswith("(") and part.count("(") > part.count(")")
    ):
        part = part[1:].lstrip(" ,")
    return part


def _split_head(head: str) -> list[str]:
    head = re.sub(r"\(\s*\)|\[\s*\]", " ", head)
    return [t for t in (_tidy(p) for p in _SEPARATORS.split(head) if p) if t]


_TITLE_WORDS = re.compile(
    r"\b(engineer|developer|analyst|manager|technician|specialist|administrator|admin|"
    r"assistant|associate|consultant|designer|lead|director|coordinator|intern|"
    r"officer|architect|support|representative|agent|scientist|clerk|supervisor|"
    r"programmer|tester|qa|owner|founder|president|executive|operator|advisor|"
    r"instructor|teacher|tutor|cashier|barista|server|sales|accountant|recruiter|"
    r"writer|editor)\b",
    re.IGNORECASE,
)
# "Salem, OR", "Portland, Oregon", "Remote", "Toronto, ON, Canada".
_STATES = (
    "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|"
    "Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|"
    "Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|"
    "Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|"
    "New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|"
    "Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|"
    "Virginia|Washington|West Virginia|Wisconsin|Wyoming|Ontario|Quebec|"
    "British Columbia|Alberta"
)
_PLACE = re.compile(
    rf"^(remote|hybrid|on-?site|[A-Z][A-Za-z .'-]+,\s*(?:[A-Z]{{2}}|"
    rf"{_STATES})(?:,\s*(?:USA|US|United States|Canada))?)$"
)
# "Brightfold Labs, Portland, OR": a company with its place on the end.
_WITH_PLACE = re.compile(r"^(?P<who>.+?),\s*(?P<place>[A-Z][A-Za-z .'-]+,\s*[A-Z]{2})$")


def _looks_like_title(text: str) -> bool:
    return bool(_TITLE_WORDS.search(text))


def _pieces(text: str) -> list[str]:
    """A head split into its parts: "Title, Company" splits on its comma when
    that isn't a place ("Salem, OR")."""
    parts = _split_head(text)
    if len(parts) == 1 and ", " in parts[0] and not _PLACE.match(parts[0]):
        m = _WITH_PLACE.match(parts[0])
        if m:
            return [m.group("who"), m.group("place")]
        first, rest = parts[0].split(", ", 1)
        if _looks_like_title(first) and not _looks_like_title(rest):
            return [first, rest]
    out: list[str] = []
    for part in parts:
        m = _WITH_PLACE.match(part)
        out += [m.group("who"), m.group("place")] if m else [part]
    return out


def _job_from(candidates: list[str], dates: dict) -> dict | None:
    candidates = [c for c in candidates if c]
    if not candidates:
        return None
    places = [c for c in candidates if _PLACE.match(c)]
    rest = [c for c in candidates if c not in places]
    if not rest:
        return None
    titled = [c for c in rest if _looks_like_title(c)]
    if titled and len(rest) > 1:
        title = titled[0]
        others = [c for c in rest if c is not title]
        # Two title-ish parts: the one written first is the title.
        if len(titled) > 1 and rest.index(titled[0]) > rest.index(titled[1]):
            title = titled[1]
            others = [c for c in rest if c is not title]
        company = others[0] if others else ""
    else:
        title, company = rest[0], (rest[1] if len(rest) > 1 else "")
    return {
        "title": title[:200],
        "company": company[:200],
        "location": (places[0] if places else "")[:200],
        "start_month": dates["start_month"],
        "start_year": dates["start_year"],
        "end_month": dates["end_month"],
        "end_year": dates["end_year"],
        "current": dates["current"],
        "description": "",
    }


# "Sep 2021 –" with "Jun 2023" on the next line: one range.
_LONE_START = re.compile(rf"^\s*{_POINT}\s*(?:-|–|—|to)?\s*$", re.IGNORECASE)
_LONE_END = re.compile(rf"^\s*(?:-|–|—|to)?\s*{_POINT}\s*$", re.IGNORECASE)
_OPEN_END = re.compile(rf"{_POINT}\s*(?:-|–|—|to)\s*$", re.IGNORECASE)


def _join_split_dates(lines: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if (
            i + 1 < len(lines)
            and _OPEN_END.search(line)
            and _LONE_END.match(lines[i + 1])
            and not _RANGE.search(line)
            and not _LONE_START.match(line)
        ):
            # "Engineer | Acme | Aug 2024 –" with "Present" on the next line.
            out.append(f"{line.rstrip()} {lines[i + 1].strip()}")
            i += 2
            continue
        if (
            i + 1 < len(lines)
            and _LONE_START.match(line)
            and _LONE_END.match(lines[i + 1])
            and not _RANGE.search(line)
        ):
            start = line.strip().rstrip("-–— ").removesuffix(" to").strip()
            end = re.sub(r"^\s*(?:-|–|—|to)\s*", "", lines[i + 1].strip())
            out.append(f"{start} - {end}")
            i += 2
            continue
        out.append(line)
        i += 1
    return out


# A line that ends a sentence (the next line starts a new one).
_SENTENCE_END = re.compile(r"[.!?;:][\"'’”)\]]?$")
# A line that can't be the end of its sentence: the next line carries it on.
_CARRIES_ON = re.compile(
    r"(?:[,/&(+–—]|\b(?:and|or|of|in|to|for|with|by|the|a|an|on|at|from|into|"
    r"via|as|across|using|including|while|that|which|per|over|under|than)\b)$",
    re.IGNORECASE,
)
# A word broken at the end of a line ("Omni-" / "channel").
_BROKEN_WORD = re.compile(r"[A-Za-z]-$")
MAX_DESCRIPTION = 2000


def _carries_on(item: dict, line: str, longest: int) -> bool:
    """Is ``line`` the rest of ``item`` (a PDF wrapped it), not a new point?"""
    if line[:1].islower():
        return True
    text = item["text"]
    if _SENTENCE_END.search(text):
        return False
    if _CARRIES_ON.search(text) or _BROKEN_WORD.search(text):
        return True
    # The line before ran to the edge of the page: it wrapped.
    return item["last"] >= 0.75 * longest


def _description(lines: list[tuple[str, bool]]) -> str:
    """A job's lines as its description: wrapped lines joined back into their
    sentence, one point per line, bullets kept ("• "), never cut mid-word."""
    longest = max((len(t) for t, _ in lines), default=0)
    items: list[dict] = []
    for text, bullet in lines:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        if items and not bullet and _carries_on(items[-1], text, longest):
            prev = items[-1]
            glue = "" if _BROKEN_WORD.search(prev["text"]) else " "
            prev["text"] = f"{prev['text']}{glue}{text}"
            prev["last"] = len(text)
            continue
        items.append({"text": text, "bullet": bullet, "last": len(text)})
    out: list[str] = []
    size = 0
    for item in items:
        line = f"• {item['text']}" if item["bullet"] else item["text"]
        extra = len(line) + (1 if out else 0)
        if size + extra > MAX_DESCRIPTION:
            if not out:
                # One point longer than the box: cut at a space, never mid-word.
                cut = line[:MAX_DESCRIPTION].rsplit(" ", 1)[0]
                out.append(cut.rstrip(" ,;:-"))
            break
        out.append(line)
        size += extra
    return "\n".join(out)


def _tail(job: dict) -> list[str]:
    """The job's last lines after its last bullet: they may name the next job."""
    out: list[str] = []
    for text, bullet in reversed(job["lines"]):
        if bullet:
            break
        out.insert(0, text)
    return out


def _work(lines: list[str]) -> list[dict]:
    lines = _join_split_dates(lines)
    jobs: list[dict] = []
    pending: list[str] = []  # lines naming the first job, before its dates
    marker = False  # a bullet glyph alone on the line before
    for line in lines:
        if _LONE_MARK.match(line):
            marker = True
            continue
        bullet = marker or bool(_BULLET.match(line))
        marker = False
        if bullet:
            if jobs:
                jobs[-1]["lines"].append((_BULLET.sub("", line), True))
            pending.clear()
            continue
        dates = _dates(line)
        if dates:
            a, b = dates["span"]
            head = (line[:a] + " " + line[b:]).strip(" |·•,–—-	")
            candidates = _pieces(head)
            # A dates line that names the job on its own needs nothing else;
            # otherwise the lines just above hold the rest ("Title" over
            # "Company | City | dates", "Company, City" over "Title  dates", or
            # "Title" / "Company" / "dates" on three lines). Those lines are
            # taken back from the job before: they were never its description.
            named = lambda c: [x for x in c if not _PLACE.match(x)]  # noqa: E731
            above = _tail(jobs[-1]) if jobs else pending
            took = 0
            for prev in reversed(above[-2:]):
                if len(named(candidates)) >= 2 or prev[:1].islower():
                    break
                candidates = _pieces(prev) + candidates
                took += 1
            if took and jobs:
                del jobs[-1]["lines"][-took:]
            job = _job_from(candidates, dates)
            if job:
                jobs.append({**job, "lines": []})
            pending.clear()
            continue
        if jobs:
            job = jobs[-1]
            # "Portland, OR" right under the job's line is where it was.
            if not job["lines"] and _PLACE.match(line):
                job["location"] = job["location"] or line[:200]
                continue
            # Everything else under a job is its description (a wrapped line
            # is joined back to its sentence in _description).
            job["lines"].append((line, False))
            continue
        pending.append(line)
        if len(pending) > 2:
            pending.pop(0)
    for job in jobs:
        job["description"] = _description(job.pop("lines"))
    return jobs[:12]


_BRACKET = re.compile(r"\([^()]{0,80}\)")


def _drop_dated(m: re.Match) -> str:
    return "" if _YEAR_ONLY.search(m.group(0)) else m.group(0)


def _education(lines: list[str]) -> list[dict]:
    schools: list[dict] = []
    for line in lines:
        if _BULLET.match(line) and not _SCHOOLISH.search(line):
            continue
        text = _BULLET.sub("", line)
        if not _SCHOOLISH.search(text):
            continue
        parts = [
            t.strip() for p in _split_head(text) for t in p.split(", ") if t.strip()
        ]
        # "(2016)", "(Aug 2014 - May 2016)": a short bracket holding a year.
        parts = [_BRACKET.sub(_drop_dated, p).strip(" ,.-") for p in parts]
        school = next((p for p in parts if _SCHOOLISH.search(p)), parts[0])
        rest = [p for p in parts if p is not school]
        degree, field = "", ""
        for p in rest:
            d = _DEGREE.search(p)
            if d and not degree:
                degree = d.group(0)
                tail = p[d.end() :].strip(" ,.-")
                tail = re.sub(r"^(in|of)\s+", "", tail, flags=re.IGNORECASE)
                field = _YEAR_ONLY.sub("", tail).strip(" ,.-") or field
            elif not field and not _YEAR_ONLY.fullmatch(p.strip()):
                field = _YEAR_ONLY.sub("", p).strip(" ,.-")
        years = [y for y in (_year(m.group(0)) for m in _YEAR_ONLY.finditer(text)) if y]
        schools.append(
            {
                "school": school[:200],
                "degree": degree[:200],
                "field_of_study": field[:200],
                "start_year": years[0] if len(years) > 1 else None,
                "end_year": years[-1] if years else None,
            }
        )
    return schools[:6]


def _split_top(text: str) -> list[str]:
    """Split on , ; | • · — but not inside brackets: "Azure (AD, Intune)"."""
    parts, cur, depth = [], "", 0
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]" and depth:
            depth -= 1
        if depth == 0 and ch in ",;|•·":
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts]


def _list(lines: list[str]) -> list[str]:
    items: list[str] = []
    for line in lines:
        text = _BULLET.sub("", line)
        # "Endpoints: Windows 10/11, macOS" — drop the group label.
        if ":" in text and len(text.split(":", 1)[0]) <= 30:
            text = text.split(":", 1)[1]
        for part in _split_top(text):
            part = part.strip(" .")
            if 1 < len(part) <= 60 and part.lower() not in (i.lower() for i in items):
                items.append(part)
    return items[:60]


def _certifications(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        text = _BULLET.sub("", line).strip()
        if text and len(text) <= 160 and text not in out:
            out.append(text)
    return out[:20]


def read(text: str) -> dict:
    """{work, education, skills, certifications, websites} from a résumé's text."""
    if not text or not text.strip():
        return {
            "work": [],
            "education": [],
            "skills": [],
            "certifications": [],
            "websites": [],
        }
    text = text[:MAX_TEXT]
    parts = _sections(text)
    mixed = parts.get("education_certs", [])

    def is_cert(line: str) -> bool:
        return bool(re.search(r"\bcertif|\blicen[cs]e", line, re.IGNORECASE))

    education_lines = parts.get("education", []) + [
        line for line in mixed if _SCHOOLISH.search(line) and not is_cert(line)
    ]
    cert_lines = parts.get("certifications", []) + [
        line
        for line in mixed
        if (is_cert(line) or not _SCHOOLISH.search(line))
        and not re.search(r"\bno degree\b", line, re.IGNORECASE)
    ]
    websites: list[str] = []
    for line in text.splitlines():
        for m in _URL.finditer(line[:MAX_LINE]):
            url = re.sub(
                r"^(https?://)?(www\.)?", "https://", m.group(0), flags=re.IGNORECASE
            ).rstrip("/.")
            if len(url) <= 300 and url.lower() not in (w.lower() for w in websites):
                websites.append(url)
    return {
        "work": _work(parts.get("work", [])),
        "education": _education(education_lines),
        "skills": _list(parts.get("skills", [])),
        "certifications": _certifications(cert_lines),
        "websites": websites[:10],
    }
