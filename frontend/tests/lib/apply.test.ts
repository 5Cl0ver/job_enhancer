import { describe, expect, it } from "vitest";
import {
  type ApplyRun,
  applyLine,
  bannerLine,
  carryOnLine,
  runCode,
  currentStep,
  latestPages,
  checkRows,
  fixLine,
  needsYou,
  normQ,
  pageAnswers,
  sheetFromPages,
  sourceOf,
  statusLine,
  tagOf,
} from "@/lib/apply";

const base: ApplyRun = {
  id: "r1",
  status: "waiting",
  job: { job_id: "s1", listing_id: "l1", title: "IT Engineer", company: "Acme", location: "" },
  apply_url: "https://acme.example/apply",
  created_at: "2026-11-24T10:00:00Z",
  finished_at: null,
  questions_open: 0,
  help: null,
  review: null,
  note: null,
  questions: [],
  answers_done: false,
  pages: [],
  resume_id: null,
  document_id: null,
  events: [],
  started_at: null,
};

const page = (n: number, url: string, extra = {}) => ({
  n,
  url,
  title: `P${n}`,
  answers: [],
  jc_answers: [],
  photo_ids: [],
  photo: "taken" as const,
  reason: null,
  at: "",
  round: 1,
  last: false,
  ...extra,
});

describe("where an application is", () => {
  it("maps each status to one of the six steps", () => {
    expect(currentStep(base)).toBe("start");
    expect(currentStep({ ...base, status: "questions" })).toBe("questions");
    expect(currentStep({ ...base, status: "writing" })).toBe("resume");
    expect(currentStep({ ...base, status: "filling", resume_id: "x" })).toBe("application");
    expect(currentStep({ ...base, status: "needs_you" })).toBe("start");
    expect(currentStep({ ...base, status: "review" })).toBe("review");
    expect(currentStep({ ...base, status: "sent" })).toBe("sent");
  });

  it("a stopped run stays at the step it got to, never Sent", () => {
    expect(currentStep({ ...base, status: "stopped" })).toBe("start");
    expect(currentStep({ ...base, status: "stopped", questions: [{ id: "q", question: "Q?", why: null, answer: null, skipped: false }] })).toBe("questions");
    expect(currentStep({ ...base, status: "not_sent", pages: [page(1, "u")] })).toBe("application");
    expect(statusLine({ ...base, status: "needs_you", help: { kind: "sign_in", what: "x", at: "", done_at: "now" } })).toBe(
      "Claude is picking it up…",
    );
  });

  it("says it in plain words", () => {
    expect(statusLine({ ...base, status: "questions", questions_open: 4 })).toBe("Claude has 4 questions for you");
    expect(statusLine({ ...base, status: "not_sent", note: "Posting closed" })).toBe("Not sent: Posting closed");
    expect(statusLine({ ...base, status: "review" })).toBe("Ready for your review");
  });

  it("knows when it's waiting for the user (the banner)", () => {
    expect(needsYou(base)).toBe(false);
    expect(needsYou({ ...base, status: "questions", questions_open: 2 })).toBe(true);
    const help = { kind: "sign_in" as const, what: "Sign in to Workday.", at: "", done_at: null };
    expect(needsYou({ ...base, status: "needs_you", help })).toBe(true);
    expect(needsYou({ ...base, status: "needs_you", help: { ...help, done_at: "x" } })).toBe(false);
    const review = { round: 1, decision: null, note: null, by: null, at: null };
    expect(needsYou({ ...base, status: "review", review })).toBe(true);
    expect(needsYou({ ...base, status: "review", review: { ...review, decision: "submit" as const } })).toBe(false);
    expect(bannerLine({ ...base, status: "needs_you", help })).toBe("Claude needs you: Sign in to Workday.");
    expect(bannerLine({ ...base, status: "questions", questions_open: 1 })).toBe(
      "Claude has 1 question for you: IT Engineer at Acme",
    );
    // Page by page (spec 033): a finished step waits for the owner's look.
    const paused = { ...base, status: "filling" as const, paused_step: "my information", paused_title: "My Information" };
    expect(needsYou(paused)).toBe(true);
    expect(needsYou({ ...paused, paused_step: null })).toBe(false);
    expect(statusLine(paused)).toBe("Look over My Information");
    expect(bannerLine(paused)).toBe("Look over My Information: IT Engineer at Acme");
  });

  it("builds one sheet from older runs' pages, a redone step once (spec 033)", () => {
    const vet = { q: "Veteran status", a: "No", guess: true };
    const sheet = sheetFromPages([
      page(4, "u", { title: "Voluntary Disclosures", answers: [vet] }),
      page(5, "u", { title: "Voluntary Disclosures", answers: [{ ...vet, guess: false }] }),
    ]);
    expect(sheet.steps.map((s) => [s.title, s.rows.length])).toEqual([["Voluntary Disclosures", 1]]);
    expect(tagOf(sheet.steps[0].rows[0])).toBe(null);
    expect(normQ("Veteran Status *")).toBe(normQ("veteran status (Required)"));
  });

  it("says where each fix stands (spec 033)", () => {
    const fix = { id: "f", step: "s", q: "City", k: 1, now: "Salem", to: "Portland", at: "" };
    expect(fixLine({ ...fix, status: "waiting" })).toBe("→ Portland (waiting)");
    expect(fixLine({ ...fix, status: "sent", claude_done: "t" })).toBe("→ Portland (Claude says done)");
    expect(fixLine({ ...fix, status: "done" })).toBe("→ Portland (done)");
    expect(fixLine({ ...fix, status: "done", already: true })).toBe("→ Portland (already that)");
    expect(fixLine({ ...fix, status: "gone" })).toBe("Couldn't apply: box gone");
  });
});

