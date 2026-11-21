"""Job levels for Claude Scout (spec 012): what the user is looking for, how
LinkedIn's experience filter asks for it, and the app's own cap that keeps
senior roles out of Best whatever Claude scores.

Also the recommended settings, in one place: the page shows them before the
user applies them, and new searches start from them.
"""

from app.services.scout_dedupe import title_key

LEVELS = ("entry", "mid", "senior")
# What Claude may read a posting as: the user's levels plus "lead" (lead,
# manager, principal, director and above).
FINDING_LEVELS = (*LEVELS, "lead")
RANK = {level: i for i, level in enumerate(FINDING_LEVELS)}
DEFAULT_LEVELS = ["entry", "mid"]
LABEL = {"entry": "Entry", "mid": "Mid", "senior": "Senior", "lead": "Lead"}

# LinkedIn's experience filter (f_E): 1 internship, 2 entry, 3 associate,
# 4 mid-senior, 5 director. LinkedIn files most mid-level jobs as
# "Mid-Senior", so Mid asks for 4 too; the cap below keeps real senior roles
# out of Best (research R3).
F_E = {"entry": ("2",), "mid": ("3", "4"), "senior": ("4", "5")}

# Titles that read as above Mid: dropped from Claude's suggestions unless the
# user chose Senior.
SENIOR_WORDS = (
    "senior",
    "sr",
    "lead",
    "principal",
    "manager",
    "director",
    "head",
    "vp",
    "chief",
    "architect",
)

# Years asked over the user's own that make a job one step up, or two.
YEARS_STEP = 3
YEARS_TWO_STEPS = 5

RECOMMENDED = {
    "mission": {
        "job_count": 10,
        "posted_within_days": 7,
        "min_fit": 6,
        "radius_miles": 25,
    },
    "track": {"levels": DEFAULT_LEVELS, "skip": {"degree_only": False}},
}


def clean_levels(values) -> list[str]:
    """The user's levels in order; the default when none are valid."""
    chosen = {str(v).strip().lower() for v in values or []}
    out = [level for level in LEVELS if level in chosen]
    return out or list(DEFAULT_LEVELS)


def clean_level(value) -> str | None:
    """A level Claude read, or None when it isn't one of ours."""
    v = str(value or "").strip().lower()
    return v if v in RANK else None


def levels_label(levels) -> str:
    """ "Entry–Mid", "Senior", "Entry + Senior"."""
    chosen = clean_levels(levels)
    names = [LABEL[level] for level in chosen]
    if len(names) == 1:
        return names[0]
    ranks = [RANK[level] for level in chosen]
    if ranks == list(range(ranks[0], ranks[-1] + 1)):
        return f"{names[0]}–{names[-1]}"
    return " + ".join(names)


def linkedin_f_e(levels) -> str:
    codes = sorted({code for level in clean_levels(levels) for code in F_E[level]})
    return ",".join(codes)


def level_rule(levels, years: int | None) -> str:
    """What Claude is told about levels, in plain words."""
    chosen = clean_levels(levels)
    label = levels_label(chosen)
    rule = (
        f"The user wants {label} roles. Send each job's level as you read it "
        "(entry, mid, senior or lead) and the years it asks for. A job at these "
        "levels can score full marks. One level up is a stretch: the app lowers "
        "it under the bar. Lead, manager, principal or director roles are long "
        "shots unless Senior is chosen."
    )
    if years is not None:
        rule += (
            f" The user has about {years} years of experience: a job asking for "
            f"{years + YEARS_STEP} or more is a stretch, {years + YEARS_TWO_STEPS} "
            "or more a long shot."
        )
    return rule


def cap(
    fit: int,
    min_fit: int,
    levels,
    years: int | None,
    level: str | None,
    years_asked: int | None,
) -> tuple[int, str | None]:
    """The app's cap on Claude's score for a job above the user's levels
    (research R4): one step up is at most Possible (``min_fit - 1``), two or
    more a Long shot (``min_fit - 3``). Returns the score and why it was
    lowered (None when it wasn't)."""
    chosen = clean_levels(levels)
    steps, why = 0, ""
    level = clean_level(level)
    if level is not None:
        over = RANK[level] - max(RANK[x] for x in chosen)
        if over > 0:
            steps, why = over, f"{LABEL[level].lower()} role"
    if years is not None and years_asked is not None:
        extra = years_asked - years
        more = 2 if extra >= YEARS_TWO_STEPS else 1 if extra >= YEARS_STEP else 0
        if more > steps:
            steps, why = more, f"asks for {years_asked} years"
    if not steps:
        return fit, None
    ceiling = max(0, min_fit - (1 if steps == 1 else 3))
    if fit <= ceiling:
        return fit, None
    return ceiling, f"Lowered to {ceiling}: {why}, you chose {levels_label(chosen)}"


def senior_title(title: str) -> bool:
    words = title_key(title).split()
    return any(w in SENIOR_WORDS for w in words)
