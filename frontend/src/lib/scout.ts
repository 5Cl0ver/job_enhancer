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
  key_skills: string[];
  skip_rules: SkipRules;
  min_pay: number | null;
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
  | "key_skills"
  | "skip_rules"
  | "min_pay"
  | "resume_id"
  | "notes"
>;

export const MAX_TRACKS = 8;

export const DEFAULT_SKIP: SkipRules = {
  degree_only: true,
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

export type Source = "linkedin" | "indeed" | "ziprecruiter";
export type Remote = "any" | "remote_only" | "no_remote";

export const SOURCES: { value: Source; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "indeed", label: "Indeed" },
  { value: "ziprecruiter", label: "ZipRecruiter" },
];

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
export const RADIUS_MILES = [5, 10, 25, 50, 100] as const;

/** Where a search looks, in words: "within 25 mi of Springfield, IL". */
export function whereLabel(
  m: Pick<Mission, "location" | "radius_miles" | "remote">,
): string | null {
  if (!m.location) return null;
  return m.radius_miles && m.remote !== "remote_only"
    ? `within ${m.radius_miles} mi of ${m.location}`
    : m.location;
}

export interface Mission {
  id: string;
  name: string;
  source: Source;
  track_id: string;
  job_count: number;
  posted_within_days: number;
  min_pay: number | null;
  location: string | null;
  /** "Within N miles" of `location`; null leaves it to the job board. */
  radius_miles: number | null;
  remote: Remote;
  min_fit: number;
  extra_instructions: string | null;
  last_run_at: string | null;
  created_at: string;
}

export type MissionInput = Pick<
  Mission,
  | "source"
  | "track_id"
  | "job_count"
  | "posted_within_days"
  | "min_pay"
  | "location"
  | "radius_miles"
  | "remote"
  | "min_fit"
  | "extra_instructions"
> & { name?: string | null };

export type Outcome =
  "saved" | "below_bar" | "duplicate" | "waiting_for_copy" | "no_copy";

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
  created_at: string;
}

export type RunStatus = "queued" | "running" | "done" | "stopped";

export interface RunCounts {
  saved: number;
  below_bar: number;
  duplicate: number;
  waiting_for_copy: number;
  no_copy: number;
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
  findings: Finding[];
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
  saved: "Saved",
  below_bar: "Below your bar",
  duplicate: "Already had it",
  waiting_for_copy: "Copying…",
  no_copy: "Not copied",
};

/** One line for a run's progress, as the page shows it. */
export function runSummary(
  run: Pick<Run, "status" | "counts" | "target">,
): string {
  const { saved } = run.counts;
  const skipped = run.counts.below_bar + run.counts.duplicate;
  const extra = skipped ? ` · ${skipped} passed over` : "";
  if (run.status === "queued") return "Waiting for Claude to start";
  if (run.status === "running")
    return `Searching · ${saved} of ${run.target} saved${extra}`;
  if (run.status === "stopped") return `Stopped · ${saved} saved${extra}`;
  return `Done · ${saved} saved${extra}`;
}
