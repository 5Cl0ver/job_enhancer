/**
 * Apply with Claude (spec 022): what an application run looks like to the app,
 * its six steps, and the plain words for where it is.
 */

export type ApplyStatus =
  | "waiting"
  | "reading"
  | "questions"
  | "writing"
  | "filling"
  | "needs_you"
  | "review"
  | "submitting"
  | "sent"
  | "not_sent"
  | "stopped";

export interface ApplyQuestion {
  id: string;
  question: string;
  why: string | null;
  answer: string | null;
  skipped: boolean;
  source?: "app" | "chat" | null;
}

export interface PageAnswer {
  q: string;
  a: string;
  claude?: boolean;
}

export interface ApplyPage {
  n: number;
  url: string;
  title: string;
  answers: PageAnswer[];
  jc_answers: PageAnswer[];
  photo_ids: string[];
  photo: "waiting" | "taken" | "missing";
  reason: string | null;
  at: string;
  round: number;
  last: boolean;
}

export interface ApplyHelp {
  kind: "sign_in" | "sign_up" | "captcha" | "question" | "site" | "other";
  what: string;
  at: string;
  done_at: string | null;
  /** Up to 4 quick answers Claude offers (spec 023). */
  choices?: string[];
  /** What the user answered from the app. */
  reply?: string | null;
  /** The photo of this screen asked for with the question. */
  peek_request?: string | null;
}

export interface ApplyReview {
  round: number;
  decision: "submit" | "fix" | "self" | null;
  note: string | null;
  by: "app" | "chat" | null;
  /** What the user typed to Claude, for a decision made in a chat. */
  words?: string | null;
  at: string | null;
  /** Submit was pressed in the application's tab (not yet sure it went). */
  pressed_at?: string | null;
  /** Job Catcher saw the confirmation page (spec 023). */
  confirmed?: { words: string; at: string } | null;
}

export interface ApplyMessage {
  id: string;
  by: "you" | "claude";
  text: string;
  at: string;
  read: boolean;
}

export interface JobCatcherStatus {
  version: string | null;
  last_seen_at: string | null;
  ready: boolean;
  /** Its version is new enough (it may just be asleep). */
  new_enough?: boolean;
  seen_lately?: boolean;
  needs: string;
}

export interface ApplyEvent {
  at: string;
  kind: string;
  text: string;
}

export interface ApplyRunShort {
  id: string;
  status: ApplyStatus;
  job: { job_id: string; listing_id: string; title: string; company: string; location: string };
  apply_url: string;
  created_at: string;
  finished_at: string | null;
  questions_open: number;
  help: ApplyHelp | null;
  review: ApplyReview | null;
  note: string | null;
  /** Claude's turn, and no word from it for 3 minutes (spec 023). */
  claude_stopped?: boolean;
  /** Submit was pressed but nothing confirmed it: ask the user. */
  ask_if_sent?: boolean;
}

export interface ApplyRun extends ApplyRunShort {
  questions: ApplyQuestion[];
  answers_done: boolean;
  pages: ApplyPage[];
  resume_id: string | null;
  document_id: string | null;
  events: ApplyEvent[];
  started_at: string | null;
  messages?: ApplyMessage[];
  /** "Screen now" photos, newest first. */
  peeks?: { id: string; at: string }[];
  claude_at?: string | null;
  job_catcher?: JobCatcherStatus;
}

export const APPLY_LINE = "Apply to my job with the Job Enhancer connector.";
/** Said in a new Claude chat when the last one stopped: it picks up the run. */
export const CARRY_ON_LINE = "Carry on with my application with the Job Enhancer connector.";

const OPEN: ApplyStatus[] = [
  "waiting",
  "reading",
  "questions",
  "writing",
  "filling",
  "needs_you",
  "review",
  "submitting",
];

export const isOpenApply = (run: { status: ApplyStatus }) => OPEN.includes(run.status);

export type StepKey = "start" | "questions" | "resume" | "application" | "review" | "sent";

export const STEPS: { key: StepKey; label: string }[] = [
  { key: "start", label: "Start" },
  { key: "questions", label: "Questions" },
  { key: "resume", label: "Résumé" },
  { key: "application", label: "Application" },
  { key: "review", label: "Your review" },
  { key: "sent", label: "Sent" },
];

