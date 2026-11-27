/**
 * Apply with Claude (spec 022): what an application run looks like to the app,
 * its six steps, and the plain words for where it is.
 */

export type ApplyStatus =
  | "waiting"
  | "reading"
  | "questions"
  | "writing"
  | "resume_review"
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
  /** Claude's best guess, filled in for the user to check (spec 030). */
  guess?: string | null;
  /** Up to 4 quick answers. */
  choices?: string[];
  /** A fact only the user knows (experience, degrees…): highlighted. */
  only_you?: boolean;
  /** Which checklist it came in; the newest is the one on screen. */
  batch?: number;
  /** The user left Claude's guess as it was: used, not kept as told. */
  guessed?: boolean;
}

/** Something that went wrong, as Claude reported it (spec 030): a bug
 * report, with its context. */
export interface ApplyProblem {
  id: string;
  at: string;
  kind: "fill" | "job_catcher" | "tab" | "resume" | "site" | "other";
  what: string;
  page: string | null;
  count: number;
  status?: "open" | "fixed" | "ignored";
  site?: string | null;
  run_id?: string;
  job?: string;
  job_catcher?: string | null;
  playbook?: string | null;
}

export const PROBLEM_KIND: Record<ApplyProblem["kind"], string> = {
  job_catcher: "Job Catcher",
  resume: "Résumé",
  tab: "Lost tab",
  site: "Site",
  fill: "A box it couldn't fill",
  other: "Other",
};

/** The questions of Claude's newest checklist: the ones on screen. */
export function openBatch(questions: ApplyQuestion[]): ApplyQuestion[] {
  if (!questions.length) return [];
  const last = Math.max(...questions.map((q) => q.batch ?? 1));
  return questions.filter((q) => (q.batch ?? 1) === last);
}

export interface PageAnswer {
  q: string;
  a: string;
  claude?: boolean;
  /** Claude's best-judgment pick, not a fact from the profile (spec 026). */
  guess?: boolean;
  /** An agreement box Claude ticked: shown to the user before Submit. */
  agreement?: boolean;
  /** Job Catcher filled it. */
  by?: "job_catcher";
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
  /** What happened to the résumé on this page (spec 026). */
  resume?: "attached" | "unverified" | "no_box" | "no_file" | "failed";
}

export interface ApplyHelp {
  kind: "sign_in" | "sign_up" | "captcha" | "question" | "site" | "file" | "other";
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
  /** The answer bubbles the user changed or asked about (spec 026), as
   * stored: the page's text apart from the user's words (spec 030). */
  fixes?: ReviewFix[];
}

/** A sent fix as the server keeps it: the question and value are the
 * page's (from the run's own pages); only `to` / `ask` are the user's. */
export interface ReviewFix {
  page: number;
  box_on_page: string;
  now_on_page: string;
  to?: string;
  ask?: string;
}

/** One answer bubble the user changed ("to") or asked Claude about ("ask"). */
export interface Fix {
  page?: number;
  q: string;
  a: string;
  to?: string;
  ask?: string;
}

/** What's in the boxes of the page Claude is filling, read by Job Catcher
 * every few seconds (spec 026). */
export interface LiveFill {
  url: string;
  title: string;
  at: string;
  boxes: { q: string; a: string; by?: "job_catcher" }[];
}

/** The user's look at Claude's résumé before it's used (spec 025). */
export interface ApplyResumeCheck {
  round: number;
  decision: "use" | "change" | null;
  note: string | null;
  by?: "app" | "chat" | null;
  words?: string | null;
  at: string | null;
}

export interface ApplyMessage {
  id: string;
  by: "you" | "claude";
  text: string;
  at: string;
  read: boolean;
  /** A box changed while Claude fills (spec 030); its label is the page's. */
  fix?: { box_on_page: string; now_on_page: string; to?: string; ask?: string };
  /** The owner's waiting fixes, delivered together (spec 033). */
  fixes?: { id: string; step_on_page: string; box_on_page: string; now_on_page: string; to?: string; ask?: string }[];
}

