/**
 * Claude Scout helpers — pure functions and constants, no React.
 *
 * Resume types ("tracks") describe one kind of role the user targets: what to
 * search for, what to skip, and which resume to apply with.
 */

export interface SkipRules {
  /** Skip jobs requiring a degree with no "or equivalent experience". */
  degree_only: boolean;
  /** Skip jobs asking for more years than this; null = no limit. */
  max_years: number | null;
  /** Words that rule a job out ("clearance", "SAP"). */
  exclude: string[];
}

export interface Track {
  id: string;
  name: string;
  target_titles: string[];
  /** Other titles to search for too ("also search for"). */
  related_titles?: string[];
  /** Search titles as exact phrases (off: each title its own looser search). */
  exact_titles?: boolean;
  key_skills: string[];
  skip_rules: SkipRules;
  min_pay: number | null;
  /** The job levels to look for (never empty; default Entry + Mid). */
  levels?: Level[];
  /** The user's years of experience, for the level cap. */
  years?: number | null;
  resume_id: string | null;
  resume_filename: string | null;
  notes: string | null;
  sort_order: number;
  job_count: number;
  created_at: string;
  updated_at: string;
}

export type TrackInput = Pick<
  Track,
  | "name"
  | "target_titles"
  | "related_titles"
  | "exact_titles"
  | "key_skills"
  | "skip_rules"
  | "min_pay"
  | "resume_id"
  | "notes"
  | "levels"
  | "years"
>;

export const MAX_TRACKS = 8;

export type Level = "entry" | "mid" | "senior";
export const LEVELS: { value: Level; label: string }[] = [
  { value: "entry", label: "Entry" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
];
export const DEFAULT_LEVELS: Level[] = ["entry", "mid"];

/** "Entry–Mid", "Senior", "Entry + Senior". */
export function levelsLabel(
  levels: readonly string[] | null | undefined,
): string {
  const wanted = levels?.length ? levels : DEFAULT_LEVELS;
  const chosen = LEVELS.filter((l) => wanted.includes(l.value));
  if (chosen.length === 0) return levelsLabel(DEFAULT_LEVELS);
  if (chosen.length === 1) return chosen[0].label;
  const ranks = chosen.map((l) => LEVELS.indexOf(l));
  const together = ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
  return together
    ? `${chosen[0].label}–${chosen[chosen.length - 1].label}`
    : chosen.map((l) => l.label).join(" + ");
}

export const DEFAULT_SKIP: SkipRules = {
  // Off: jobs needing a degree are scored normally, the degree under gaps.
  degree_only: false,
  max_years: null,
  exclude: [],
};

/** Suggested resume types, so a first-time user starts with a click. */
export const STARTER_TRACKS: TrackInput[] = [
  {
    name: "Business Analyst",
    target_titles: [
      "Business Analyst",
      "Business Systems Analyst",
      "IT Business Analyst",
      "Systems Analyst",
    ],
  },
  {
    name: "IT Admin",
    target_titles: [
      "IT Systems Administrator",
      "IT Administrator",
      "Jira Administrator",
      "Atlassian Administrator",
      "Microsoft 365 Administrator",
    ],
  },
  {
    name: "Systems & Automation Engineer",
    target_titles: [
      "IT Systems Engineer",
      "IT Automation Engineer",
      "Systems Engineer",
      "Enterprise Applications Engineer",
    ],
  },
  {
    name: "Identity & Endpoint",
    target_titles: [
      "IAM Engineer",
      "Identity Engineer",
      "Identity and Access Analyst",
      "Endpoint Engineer",
    ],
  },
  {
    name: "Junior Developer",
    target_titles: [
      "Junior Software Developer",
      "Associate Software Engineer",
      "Software Engineer I",
      "Internal Tools Developer",
    ],
  },
].map((t) => ({
  ...t,
  key_skills: [],
  skip_rules: DEFAULT_SKIP,
  min_pay: null,
  resume_id: null,
  notes: null,
}));

/** "a, b\nc" -> ["a", "b", "c"]: commas or new lines, blanks dropped. */
export function splitList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One per line — for titles, which can contain commas ("Engineer, Senior"). */
export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 72000 -> "$72K"; null -> null. */
export function formatPay(pay: number | null): string | null {
  if (pay == null) return null;
  return pay >= 1000 ? `$${Math.round(pay / 1000)}K` : `$${pay}`;
}

/** "$70K" / "70,000" / "70k" -> 70000; blank -> null; nonsense -> NaN. */
export function parsePay(text: string): number | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[$,\s]/g, "");
  if (!t) return null;
  const k = t.endsWith("k");
  const n = Number(k ? t.slice(0, -1) : t);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(k ? n * 1000 : n);
}