/** Which of the six steps a run is on. */
export function currentStep(run: ApplyRun): StepKey {
  switch (run.status) {
    case "waiting":
    case "reading":
      return "start";
    case "questions":
      return "questions";
    case "writing":
      return "resume";
    case "filling":
    case "needs_you":
      // Help asked before the résumé is still about getting started.
      return run.resume_id || run.pages.length ? "application" : "start";
    case "review":
    case "submitting":
      return "review";
    case "sent":
      return "sent";
    default:
      // Stopped or not sent: the last step it really got to, never "Sent".
      if (run.review) return "review";
      if (run.pages.length) return "application";
      if (run.resume_id) return "resume";
      if (run.questions.length) return "questions";
      return "start";
  }
}

export function stepIndex(step: StepKey): number {
  return STEPS.findIndex((s) => s.key === step);
}

/** One line: where the run is, in plain words. */
export function statusLine(run: ApplyRunShort): string {
  switch (run.status) {
    case "waiting":
      return "Waiting for Claude…";
    case "reading":
      return "Claude is reading the job…";
    case "questions":
      return run.questions_open
        ? `Claude has ${run.questions_open} question${run.questions_open === 1 ? "" : "s"} for you`
        : "Claude is reading your answers…";
    case "writing":
      return "Claude is writing your résumé…";
    case "filling":
      return "Claude is filling the application…";
    case "needs_you":
      return run.help?.done_at ? "Claude is picking it up…" : "Claude needs you";
    case "review":
      return run.review?.decision ? "Claude is acting on your answer…" : "Ready for your review";
    case "submitting":
      return run.ask_if_sent ? "Did it go through?" : "Claude is pressing Submit…";
    case "sent":
      return run.review?.confirmed ? "Sent, confirmed" : "Sent";
    case "not_sent":
      return run.note ? `Not sent: ${run.note}` : "Not sent";
    case "stopped":
      return run.note ? `Stopped: ${run.note}` : "Stopped";
  }
}

/** Is the run waiting for the user right now (the top banner)? */
export function needsYou(run: ApplyRunShort): boolean {
  if (run.ask_if_sent) return true;
  if (run.status === "questions") return run.questions_open > 0;
  if (run.status === "needs_you") return !run.help?.done_at;
  if (run.status === "review") return !run.review?.decision;
  return false;
}

/** The banner's words: "Claude has 4 questions for you: IT Engineer at Acme". */
export function bannerLine(run: ApplyRunShort): string {
  const job = [run.job.title, run.job.company].filter(Boolean).join(" at ");
  if (run.status === "questions") return `${statusLine(run)}: ${job}`;
  if (run.status === "needs_you") return `Claude needs you: ${run.help?.what ?? job}`;
  if (run.ask_if_sent) return `Did it go through? ${job}`;
  return `Ready for your review: ${job}`;
}

/** The answers to show for a page: Job Catcher's reading of the page (what's
 * really in the boxes) when it has one, else what Claude said it entered.
 * Claude's own writing is marked either way. */
export function pageAnswers(page: ApplyPage): PageAnswer[] {
  if (!page.jc_answers.length) return page.answers;
  const wrote = new Set(page.answers.filter((a) => a.claude).map((a) => a.q.toLowerCase()));
  return page.jc_answers.map((a) => (wrote.has(a.q.toLowerCase()) ? { ...a, claude: true } : a));
}

/** The pages to review, in order: every page of the latest round, plus the
 * earlier rounds' pages a fix didn't redo. Never merged within a round: many
 * applications keep one address for every step. */
export function latestPages(pages: ApplyPage[]): ApplyPage[] {
  const key = (p: ApplyPage) => `${p.url.split("#")[0]} | ${p.title}`;
  const out: ApplyPage[] = [];
  for (const p of pages) {
    const redone = pages.some((q) => q.round > p.round && key(q) === key(p));
    if (!redone) out.push(p);
  }
  return out.sort((a, b) => a.n - b.n);
}

export const HELP_TITLES: Record<ApplyHelp["kind"], string> = {
  sign_in: "Sign in",
  sign_up: "Make an account",
  captcha: "Prove you're not a robot",
  question: "A question only you can answer",
  site: "The site needs you",
  other: "Claude needs you",
};