export interface JobCatcherStatus {
  version: string | null;
  last_seen_at: string | null;
  ready: boolean;
  /** Its version is new enough (it may just be asleep). */
  new_enough?: boolean;
  seen_lately?: boolean;
  needs: string;
  /** New enough for the live view, the run's own résumé and the photo fix (spec 026). */
  live?: boolean;
  /** The newest release, and whether this Job Catcher is older (spec 034). */
  latest?: string | null;
  outdated?: boolean;
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
  resume_check?: ApplyResumeCheck | null;
  note: string | null;
  /** Claude's turn, and no word from it for 3 minutes (spec 023). */
  claude_stopped?: boolean;
  /** Submit was pressed but nothing confirmed it: ask the user. */
  ask_if_sent?: boolean;
  /** Page by page (pauses after each step) or Keep going (spec 033). */
  mode?: ApplyMode;
  /** The step the owner is asked to look over, and its name. */
  paused_step?: string | null;
  paused_title?: string | null;
}

export interface ApplyRun extends ApplyRunShort {
  questions: ApplyQuestion[];
  answers_done: boolean;
  pages: ApplyPage[];
  resume_id: string | null;
  document_id: string | null;
  /** The user picked their résumé at the start (spec 025). */
  resume_picked?: boolean;
  events: ApplyEvent[];
  started_at: string | null;
  messages?: ApplyMessage[];
  /** "Screen now" photos, newest first. */
  peeks?: { id: string; at: string }[];
  claude_at?: string | null;
  job_catcher?: JobCatcherStatus;
  /** The boxes being filled now (spec 026). */
  live?: LiveFill | null;
  /** The run's résumé, for Download (spec 026). */
  resume_file?: { id: string; filename: string } | null;
  /** What went wrong, as Claude reported it (spec 030). */
  problems?: ApplyProblem[];
  /** The cover letter that goes with it (spec 031): the job's pick. */
  cover_letter?: { id: string; filename: string } | null;
  /** Claude wrote a letter in this run (even if the job now has none). */
  cover_letter_written?: boolean;
  /** Every box so far, by step (spec 033). */
  sheet?: Sheet;
  /** The owner's changes, waiting for a checkpoint, then sent / done. */
  fixes?: RunFix[];
}

// --- Your application (spec 033) -------------------------------------------

export type ApplyMode = "page" | "keep";

export const MODE_LABEL: Record<ApplyMode, string> = { page: "Page by page", keep: "Keep going" };

export type RowTag = "changed" | "agreement" | "only_you" | "guess" | "empty" | "claude" | "profile";

/** One box: the question, what's in it, who put it there, and the form's
 * own choices when it has them. */
export interface SheetRow {
  q: string;
  a: string;
  tag?: RowTag | null;
  by?: "job_catcher";
  claude?: boolean;
  guess?: boolean;
  agreement?: boolean;
  only_you?: boolean;
  options?: string[];
  /** The form also takes typed words. */
  free?: boolean;
  fixed?: boolean;
}

export interface SheetStep {
  key: string;
  title: string;
  n: number;
  done: boolean;
  checked?: boolean;
  rows: SheetRow[];
}

/** The owner's last Continue (spec 038): did it reach Claude yet? */
export interface StepCheckState {
  step: string;
  title: string;
  at: string;
  /** Claude got the go-on. */
  read: boolean;
  read_at?: string | null;
  /** Claude went on to the next step (missing on a check from before spec 038). */
  moved_on?: boolean;
  /** Switched to Keep going while the step was paused. */
  keep?: boolean;
  fixes?: number;
}

export interface Sheet {
  steps: SheetStep[];
  /** The step being filled now. */
  current?: string | null;
  check?: StepCheckState | null;
}