// ---------------------------------------------------------------------------
// Searches (missions) and runs
// ---------------------------------------------------------------------------

export type Source =
  "linkedin" | "indeed" | "ziprecruiter" | "google_jobs" | "local_companies";
export type Remote = "any" | "remote_only" | "no_remote";

export const SOURCES: { value: Source; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "indeed", label: "Indeed" },
  { value: "ziprecruiter", label: "ZipRecruiter" },
  { value: "google_jobs", label: "Google Jobs" },
  { value: "local_companies", label: "Local companies" },
];

/** What a choice does, said under the picker where it isn't obvious. */
export const SOURCE_HINT: Partial<Record<Source, string>> = {
  google_jobs:
    "Google's own job search: postings from company sites and job boards near you.",
  local_companies:
    "No job boards. Claude finds businesses near you on Google and checks each one's own careers page: mostly new ones each run, and one it checked before only after a week.",
};

/** Searches that look around a place, so they need one. */
export function needsPlace(source: Source): boolean {
  return source === "local_companies";
}

/** Searches that aren't one job board (so no board decides the distance). */
export function isBoard(source: Source): boolean {
  return (
    source === "linkedin" || source === "indeed" || source === "ziprecruiter"
  );
}

export const POSTED_WITHIN: { value: number; label: string }[] = [
  { value: 1, label: "Today" },
  { value: 3, label: "Last 3 days" },
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
];

export const REMOTE_RULES: { value: Remote; label: string }[] = [
  { value: "any", label: "On-site, hybrid or remote" },
  { value: "remote_only", label: "Remote only" },
  { value: "no_remote", label: "On-site or hybrid only" },
];

export const MAX_JOBS_PER_RUN = 10;

/** What the user says to Claude in Chrome. Never changes: the app knows which
 * search is next, so Claude's chat stays small. */
export const SCOUT_LINE =
  "Do my next Job Scout run with the Job Enhancer connector.";

/** "Within N miles" choices the three job boards all understand. */
/** A place with no radius set searches this far around it. */
export const DEFAULT_RADIUS = 25;
/** What each board offers: a radius rounds up to the next one. */
const BOARD_RADII: Partial<Record<Source, number[]>> = {
  linkedin: [5, 10, 25, 50, 100],
  ziprecruiter: [5, 10, 25, 50, 100],
  indeed: [5, 10, 15, 25, 35, 50, 100],
};

/** The miles a board is asked for: "LinkedIn searches 50 miles" for 40. */
export function boardRadius(source: Source, miles: number): number {
  const options = BOARD_RADII[source];
  if (!options) return miles;
  return options.find((o) => o >= miles) ?? options[options.length - 1];
}

/** Where a search looks, in words: "within 25 mi of Springfield, IL". */
export function whereLabel(
  m: Pick<Mission, "location" | "radius_miles" | "remote">,
): string | null {
  if (!m.location) return null;
  return m.radius_miles && m.remote !== "remote_only"
    ? `within ${m.radius_miles} mi of ${m.location}`
    : m.location;
}

/** The broad search's overrides: titles always searched, never searched, and
 * words that skip a job. Empty lists = Claude decides on its own. */
export interface Overrides {
  always: string[];
  never: string[];
  avoid: string[];
}

export const NO_OVERRIDES: Overrides = { always: [], never: [], avoid: [] };

/** What the search choice "Anything I'd be good at" is called. */
export const BROAD_NAME = "Anything I'd be good at";

