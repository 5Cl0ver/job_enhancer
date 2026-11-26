/**
 * Bugs & ideas (spec 032): the shapes the inbox works with and the plain
 * words it shows. Pure, so the list, the detail, the add form and the copy
 * text all say the same thing.
 */

export type BugType = "bug" | "idea";
export type BugSection =
  "app" | "job_catcher" | "email" | "scout" | "apply" | "other";
export type BugSeverity = "blocker" | "major" | "minor";
export type BugSource = "owner" | "owner_ai" | "run" | "caught";
export type BugStatus =
  | "new"
  | "confirmed"
  | "working"
  | "fixed"
  | "wont_fix"
  | "planned"
  | "done"
  | "no";

export interface BugContext {
  device?: string;
  browser?: string;
  theme?: string;
  app_version?: string;
  api_version?: string;
  job_catcher?: string;
  playbook?: string;
}

/** One report, as the list has it (everything but its history). */
export interface BugRow {
  id: string;
  type: BugType;
  title: string;
  section: BugSection;
  severity: BugSeverity | null;
  status: BugStatus;
  source: BugSource;
  count: number;
  first_seen: string;
  last_seen: string;
  came_back_at: string | null;
  needs_check: boolean;
  fixed_in: string | null;
  pinned: boolean;
  place: string | null;
  has_shot: boolean;
  kind: string;
  box: string | null;
  steps: string[];
  actual: string;
  expected: string;
  confidence: "sure" | "not_sure";
  context: BugContext;
  run_id: string | null;
}

export interface BugEvent {
  id: string;
  kind:
    "seen" | "status" | "edit" | "note" | "merge" | "split" | "link" | "unlink";
  by: "owner" | "claude" | "app";
  at: string;
  data: Record<string, unknown>;
}

export interface BugDetail extends BugRow {
  run: { id: string } | null;
  job: { id: string; title: string; company: string } | null;
  events: BugEvent[];
  links: { id: string; title: string; type: BugType; status: BugStatus }[];
  shots: { id: string; size: number }[];
}

export interface BugList {
  items: BugRow[];
  total: number;
  counts: {
    bugs_open: number;
    ideas_open: number;
    sections: Record<BugSection, number>;
  };
}

export interface BugFilters {
  type: BugType;
  section?: BugSection;
  /** A status, "open" (the default) or "all". */
  status: BugStatus | "open" | "all";
  severity?: BugSeverity;
  source?: BugSource;
  came_back?: boolean;
  needs_check?: boolean;
  q?: string;
}

/** What the owner types (the add and edit forms). */
export interface BugDraft {
  type: BugType;
  title: string;
  section: BugSection;
  severity: BugSeverity;
  actual: string;
  expected: string;
  steps: string;
  place?: string;
  box?: string;
}

export const SECTIONS: BugSection[] = [
  "app",
  "job_catcher",
  "email",
  "scout",
  "apply",
  "other",
];

export const SECTION_LABEL: Record<BugSection, string> = {
  app: "App",
  job_catcher: "Job Catcher",
  email: "Email updates",
  scout: "Scout",
  apply: "Apply with Claude",
  other: "Account & other",
};

export const SEVERITIES: BugSeverity[] = ["blocker", "major", "minor"];

export const SEVERITY_LABEL: Record<BugSeverity, string> = {
  blocker: "Blocker",
  major: "Major",
  minor: "Minor",
};

export const SOURCE_LABEL: Record<BugSource, string> = {
  owner: "You",
  owner_ai: "Your AI",
  run: "Claude in a run",
  caught: "Caught by the app",
};

export const STATUS_LABEL: Record<BugStatus, string> = {
  new: "New",
  confirmed: "Confirmed",
  working: "Working on it",
  fixed: "Fixed",
  wont_fix: "Won't fix",
  planned: "Planned",
  done: "Done",
  no: "No",
};

export const BUG_STATUSES: BugStatus[] = [
  "new",
  "confirmed",
  "working",
  "fixed",
  "wont_fix",
];
export const IDEA_STATUSES: BugStatus[] = ["new", "planned", "done", "no"];

export function statusesFor(type: BugType): BugStatus[] {
  return type === "bug" ? BUG_STATUSES : IDEA_STATUSES;
}

export function isOpen(r: Pick<BugRow, "type" | "status">): boolean {
  return r.type === "bug"
    ? ["new", "confirmed", "working"].includes(r.status)
    : ["new", "planned"].includes(r.status);
}

/** The section a page belongs to, for the add form's first guess. */
export function sectionForPath(pathname: string, search = ""): BugSection {
  if (pathname.startsWith("/email-updates")) return "email";
  if (pathname.startsWith("/job-catcher") || pathname.startsWith("/autofill"))
    return "job_catcher";
  if (pathname.startsWith("/apply/")) return "apply";
  if (
    pathname.startsWith("/search") &&
    new URLSearchParams(search).get("tab") === "scout"
  )
    return "scout";
  if (pathname.startsWith("/settings")) return "other";
  return "app";
}

/** "Chrome 131", "Safari 18", "Firefox 133", "Edge 131". */
export function browserName(ua: string): string {
  const tests: [string, RegExp][] = [
    ["Edge", /Edg\/(\d+)/],
    ["Samsung Internet", /SamsungBrowser\/(\d+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /Version\/(\d+).*Safari/],
  ];
  for (const [name, re] of tests) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return "Another browser";
}

/** "Steps" as typed: one a line, numbers the owner typed taken off. */
export function stepsFrom(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** "3 times" / "once". */
export function timesText(count: number): string {
  return count === 1 ? "once" : `${count} times`;
}
