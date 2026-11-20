/**
 * Plain-language wording and grouping for the Email Updates page.
 * Pure functions (no React) so they're easy to test.
 */
import type {
  DetectedEvent,
  EmailCategory,
  MatchCandidate,
  ReviewReason,
  ScanResult,
} from "@/hooks/useEmailAccount";

/** Important updates are listed in this order. */
export const IMPORTANT_ORDER: DetectedEvent["event_type"][] = [
  "interview",
  "assessment",
  "offer",
  "rejected",
];

/** The category, falling back for older responses without one. */
export function categoryOf(ev: DetectedEvent): EmailCategory {
  if (ev.category) return ev.category;
  if (ev.status === "auto_applied") return "moved";
  const important = IMPORTANT_ORDER.includes(ev.event_type);
  if (ev.status === "pending") return important ? "important" : "confirmation";
  if (ev.status === "needs_review" && important) return "question";
  if (ev.status === "unsaved") return "unsaved";
  if (ev.status === "contact") return "contact";
  return "hidden";
}

/** The one company every candidate shares, if there is one. */
export function sharedCompany(candidates: MatchCandidate[] | undefined): string | null {
  const names = new Set((candidates ?? []).map((c) => c.company));
  return names.size === 1 ? [...names][0] : null;
}

function companyOf(ev: DetectedEvent): string | null {
  return ev.company || sharedCompany(ev.candidates);
}

/** "Acme rejected your Support Engineer application." */
export function sentence(ev: DetectedEvent): string {
  const company = companyOf(ev);
  const who = company ?? "A company";
  const role = ev.title ? ` ${ev.title}` : "";
  const forRole = ev.title ? ` for ${ev.title}` : "";
  switch (ev.event_type) {
    case "interview":
      return `${who} invited you to interview${forRole}.`;
    case "assessment":
      return `${who} sent you an assessment${forRole}.`;
    case "offer":
      return `${who} made you an offer${forRole}.`;
    case "rejected":
      return `${who} rejected your${role} application.`;
    case "applied":
      return `${who} received your${role} application.`;
    case "recruiter":
      return `A recruiter${company ? ` from ${company}` : ""} reached out${
        ev.title ? ` about ${ev.title}` : ""
      }.`;
    default:
      return company
        ? `${company} sent an email about your application, but it isn't clear what it says.`
        : "An email about a job application wasn't clear enough to act on.";
  }
}

/** The question for an important email whose job is unclear. */
export function question(ev: DetectedEvent): string {
  const who = sharedCompany(ev.candidates) ?? "A company";
  switch (ev.event_type) {
    case "interview":
      return `${who} invited you to interview. Which job is it for?`;
    case "assessment":
      return `${who} sent you an assessment. Which job is it for?`;
    case "offer":
      return `${who} made you an offer. Which job is it for?`;
    default:
      return `${who} rejected one of your applications. Which job was it?`;
  }
}

/** What applying the update does to the card, in plain words. */
export function effect(ev: DetectedEvent): string | null {
  if (!ev.target_stage) return null;
  return `Moves the card to ${ev.target_stage}.`;
}

const REASONS: Record<string, string> = {
  job_url: "The email links to this job.",
  template: "The hiring site's email names this company and job.",
  job_id: "The email mentions this job's ID.",
  known_sender: "This person wrote to you about this job before.",
  company_title: "The email names the company and the job title.",
  company_date: "It's from the company, and this is your only job there.",
  title_only: "Only the job title matched; the company wasn't named.",
  several_roles: "You saved more than one job at this company.",
  several_jobs: "More than one saved job fits equally well.",
  fuzzy_company: "The company name is spelled a little differently.",
  company_only: "The email is older than when you saved the job.",
  conflicting_evidence: "The clues point to different jobs.",
  unsure: "The wording didn't clearly say what happened.",
  no_match: "It couldn't be tied to one of your saved jobs.",
};

/** Why the app decided what it did — shown only under Details. */
export function reason(ev: DetectedEvent): string | null {
  const key: ReviewReason | string | null | undefined =
    ev.review_reason ?? ev.match_evidence;
  return key ? (REASONS[key] ?? null) : null;
}

/** One line on the page: the newest email, plus older repeats of the same
 * update for the same job (e.g. several rejections from one company). */
export interface UpdateGroup {
  lead: DetectedEvent;
  repeats: DetectedEvent[];
}