export interface Mission {
  id: string;
  name: string;
  source: Source;
  track_id: string;
  /** "Anything I'd be good at": Claude picks the job titles from the resume. */
  broad?: boolean;
  overrides?: Overrides | null;
  job_count: number;
  posted_within_days: number;
  min_pay: number | null;
  location: string | null;
  /** "Within N miles" of `location`; null leaves it to the job board. */
  radius_miles: number | null;
  remote: Remote;
  min_fit: number;
  extra_instructions: string | null;
  /** The collection good fits are saved into; null = the search's own, named
   * after its resume type. */
  collection_id: string | null;
  /** Save good fits without asking first. */
  auto_save: boolean;
  /** The name of the collection jobs go into (chosen, or the search's own). */
  collection_name: string;
  last_run_at: string | null;
  created_at: string;
}

export type MissionInput = Pick<
  Mission,
  | "source"
  | "job_count"
  | "posted_within_days"
  | "min_pay"
  | "location"
  | "radius_miles"
  | "remote"
  | "min_fit"
  | "extra_instructions"
  | "collection_id"
  | "auto_save"
> & {
  name?: string | null;
  /** Needed unless `broad`. */
  track_id?: string;
  broad?: boolean;
  overrides?: Overrides | null;
};

export type Outcome =
  | "picked" // a good fit, waiting for the user to tick and save
  | "saved"
  | "skipped" // a good fit the user passed on
  | "below_bar"
  | "duplicate"
  | "waiting_for_copy"
  | "no_copy"
  | "too_far"; // outside the search's area

export interface Finding {
  id: string;
  outcome: Outcome;
  source: Source;
  url: string;
  company: string;
  title: string;
  fit_score: number;
  why_fit: string;
  gaps: string;
  app_note: string | null;
  saved_job_id: string | null;
  job_listing_id: string | null;
  /** The collection a saved finding's job is in. */
  collection_id: string | null;
  collection_name: string | null;
  /** The user can still put it in My Jobs (its page copy exists). */
  can_save: boolean;
  /** Broad searches: the resume type Claude said this job is closest to. */
  closest_track_name?: string | null;
  /** Short facts Claude read on the page. */
  location?: string | null;
  level?: string | null;
  posted?: string | null;
  claude_fit?: number | null;
  /** "copy": title and company from the page; "claude": as Claude read them. */
  facts_from?: "copy" | "claude";
  created_at: string;
}

export type RunStatus = "queued" | "running" | "done" | "stopped";

export interface RunCounts {
  picked: number;
  saved: number;
  skipped: number;
  below_bar: number;
  duplicate: number;
  waiting_for_copy: number;
  no_copy: number;
  too_far?: number;
}

export interface Run {
  id: string;
  mission_id: string | null;
  name: string;
  source: Source;
  track_name: string;
  target: number;
  status: RunStatus;
  note: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  counts: RunCounts;
  /** Good fits are waiting for the user to tick and save. */
  needs_review: boolean;
  /** Where a save would go by default; `id` null until the collection exists. */
  folder: { id: string | null; name: string } | null;
  /** The result rows Claude checked, and why some were passed over. */
  looked_at: Record<string, number> | null;
  /** What to change when a finished search came back short. */
  tip?: string | null;
  /** Each search the run read: the board's result count, pages read, and
   * filters the board's redirect dropped. */
  links?: { title: string; total: number | null; pages: number; dropped: string[] }[];
  /** Which instructions it used: per section, when the user's edit was made
   * (null = the original). Null for runs from before the Instructions page. */
  instructions?: Record<string, string | null> | null;
  /** "Anything I'd be good at": the titles this run searched, with good fits. */
  broad?: boolean;
  titles?: { title: string; good_fits: number }[];
  findings: Finding[];
  /** Jobs found per Results group (repeats and too-far ones left out). */
  bands?: Record<Band, number>;
  hidden?: { repeats: number; too_far: number };
  /** Pages the extension never copied. */
  not_copied?: number;
  /** Titles Claude added for this run (the resume type had none of its own). */
  suggested_titles?: string[];
  /** Thin searches the app widened, and to how many days. */
  widened?: { title: string; days: number }[];
  /** What the run looked for, as it was at Start. */
  looking_for?: LookingFor | null;
}

export interface LookingFor {
  source: Source | null;
  track: string | null;
  broad?: boolean;
  levels: string[];
  location: string | null;
  radius_miles: number | null;
  remote: Remote;
  days: number | null;
  min_fit: number | null;
  job_count?: number | null;
}

