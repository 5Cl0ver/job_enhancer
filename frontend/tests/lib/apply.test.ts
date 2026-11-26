import { describe, expect, it } from "vitest";
import {
  type ApplyRun,
  bannerLine,
  checkFirst,
  currentStep,
  latestPages,
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
      page(5, "u", { title: "Page 5", answers: [{ ...vet, guess: false }] }),
    ]);
    expect(sheet.steps.map((s) => [s.title, s.rows.length])).toEqual([["Voluntary Disclosures", 1]]);
    expect(tagOf(sheet.steps[0].rows[0])).toBe(null);
    expect(normQ("Veteran Status *")).toBe(normQ("veteran status (Required)"));
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

  it("puts agreements, then guesses, then empty boxes first", () => {
    const pages = [
      page(1, "https://a.example/1", {
        answers: [
          { q: "First name", a: "Sam" },
          { q: "Phone ext", a: "" },
          { q: "Prefix", a: "Mr.", guess: true },
        ],
      }),
      page(2, "https://a.example/2", { answers: [{ q: "I certify", a: "Yes", agreement: true }] }),
    ];
    expect(checkFirst(pages).map((x) => `${x.page.n}:${x.answer.q}`)).toEqual([
      "2:I certify",
      "1:Prefix",
      "1:Phone ext",
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