/** What makes two updates "the same": the saved job, or — for a job that
 * isn't saved — the company and role read from the email. */
function repeatKey(ev: DetectedEvent): string | null {
  if (ev.saved_job_id) return `${ev.saved_job_id}|${ev.event_type}`;
  if (ev.status === "unsaved" && ev.company)
    return `u|${ev.company.toLowerCase()}|${(ev.title ?? "").toLowerCase()}|${ev.event_type}`;
  return null;
}

/** Collapse same-job, same-type updates into one line (newest first). */
export function collapseRepeats(events: DetectedEvent[]): UpdateGroup[] {
  const out: UpdateGroup[] = [];
  const at = new Map<string, UpdateGroup>();
  for (const ev of events) {
    const key = repeatKey(ev);
    const existing = key ? at.get(key) : undefined;
    if (existing) {
      existing.repeats.push(ev);
      continue;
    }
    const g = { lead: ev, repeats: [] };
    out.push(g);
    if (key) at.set(key, g);
  }
  return out;
}

export interface Grouped {
  moved: DetectedEvent[];
  questions: DetectedEvent[];
  important: DetectedEvent[];
  unsaved: DetectedEvent[];
  confirmations: DetectedEvent[];
  contacts: DetectedEvent[];
  hidden: DetectedEvent[];
}

const newestFirst = (a: DetectedEvent, b: DetectedEvent) =>
  b.created_at.localeCompare(a.created_at);

export function group(events: DetectedEvent[]): Grouped {
  const out: Grouped = {
    moved: [],
    questions: [],
    important: [],
    unsaved: [],
    confirmations: [],
    contacts: [],
    hidden: [],
  };
  for (const ev of events) {
    const c = categoryOf(ev);
    if (c === "moved") out.moved.push(ev);
    else if (c === "question") out.questions.push(ev);
    else if (c === "important") out.important.push(ev);
    else if (c === "unsaved") out.unsaved.push(ev);
    else if (c === "confirmation") out.confirmations.push(ev);
    else if (c === "contact") out.contacts.push(ev);
    else out.hidden.push(ev);
  }
  const byType = (a: DetectedEvent, b: DetectedEvent) =>
    IMPORTANT_ORDER.indexOf(a.event_type) - IMPORTANT_ORDER.indexOf(b.event_type) ||
    newestFirst(a, b);
  out.important.sort(byType);
  out.unsaved.sort(byType);
  out.moved.sort(newestFirst);
  out.questions.sort(newestFirst);
  out.confirmations.sort(newestFirst);
  out.contacts.sort(newestFirst);
  out.hidden.sort(newestFirst);
  return out;
}

/** True when a scan pass left nothing to read: every folder finished with
 * nothing carried over, and the pass wasn't cut short. */
export function scanIsDone(r: ScanResult): boolean {
  if (r.interrupted || (r.carried_over ?? 0) > 0) return false;
  return (r.folders ?? []).every((f) => f.status === "complete" && f.carried_over === 0);
}

/** The name of the mail site a link goes to, for the button that opens it. */
export function mailName(link: string): string {
  if (link.includes("mail.google.")) return "Gmail";
  if (link.includes("mail.aol.")) return "AOL Mail";
  if (link.includes("mail.yahoo.")) return "Yahoo Mail";
  return "your mail";
}

const EMAIL_LABEL: Record<string, string> = {
  interview: "Interview email",
  assessment: "Assessment email",
  offer: "Offer email",
  rejected: "Rejection email",
  applied: "Confirmation email",
  recruiter: "Recruiter email",
};

/** A few words for an email on a job's card ("Interview email"). */
export function emailLabel(eventType: string): string {
  return EMAIL_LABEL[eventType] ?? "Email";
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A moment as a person says it: "Today 9:14 AM", "Yesterday 4:02 PM",
 * "Mon 9:14 AM" within a week, then "Nov 12". Days are calendar days. */
export function whenText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const dayOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayOf(now) - dayOf(d)) / 86_400_000);
  if (days <= 0) return `Today ${clock(d)}`;
  if (days === 1) return `Yesterday ${clock(d)}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${clock(d)}`;
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** When an email arrived. Emails recorded before the app kept their date only
 * have the time a scan found them, and say so. */
export function emailWhen(
  ev: { email_date?: string | null; created_at: string },
  now: Date = new Date(),
): string {
  return ev.email_date ? whenText(ev.email_date, now) : `Found ${whenText(ev.created_at, now)}`;
}
