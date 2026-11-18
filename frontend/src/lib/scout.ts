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
  "name" | "target_titles" | "key_skills" | "skip_rules" | "min_pay" | "resume_id" | "notes"
>;

export const MAX_TRACKS = 8;

export const DEFAULT_SKIP: SkipRules = { degree_only: true, max_years: null, exclude: [] };

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
  const t = text.trim().toLowerCase().replace(/[$,\s]/g, "");
  if (!t) return null;
  const k = t.endsWith("k");
  const n = Number(k ? t.slice(0, -1) : t);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(k ? n * 1000 : n);
}