/** "Entry–mid IT Admin jobs · Beaverton, OR + 25 mi · past week · fit 6+" */
export function lookingFor(l: LookingFor): string {
  const what = l.broad
    ? "jobs you'd be good at"
    : `${l.track ?? ""} jobs`.trim();
  const level = levelsLabel(l.levels);
  const head = `${level.charAt(0)}${level.slice(1).toLowerCase()} ${what}`;
  const where =
    l.remote === "remote_only"
      ? "remote"
      : l.location
        ? `${l.location}${l.radius_miles ? ` + ${l.radius_miles} mi` : ""}${
            l.remote === "no_remote" ? ", on-site" : ""
          }`
        : null;
  const when =
    l.days === 1
      ? "today"
      : l.days === 7
        ? "past week"
        : l.days
          ? `past ${l.days} days`
          : null;
  return [head, where, when, l.min_fit != null ? `fit ${l.min_fit}+` : null]
    .filter(Boolean)
    .join(" · ");
}

/** A search's own "looking for", before it runs. */
export function missionLookingFor(
  m: Mission,
  track: Track | undefined,
): LookingFor {
  return {
    source: m.source,
    track: track?.name ?? null,
    broad: m.broad,
    levels: track?.levels ?? DEFAULT_LEVELS,
    location: m.location,
    radius_miles:
      m.location && m.remote !== "remote_only"
        ? (m.radius_miles ?? DEFAULT_RADIUS)
        : null,
    remote: m.remote,
    days: m.posted_within_days,
    min_fit: m.min_fit,
    job_count: m.job_count,
  };
}

// ---------------------------------------------------------------------------
// Results: every job Scout found, grouped against each run's own bar
// ---------------------------------------------------------------------------
export type Band = "best" | "possible" | "long_shot";
export type FindingStatus = "new" | "saved" | "passed" | "hidden";
export const BANDS: Band[] = ["best", "possible", "long_shot"];
export const STATUSES: FindingStatus[] = ["new", "saved", "passed", "hidden"];

export const BAND_LABEL: Record<Band, string> = {
  best: "Best",
  possible: "Possible",
  long_shot: "Long shots",
};
export const BAND_HINT: Record<Band, string> = {
  best: "At or over your bar",
  possible: "Just under your bar",
  long_shot: "Unlikely fits",
};
export const STATUS_LABEL: Record<FindingStatus, string> = {
  new: "New",
  saved: "Saved",
  passed: "Passed",
  hidden: "Hidden",
};

export interface FindingItem {
  id: string;
  run_id: string;
  run_name: string;
  track_id: string | null;
  source: Source;
  search_title: string | null;
  title: string;
  company: string;
  location: string | null;
  level: string | null;
  years_asked: number | null;
  posted: string | null;
  url: string;
  fit: number;
  claude_fit: number | null;
  band: Band;
  min_fit: number;
  why_fit: string;
  gaps: string;
  app_note: string | null;
  status: FindingStatus;
  outcome: Outcome;
  facts_from: "copy" | "claude";
  can_save: boolean;
  /** No page copy, but Claude read a title and company (spec 015). */
  can_save_anyway?: boolean;
  saved_job_id: string | null;
  job_listing_id: string | null;
  found_at: string;
}

export type FindingCounts = Record<Band | FindingStatus, number>;

export interface FindingPage {
  items: FindingItem[];
  counts: FindingCounts;
  next: number | null;
}

export interface FindingFilters {
  /** A run id, "last", or null for all runs. */
  run: string | null;
  track: string | null;
  status: FindingStatus;
  sort: "fit" | "newest";
}

