import { describe, expect, it } from "vitest";
import {
  type ApplyRun,
  bannerLine,
  currentStep,
  latestPages,
  needsYou,
  pageAnswers,
  statusLine,
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