/** gone: Claude couldn't find the box; declined: it chose not to (spec 038). */
export type FixStatus = "waiting" | "sent" | "done" | "gone" | "declined";

/** A change ("to") or a question ("ask") about one box, kept on the run. */
export interface RunFix {
  id: string;
  step: string;
  q: string;
  /** Which one, when a step asks the same question twice. */
  k: number;
  /** What was in the box when the fix was made. */
  now: string;
  to?: string | null;
  ask?: string | null;
  status: FixStatus;
  at: string;
  /** Claude says it made the change; done once Job Catcher reads it. */
  claude_done?: string | null;
  /** The box already held it when the fix was made. */
  already?: boolean;
  /** Why Claude didn't make it (declined). */
  why?: string | null;
  /** The owner made it themselves ("I did it myself"). */
  by_you?: boolean;
}

export const TAG_LABEL: Record<RowTag, string> = {
  changed: "You changed it",
  agreement: "You're agreeing",
  only_you: "Only you can answer",
  guess: "Claude guessed",
  empty: "Left empty",
  claude: "Claude wrote it",
  profile: "From your profile",
};

/** What the owner checks first, most important first. */
const CHECK_TAGS: RowTag[] = ["agreement", "only_you", "guess", "empty"];

/** A question's key: case, punctuation and "required" marks folded. */
export function normQ(q: string): string {
  return q
    .replace(/\(\s*required\s*\)|\brequired\b|\*/gi, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim();
}

export function tagOf(row: SheetRow): RowTag | null {
  if (row.tag !== undefined) return row.tag;
  const empty = !row.a.trim();
  if (row.fixed) return "changed";
  if (row.agreement) return "agreement";
  if (row.only_you && empty) return "only_you";
  if (row.guess) return "guess";
  if (empty) return "empty";
  if (row.claude) return "claude";
  if (row.by === "job_catcher") return "profile";
  return null;
}

/** Which one of its question a row is in its step (1 = the first). */
export function nthOf(step: SheetStep, i: number): number {
  const key = normQ(step.rows[i].q);
  return step.rows.slice(0, i + 1).filter((r) => normQ(r.q) === key).length;
}

/** The newest fix for one box: a waiting one first, else the latest. */
export function fixFor(fixes: RunFix[] | undefined, step: string, q: string, k: number): RunFix | undefined {
  const mine = (fixes ?? []).filter((f) => f.step === step && normQ(f.q) === normQ(q) && (f.k || 1) === k);
  return mine.find((f) => f.status === "waiting") ?? mine[mine.length - 1];
}

export const waitingFixes = (run: { fixes?: RunFix[] }) => (run.fixes ?? []).filter((f) => f.status === "waiting");

/** How a fix stands, in a few words: "→ No (waiting)". */
export function fixLine(fix: RunFix): string {
  if (fix.status === "gone") return "Couldn't apply: box gone";
  if (fix.status === "declined") return fix.why ? `Claude didn't do this: ${fix.why}` : "Claude didn't do this";
  const what = fix.to ? `→ ${fix.to}` : "Asked Claude";
  if (fix.status === "done" && fix.by_you) return `${what} (you did it)`;
  if (fix.status === "sent" && fix.claude_done) return `${what} (Claude says done)`;
  if (fix.status === "done" && fix.already) return `${what} (already that)`;
  return `${what} (${fix.status})`;
}

/** A fix Claude couldn't or wouldn't make: the owner can do it themselves. */
export const fixNotMade = (fix?: RunFix) => fix?.status === "gone" || fix?.status === "declined";

// Optional consent boxes (texts, marketing): Claude never ticks one by itself
// (spec 038), but a fix the owner asks for is their own decision.
const CONSENT = /\b(?:texts?|text messages?|sms|marketing|promotional|newsletters?|opt[- ]?in|subscribe|talent (?:community|network)|consent|job alerts?)\b/i;

/** A tick box (read as Yes / No) or a box asking for consent. */
export function isConsentBox(row: { q: string; a: string; options?: string[] }): boolean {
  if (CONSENT.test(row.q)) return true;
  return !row.options?.length && /^(?:yes|no)$/i.test(row.a.trim());
}

/** A sheet for a run from an older server: its pages, merged by step and
 * question. A page done again is the same step, never a second copy. */
export function sheetFromPages(pages: ApplyPage[]): Sheet {
  const steps: SheetStep[] = [];
  for (const page of [...pages].sort((a, b) => a.n - b.n)) {
    if (page.title === "Confirmation") continue;
    const answers = pageAnswers(page);
    const qs = new Set(answers.map((a) => normQ(a.q)).filter(Boolean));
    const overlap = (s: SheetStep) => {
      if (!qs.size) return 0;
      const have = new Set(s.rows.map((r) => normQ(r.q)));
      return [...qs].filter((q) => have.has(q)).length / qs.size;
    };
    // The same page done again: its title with nothing new on it, or a
    // near-total overlap (never a look-alike page, like an emergency contact).
    let step =
      [...steps].reverse().find((s) => s.title === page.title && (qs.size ? overlap(s) === 1 : !s.rows.length)) ??
      [...steps].reverse().find((s) => qs.size >= 3 && overlap(s) >= 0.8);
    if (!step) {
      step = { key: `page-${steps.length + 1}`, title: page.title, n: steps.length + 1, done: true, rows: [] };
      steps.push(step);
    }
    const seen = new Map<string, number>();
    for (const a of answers) {
      const key = normQ(a.q);
      if (!key) continue;
      const k = (seen.get(key) ?? 0) + 1;
      seen.set(key, k);
      const same = step.rows.filter((r) => normQ(r.q) === key);
      const row: SheetRow = { q: a.q, a: a.a, claude: a.claude, guess: a.guess, agreement: a.agreement, by: a.by };
      if (same.length >= k) Object.assign(same[k - 1], row);
      else step.rows.push(row);
    }
  }
  for (const s of steps) for (const r of s.rows) r.tag = tagOf({ ...r, tag: undefined });
  return { steps, current: steps[steps.length - 1]?.key ?? null };
}

/** The run's one sheet: the server's, else built from its pages. */
export function sheetOf(run: ApplyRun): Sheet {
  return run.sheet?.steps?.length ? run.sheet : sheetFromPages(run.pages);
}

export interface CheckRow {
  step: SheetStep;
  row: SheetRow;
  k: number;
}

/** Check these first (spec 033): every agreement, "only you", guess and
 * empty box (the sheet holds one row per step, question and order: each
 * job's "Job Title" and each step's "I agree" count), most important first. */
export function checkRows(sheet: Sheet): CheckRow[] {
  const out: CheckRow[] = [];
  for (const step of sheet.steps) {
    step.rows.forEach((row, i) => {
      const tag = tagOf(row);
      if (tag && CHECK_TAGS.includes(tag)) out.push({ step, row, k: nthOf(step, i) });
    });
  }
  return out.sort((x, y) => CHECK_TAGS.indexOf(tagOf(x.row)!) - CHECK_TAGS.indexOf(tagOf(y.row)!));
}

export function stepCounts(step: SheetStep) {
  return {
    filled: step.rows.filter((r) => r.a.trim()).length,
    toCheck: step.rows.filter((r) => {
      const t = tagOf(r);
      return !!t && CHECK_TAGS.includes(t);
    }).length,
  };
}

/** The run's short code (spec 036): the first 8 characters of its id. Claude
 * passes it as run_id, so it never carries on with another job's run. */
export function runCode(id: string): string {
  return id.slice(0, 8);
}

function whichJob(run: Pick<ApplyRunShort, "id" | "job">): string {
  const { title, company } = run.job;
  const job = title ? `"${title}"${company ? ` at ${company}` : ""}` : "";
  return job ? ` ${job}` : "";
}

/** What the user says to Claude to start: the job and the run's code (spec 036). */
export function applyLine(run: Pick<ApplyRunShort, "id" | "job">): string {
  return `Apply to my job${whichJob(run)} with the Job Enhancer connector (run ${runCode(run.id)}).`;
}

/** Said in a new Claude chat when the last one stopped: it picks up this run. */
export function carryOnLine(run: Pick<ApplyRunShort, "id" | "job">): string {
  return `Carry on with my application to${whichJob(run) || " my job"} with the Job Enhancer connector (run ${runCode(run.id)}).`;
}

const OPEN: ApplyStatus[] = [
  "waiting",
  "reading",
  "questions",
  "writing",
  "resume_review",
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
      // A checklist while filling is still the application (spec 030).
      return run.resume_id || run.pages.length ? "application" : "questions";
    case "writing":
    case "resume_review":
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
      return run.resume_check?.decision === "change" ? "Claude is changing your résumé…" : "Claude is writing your résumé…";
    case "resume_review":
      if (run.resume_check?.decision === "use") return "Claude is moving on to the application…";
      if (run.resume_check?.decision === "change") return "Claude is changing your résumé…";
      return "Your résumé is ready to look over";
    case "filling":
      return run.paused_step ? `Look over ${run.paused_title || "this step"}` : "Claude is filling the application…";
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
  if (run.status === "resume_review") return !run.resume_check?.decision;
  if (run.status === "needs_you") return !run.help?.done_at;
  if (run.status === "review") return !run.review?.decision;
  // Page by page (spec 033): a finished step waits for the owner's look.
  if (run.status === "filling") return !!run.paused_step;
  return false;
}

/** The banner's words: "Claude has 4 questions for you: IT Engineer at Acme". */
export function bannerLine(run: ApplyRunShort): string {
  const job = [run.job.title, run.job.company].filter(Boolean).join(" at ");
  if (run.status === "questions") return `${statusLine(run)}: ${job}`;
  if (run.status === "needs_you") return `Claude needs you: ${run.help?.what ?? job}`;
  if (run.status === "resume_review") return `Look over your résumé: ${job}`;
  if (run.ask_if_sent) return `Did it go through? ${job}`;
  if (run.status === "filling" && run.paused_step) return `Look over ${run.paused_title || "this step"}: ${job}`;
  return `Ready for your review: ${job}`;
}

/** The answers to show for a page: Job Catcher's reading of the page (what's
 * really in the boxes) when it has one, else what Claude said it entered.
 * Claude's own writing is marked either way. */
export function pageAnswers(page: ApplyPage): PageAnswer[] {
  if (!page.jc_answers.length) return page.answers;
  // Who put each answer there comes from Claude's list (spec 026).
  const said = new Map(page.answers.map((a) => [a.q.toLowerCase(), a]));
  return page.jc_answers.map((a) => {
    const c = said.get(a.q.toLowerCase());
    if (!c) return a;
    const flags: Partial<PageAnswer> = {};
    if (c.claude) flags.claude = true;
    if (c.guess) flags.guess = true;
    if (c.agreement) flags.agreement = true;
    if (c.by) flags.by = c.by;
    return { ...a, ...flags };
  });
}

export type AnswerSource = "agreement" | "guess" | "claude" | "job_catcher" | "page";

/** Who put an answer there, most important first. */
export function sourceOf(a: PageAnswer): AnswerSource {
  if (a.agreement) return "agreement";
  if (a.guess) return "guess";
  if (a.claude) return "claude";
  if (a.by === "job_catcher") return "job_catcher";
  return "page";
}

export const SOURCE_LABEL: Record<AnswerSource, string> = {
  agreement: "You're agreeing",
  guess: "Claude guessed",
  claude: "Claude wrote it",
  job_catcher: "Job Catcher",
  page: "On the page",
};

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
  file: "Attach a file",
  other: "Claude needs you",
};