describe("pages", () => {
  it("shows Job Catcher's reading of the page, marking what Claude wrote", () => {
    const p = page(1, "u", {
      answers: [{ q: "Why Acme?", a: "Because", claude: true }],
      jc_answers: [{ q: "Why Acme?", a: "Because…" }, { q: "Name", a: "Sam" }],
    });
    expect(pageAnswers(p)).toEqual([
      { q: "Why Acme?", a: "Because…", claude: true },
      { q: "Name", a: "Sam" },
    ]);
    expect(pageAnswers(page(2, "u", { answers: [{ q: "A", a: "b" }] }))).toEqual([{ q: "A", a: "b" }]);
  });

  it("a fix's redone page replaces the old one", () => {
    const pages = [
      page(1, "https://x/a", { title: "Info" }),
      page(2, "https://x/b", { title: "Review" }),
      page(3, "https://x/a#fix", { title: "Info", round: 2 }),
    ];
    expect(latestPages(pages).map((p) => p.n)).toEqual([2, 3]);
  });

  it("keeps every step of an application that never changes its address", () => {
    const one = "https://acme.wd1.myworkdayjobs.com/apply";
    const pages = [
      page(1, one, { title: "My Information" }),
      page(2, one, { title: "My Experience" }),
      page(3, one, { title: "Review" }),
    ];
    expect(latestPages(pages).map((p) => p.n)).toEqual([1, 2, 3]);
  });
});

describe("best judgment (spec 026)", () => {
  it("says who put each answer there, most important first", () => {
    expect(sourceOf({ q: "a", a: "b", agreement: true, guess: true })).toBe("agreement");
    expect(sourceOf({ q: "a", a: "b", guess: true, claude: true })).toBe("guess");
    expect(sourceOf({ q: "a", a: "b", claude: true })).toBe("claude");
    expect(sourceOf({ q: "a", a: "b", by: "job_catcher" })).toBe("job_catcher");
    expect(sourceOf({ q: "a", a: "b" })).toBe("page");
  });

  it("keeps Claude's marks on Job Catcher's reading of the page", () => {
    const p = page(1, "https://a.example/1", {
      answers: [
        { q: "Prefix", a: "Mr.", guess: true },
        { q: "I agree", a: "Yes", agreement: true },
        { q: "First name", a: "Sam", by: "job_catcher" },
      ],
      jc_answers: [
        { q: "Prefix", a: "Mr." },
        { q: "I agree", a: "Checked" },
        { q: "First name", a: "Sam" },
      ],
    });
    expect(pageAnswers(p)).toEqual([
      { q: "Prefix", a: "Mr.", guess: true },
      { q: "I agree", a: "Checked", agreement: true },
      { q: "First name", a: "Sam", by: "job_catcher" },
    ]);
  });

  it("puts agreements, then guesses, then empty boxes first, every one of them (spec 033)", () => {
    const sheet = sheetFromPages([
      page(1, "https://a.example/1", {
        title: "My Experience",
        answers: [
          { q: "First name", a: "Sam" },
          { q: "Job Title", a: "" },
          { q: "Prefix", a: "Mr.", guess: true },
          { q: "Job Title", a: "" },
        ],
      }),
      page(2, "https://a.example/2", { title: "Terms", answers: [{ q: "I agree", a: "Yes", agreement: true }] }),
      page(3, "https://a.example/3", { title: "Consent", answers: [{ q: "I agree", a: "Yes", agreement: true }] }),
    ]);
    expect(checkRows(sheet).map((x) => `${x.step.title}:${x.row.q}:${x.k}`)).toEqual([
      "Terms:I agree:1",
      "Consent:I agree:1",
      "My Experience:Prefix:1",
      "My Experience:Job Title:1",
      "My Experience:Job Title:2",
    ]);
  });

  it("a résumé waiting for a look is the user's turn", () => {
    const run = {
      ...base,
      status: "resume_review" as const,
      resume_check: { round: 1, decision: null, note: null, at: null },
    };
    expect(needsYou(run)).toBe(true);
    expect(statusLine(run)).toBe("Your résumé is ready to look over");
    expect(bannerLine(run)).toBe("Look over your résumé: IT Engineer at Acme");
    expect(currentStep(run)).toBe("resume");
    const changing = { ...run, resume_check: { ...run.resume_check, decision: "change" as const } };
    expect(needsYou(changing)).toBe(false);
    expect(statusLine(changing)).toBe("Claude is changing your résumé…");
  });
});

describe("the start lines carry the run (spec 036)", () => {
  const run = {
    id: "1a2b3c4d-0000-4000-8000-000000000000",
    job: { job_id: "s1", listing_id: "l1", title: "Help Desk Analyst", company: "Acme", location: "" },
  };

  it("names the job and the run's code", () => {
    expect(runCode(run.id)).toBe("1a2b3c4d");
    expect(applyLine(run)).toBe(
      'Apply to my job "Help Desk Analyst" at Acme with the Job Enhancer connector (run 1a2b3c4d).',
    );
    expect(carryOnLine(run)).toBe(
      'Carry on with my application to "Help Desk Analyst" at Acme with the Job Enhancer connector (run 1a2b3c4d).',
    );
  });

  it("still carries the code without a title", () => {
    const bare = { ...run, job: { ...run.job, title: "", company: "" } };
    expect(applyLine(bare)).toBe("Apply to my job with the Job Enhancer connector (run 1a2b3c4d).");
    expect(carryOnLine(bare)).toBe("Carry on with my application to my job with the Job Enhancer connector (run 1a2b3c4d).");
  });
});