/** "Mid · 3+ yrs · Springfield, IL · 2 days ago" */
export function findingFacts(
  f: Pick<FindingItem, "level" | "years_asked" | "location" | "posted">,
): string {
  const level = f.level
    ? `${f.level.charAt(0).toUpperCase()}${f.level.slice(1)}`
    : null;
  return [
    level,
    f.years_asked != null ? `${f.years_asked}+ yrs` : null,
    f.location,
    f.posted,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The recommended settings (served by the app). */
export interface Recommended {
  mission: {
    job_count: number;
    posted_within_days: number;
    min_fit: number;
    radius_miles: number;
  };
  track: { levels: Level[]; skip: { degree_only: boolean } };
}

export interface SettingChange {
  label: string;
  from: string;
  to: string;
}

/** What "Use recommended settings" would change on a search. It only ever
 * widens: a search already looking wider than recommended keeps its own. */
export function missionChanges(
  m: Pick<
    Mission,
    | "job_count"
    | "posted_within_days"
    | "min_fit"
    | "location"
    | "remote"
    | "radius_miles"
  >,
  rec: Recommended,
): SettingChange[] {
  const r = rec.mission;
  const out: SettingChange[] = [];
  if (m.job_count < r.job_count)
    out.push({
      label: "Jobs per run",
      from: String(m.job_count),
      to: String(r.job_count),
    });
  if (m.posted_within_days < r.posted_within_days)
    out.push({
      label: "Posted",
      from: postedLabel(m.posted_within_days),
      to: postedLabel(r.posted_within_days),
    });
  if (m.min_fit > r.min_fit)
    out.push({
      label: "Fit for Best",
      from: `${m.min_fit}+`,
      to: `${r.min_fit}+`,
    });
  if (m.location && m.remote !== "remote_only" && m.radius_miles == null)
    out.push({
      label: "Distance",
      from: "Not set",
      to: `${r.radius_miles} mi`,
    });
  return out;
}

/** What "Use recommended settings" would change on a resume type. */
export function trackChanges(
  t: Pick<Track, "levels" | "skip_rules">,
  rec: Recommended,
): SettingChange[] {
  const out: SettingChange[] = [];
  const levels = t.levels?.length ? t.levels : DEFAULT_LEVELS;
  const missing = rec.track.levels.filter((l) => !levels.includes(l));
  if (missing.length)
    out.push({
      label: "Levels",
      from: levelsLabel(levels),
      to: levelsLabel([...levels, ...missing]),
    });
  if (t.skip_rules.degree_only && !rec.track.skip.degree_only)
    out.push({
      label: "Degree rule",
      from: "Skip degree-only jobs",
      to: "Off",
    });
  return out;
}

/** A title a broad search has tried. */
export interface TitleTried {
  title: string;
  runs: number;
  good_fits: number;
  last_tried_at: string | null;
  /** Found nothing in 3 runs: left out for 2 weeks. */
  resting: boolean;
  always: boolean;
  never: boolean;
}

/** Add a title to one override list (taking it out of the opposite one). */
export function withTitle(
  o: Overrides | null | undefined,
  list: "always" | "never",
  title: string,
): Overrides {
  const base = o ?? NO_OVERRIDES;
  const other = list === "always" ? "never" : "always";
  const same = (a: string) => a.toLowerCase() === title.toLowerCase();
  return {
    ...base,
    [list]: base[list].some(same) ? base[list] : [...base[list], title],
    [other]: base[other].filter((t) => !same(t)),
  };
}

export function isOpen(run: Pick<Run, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

export function sourceLabel(source: string): string {
  return SOURCES.find((s) => s.value === source)?.label ?? source;
}

export function postedLabel(days: number): string {
  return (
    POSTED_WITHIN.find((p) => p.value === days)?.label ?? `Last ${days} days`
  );
}

/** 8 -> "Strong", 6 -> "Good", 4 -> "Weak". */
export function fitBand(score: number): "Strong" | "Good" | "Weak" {
  if (score >= 8) return "Strong";
  if (score >= 6) return "Good";
  return "Weak";
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  picked: "Good fit",
  saved: "Saved",
  skipped: "You passed on it",
  below_bar: "Below your bar",
  duplicate: "Already had it",
  waiting_for_copy: "Copying…",
  no_copy: "Not copied",
  too_far: "Too far",
};

/** Good fits a run found: waiting, saved, or passed on by the user. */
function goodFits(c: RunCounts): number {
  return (c.picked ?? 0) + c.saved + (c.skipped ?? 0);
}

/** One line for a run's progress, as the page shows it. */
export function runSummary(
  run: Pick<Run, "status" | "counts" | "target">,
): string {
  const { saved } = run.counts;
  const picked = run.counts.picked ?? 0;
  const passed = run.counts.below_bar + run.counts.duplicate;
  const extra = passed ? ` · ${passed} passed over` : "";
  if (run.status === "queued") return "Waiting for Claude to start";
  // The same count Claude works to: good fits waiting or saved (one the user
  // passed on doesn't count, so Claude keeps looking).
  if (run.status === "running")
    return `Searching · ${saved + picked} of ${run.target} found${extra}`;
  const ended = run.status === "stopped" ? "Stopped" : "Done";
  if (picked > 0)
    return `${ended} · ${picked} waiting for you${saved ? ` · ${saved} saved` : ""}${extra}`;
  return `${ended} · ${saved} saved${extra}`;
}

/**
 * Why a finished search came back with fewer jobs than asked, in one line whose
 * numbers add up: "Asked for 5, found 2. Looked at 24 postings: 9 seen in
 * earlier searches · 4 titles didn't fit · …". Null while it's running or when
 * it found what was asked.
 */
export function lookedAt(
  run: Pick<Run, "status" | "counts" | "target" | "looked_at">,
): string | null {
  if (isOpen(run)) return null;
  const c = run.counts;
  const found = goodFits(c);
  if (found >= run.target) return null;
  const head = `Asked for ${run.target}, found ${found}.`;
  const parts: string[] = [];
  const add = (n: number, what: string) => {
    if (n > 0) parts.push(`${n} ${what}`);
  };
  const seen = run.looked_at?.seen_before ?? 0;
  const excluded = run.looked_at?.excluded ?? 0;
  // Titles Claude said don't fit the resume type (remembered for next time).
  const unfit = run.looked_at?.title_passed ?? 0;
  const tracked = run.looked_at?.in_tracker ?? 0;
  const uncopied = c.no_copy + c.waiting_for_copy;
  add(seen, "seen in earlier searches");
  add(unfit, "titles didn't fit");
  add(excluded, "had a word you skip");
  add(tracked, "already in My Jobs");
  add(c.below_bar, "below your bar");
  add(c.duplicate, "you already had");
  add(uncopied, "couldn't be copied");
  if (!run.looked_at)
    return parts.length ? `${head} ${parts.join(" · ")}.` : head;
  const opened = found + c.below_bar + c.duplicate + uncopied;
  // A job reported without going through the results-page check still counts.
  const rows = Math.max(
    run.looked_at.rows ?? 0,
    seen + unfit + excluded + tracked + opened,
  );
  add(rows - seen - unfit - excluded - tracked - opened, "not opened");
  const looked = `Looked at ${rows} ${rows === 1 ? "posting" : "postings"}`;
  return parts.length
    ? `${head} ${looked}: ${parts.join(" · ")}.`
    : `${head} ${looked}.`;
}

/**
 * A Local companies run's companies, in one line: "Checked 12 local companies:
 * 9 new · 3 re-checked · 4 had jobs listed." Null for other searches.
 */
export function companiesLine(
  lookedAtCounts: Record<string, number> | null,
): string | null {
  const n = lookedAtCounts?.companies ?? 0;
  if (!n) return null;
  const parts: string[] = [];
  const add = (count: number | undefined, what: string) => {
    if (count) parts.push(`${count} ${what}`);
  };
  add(lookedAtCounts?.companies_new, "new");
  add(lookedAtCounts?.companies_rechecked, "re-checked");
  parts.push(`${lookedAtCounts?.companies_with_openings ?? 0} had jobs listed`);
  return `Checked ${n} local ${n === 1 ? "company" : "companies"}: ${parts.join(" · ")}.`;
}

/** A local company a search checked. */
export interface Company {
  id: string;
  name: string;
  website: string | null;
  careers_url: string | null;
  last_checked_at: string | null;
  times_checked: number;
  last_result: "openings" | "none" | "no_careers" | "not_checked" | null;
  never_check: boolean;
  /** Due for a check on the next run. */
  due: boolean;
  /** The openings Claude saw on the latest check. */
  last_openings?: { title: string; url: string; fit: number | null }[];
}

/** "Has jobs listed · checked Nov 18" */
export function companyStatus(c: Company): string {
  const result =
    c.last_result === "openings"
      ? "Has jobs listed"
      : c.last_result === "none"
        ? "No openings"
        : c.last_result === "no_careers"
          ? "No careers page"
          : c.last_result === "not_checked"
            ? "Couldn't check"
            : "Not reported";
  if (c.never_check) return `${result} · you skipped it`;
  if (!c.last_checked_at && c.last_result === "not_checked")
    return `${result} · tried again next run`;
  if (!c.last_checked_at) return `${result} · checked next run`;
  const when = new Date(c.last_checked_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  // A site that didn't load was only tried, not checked.
  return `${result} · ${c.last_result === "not_checked" ? "tried" : "checked"} ${when}`;
}

/**
 * Which findings are ticked in the review: Claude's good fits, then whatever
 * the user changed. Only findings that can still be saved count.
 */
export function reviewTicks(
  findings: Pick<Finding, "id" | "outcome" | "can_save">[],
  changed: Map<string, boolean>,
): Set<string> {
  const ticks = new Set<string>();
  for (const f of findings) {
    if (!f.can_save) continue;
    if (changed.get(f.id) ?? f.outcome === "picked") ticks.add(f.id);
  }
  return ticks;
}

// --------------------------------------------------------------------------
// The Instructions page and the run log
// --------------------------------------------------------------------------
export type InstructionKey =
  | "playbook"
  | "google_jobs"
  | "local_companies"
  | "broad"
  | "rubric"
  | "limits";

export interface InstructionSection {
  key: InstructionKey;
  title: string;
  kind: "text" | "rubric" | "limits";
  original: string | Record<string, number>;
  current: string | Record<string, number>;
  edited: boolean;
  edited_at: string | null;
  /** The app's own original changed since the user edited this. */
  original_changed: boolean;
  ranges?: Record<string, [number, number]> | null;
  labels?: Record<string, string> | null;
}

export interface Instructions {
  sections: InstructionSection[];
  rubric_text: string;
  locked_rules: string;
  connector_note: string;
  tools: { name: string; description: string }[];
  fixed_limits: { label: string; value: string }[];
}

export interface InstructionVersion {
  id: string;
  created_at: string;
  reset: boolean;
  body: string | Record<string, number>;
}

export interface RunEvent {
  id: string;
  created_at: string;
  tool: string;
  summary: string;
  ok: boolean;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
}

/** What each section is for, in one line. */
export const INSTRUCTION_HINT: Record<InstructionKey, string> = {
  playbook: "What Claude does on every run, step by step.",
  google_jobs: "Used in place of steps 3 and 4 on a Google Jobs search.",
  local_companies: "Used in place of steps 3 and 4 on a Local companies search.",
  broad: "Added on an Anything I'd be good at search.",
  rubric: "How Claude scores each job. The parts add up to 10.",
  limits: "How far one run goes.",
};

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/** "Main steps: edited Nov 21 · the rest original" (null for older runs). */
export function instructionsLine(
  used: Record<string, string | null> | null | undefined,
): string | null {
  if (!used) return null;
  const names: Record<string, string> = {
    playbook: "Main steps",
    google_jobs: "Google Jobs steps",
    local_companies: "Local companies steps",
    broad: "Anything I'd be good at steps",
    rubric: "Scoring",
    limits: "Limits",
  };
  const edited = Object.entries(used)
    .filter(([, when]) => when)
    .map(
      ([key, when]) =>
        `${names[key] ?? key}: edited ${new Date(when as string).toLocaleDateString(undefined, SHORT_DATE)}`,
    );
  if (edited.length === 0) return "Instructions: the originals";
  return `Instructions: ${edited.join(" · ")} · the rest original`;
}

/** "LinkedIn's results per search: IT Administrator 27 · …" (null if none). */
export function linksLine(run: Pick<Run, "source" | "links">): string | null {
  const counted = (run.links ?? []).filter((l) => l.total != null);
  if (counted.length === 0) return null;
  return `${sourceLabel(run.source)}'s results per search: ${counted
    .map((l) => `${l.title} ${l.total}`)
    .join(" · ")}.`;
}

/** Filters a board's redirect dropped on any search (null if none). */
export function droppedLine(run: Pick<Run, "source" | "links">): string | null {
  const dropped = [...new Set((run.links ?? []).flatMap((l) => l.dropped))];
  if (dropped.length === 0) return null;
  return `${sourceLabel(run.source)} dropped these filters when it opened the search: ${dropped.join(", ")}.`;
}
