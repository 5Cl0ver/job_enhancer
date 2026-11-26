// Spec 020: correct a box once, right on every site. Invented people.
import { describe, expect, it } from "vitest";
import { learnKeyFor, learnedFor, resolve } from "../src/autofill/resolve.js";
import { profileKeyFor } from "../src/autofill/classify/profileKeys.js";
import { normalizeQuestion } from "../src/autofill/classify/answers.js";
import { promotions } from "../src/autofill/promote.js";

const field = (question, extra = {}) => ({ question, key: normalizeQuestion(question), kind: "text", hints: {}, ...extra });
const copy = (answers, values = {}) => ({ answers, values, site: "careers.example" });
const PROFILE = { first_name: ["Wren"], last_name: ["Calloway"], preferred_name: ["Wren"], email: ["wren@example.com"] };

describe("one key per kind of box", () => {
  it("every wording of preferred name is the same question", () => {
    for (const q of ["Preferred Name", "Preferred First Name", "Nickname", "What name do you go by?"]) {
      expect(learnKeyFor(field(q), "a.example")?.key).toBe("@preferred_name");
    }
  });

  it("a First Name box inside a Preferred name block is the preferred name", () => {
    const f = field("First Name", { hints: { group: "Preferred name" } });
    expect(profileKeyFor(f)).toBe("preferred_name");
    expect(profileKeyFor(field("First Name"))).toBe("first_name");
    expect(profileKeyFor(field("Last Name", { hints: { group: "Preferred name" } }))).toBe("preferred_last_name");
  });

  it("company-only questions stay with the company; essays are offered; agreements never", () => {
    expect(learnKeyFor(field("Have you worked for our company before?"), "opus.example")).toEqual({ scope: "site", key: "opus.example|have you worked for our company before" });
    expect(learnKeyFor(field("Why do you want to work here?", { kind: "textarea" }), "x")?.scope).toBe("essay");
    expect(learnKeyFor(field("What is your gender?"), "x")).toBeNull();
    expect(learnKeyFor(field("I agree to the terms", { kind: "checkbox" }), "x")).toBeNull();
    expect(learnKeyFor(field("How did you hear about us?"), "x")).toEqual({ scope: "all", key: "how did you hear about us" });
  });
});

describe("what's learned beats the profile", () => {
  it("a learned preferred name fills every preferred-name box, legal names keep the profile", () => {
    const answers = [{ question_key: "@preferred_name", answer: "Ren" }];
    for (const q of ["Preferred Name", "Preferred First Name", "Nickname"]) {
      const d = resolve(field(q), copy(answers, PROFILE));
      expect(d.values?.[0]).toBe("Ren");
      expect(d.source).toBe("learned");
    }
    expect(resolve(field("Legal First Name"), copy(answers, PROFILE)).values[0]).toBe("Wren");
  });

  it("this site's own answer comes first, then the kind of box, then the profile", () => {
    const answers = [
      { question_key: "@preferred_name", answer: "Ren" },
      { question_key: "careers.example|preferred name", answer: "W." },
    ];
    expect(resolve(field("Preferred Name"), copy(answers, PROFILE)).values[0]).toBe("W.");
    expect(resolve(field("Preferred Name"), { ...copy(answers, PROFILE), site: "other.example" }).values[0]).toBe("Ren");
  });

  it("a close rewording fills only after the profile; a near one is only offered", () => {
    const answers = [{ question_key: "which shift do you prefer working", answer: "Nights" }];
    const close = resolve(field("Which shift do you prefer working?"), copy(answers));
    expect(close.values[0]).toBe("Nights");
    const near = resolve(field("Which shift do you prefer to work?"), copy(answers));
    expect(near.values).toBeUndefined();
    expect(near.offer).toBe("Nights");
    // Pivot words still separate questions.
    const other = [{ question_key: "are you authorized to work in the united states", answer: "Yes" }];
    expect(learnedFor(field("Are you authorized to work in Canada?"), copy(other))).toBeNull();
  });
});

describe("answers taught on one site before spec 020 become answers everywhere", () => {
  // The owner's real shape, with an invented answer.
  const TAUGHT = [
    { site: "pacificoffice.example.com", fingerprint: { label: "", kind: "text" }, profile_key: "phone", answer: null },
    { site: "apply.talemetry.com", fingerprint: { label: "preferred name", kind: "text", section: "" }, answer: "Ren", updated_at: "2026-11-20T10:00:00Z" },
    { site: "job-boards.greenhouse.io/opalinepay", fingerprint: { label: "preferred name", kind: "text", section: "" }, answer: "Ren", updated_at: "2026-11-22T10:00:00Z" },
    { site: "acme.wd5.myworkdayjobs.com", fingerprint: { label: "first name", kind: "text", section: "" }, answer: "Ren", updated_at: "2026-11-23T10:00:00Z" },
    { site: "career5.successfactors.eu", fingerprint: { label: "preferred first name", kind: "text", section: "profile information" }, answer: "Ren", updated_at: "2026-11-24T08:00:00Z" },
  ];

  it("gives one preferred-name answer and never touches the legal first name", () => {
    const out = promotions(TAUGHT, []);
    expect(out).toEqual([{ question_key: "@preferred_name", question_text: "preferred first name", answer: "Ren" }]);
    expect(out.some((x) => x.question_key === "@first_name")).toBe(false);
  });

  it("a Workday First Name box in the Preferred name block does count", () => {
    const t = [{ site: "acme.wd5.myworkdayjobs.com", fingerprint: { label: "first name", kind: "text", section: "preferred name" }, answer: "Ren" }];
    expect(promotions(t, [])).toEqual([{ question_key: "@preferred_name", question_text: "first name", answer: "Ren" }]);
  });

  it("the most recent wins; answers already saved are never overwritten", () => {
    const t = [
      { site: "a.example", fingerprint: { label: "how did you hear about us" }, answer: "LinkedIn", updated_at: "2026-11-01T00:00:00Z" },
      { site: "b.example", fingerprint: { label: "how did you hear about us" }, answer: "A friend", updated_at: "2026-11-05T00:00:00Z" },
    ];
    expect(promotions(t, [])[0].answer).toBe("A friend");
    // Taught on one site only: it may have been a box with no label of its own.
    expect(promotions([t[0]], [])).toEqual([]);
    expect(promotions(t, [{ question_key: "how did you hear about us" }])).toEqual([]);
  });

  it("company-only questions and past-job boxes stay where they were taught", () => {
    const t = [
      { site: "a.example", fingerprint: { label: "have you worked for our company before" }, answer: "No" },
      { site: "a.example", fingerprint: { label: "company", section: "work experience 1" }, answer: "Kelso Labs" },
    ];
    expect(promotions(t, [])).toEqual([]);
  });
});

describe("worked-out answers are never learned", () => {
  it("today's date is never saved and never taken from a saved answer", () => {
    expect(learnKeyFor(field("Today's Date"), "x")).toBeNull();
    const d = resolve(field("Today's Date"), copy([{ question_key: "@today_date", answer: "01/01/2020" }], { today_date: ["11/24/2026"] }));
    expect(d.values[0]).toBe("11/24/2026");
  });
});

describe("spec 020 correctness review", () => {
  it("'Preferred Qualifications' or 'Preferred contact method' never makes a legal name the preferred name", () => {
    for (const group of ["Preferred Qualifications", "Preferred contact method", ""]) {
      expect(profileKeyFor(field("First Name", { hints: { group, section: "preferred qualifications" } }))).toBe("first_name");
      expect(profileKeyFor(field("Legal Last Name", { hints: { group } }))).toBe("last_name");
    }
    expect(profileKeyFor(field("First Name", { hints: { group: "Preferred Name" } }))).toBe("preferred_name");
  });

  it("a salary question about this job stays with this site and fills back there", () => {
    const q = field("What is your desired salary for this role?");
    const learn = learnKeyFor(q, "x.example");
    expect(learn).toEqual({ scope: "site", key: "x.example|what is your desired salary for this role" });
    const answers = [{ question_key: learn.key, answer: "95000" }];
    const values = { desired_salary: ["80000"] };
    expect(resolve(q, { answers, values, site: "x.example" }).values[0]).toBe("95000");
    expect(resolve(q, { answers, values, site: "y.example" }).values[0]).toBe("80000");
  });

  it("alumni / former employee / worked at X before are about one company; EY is not GE", () => {
    for (const q of ["Are you an EY alumni?", "Are you a former employee?", "Have you previously been employed by us?", "Have you worked at Kelso Labs before?"]) {
      expect(learnKeyFor(field(q), "x.example")?.scope).toBe("site");
    }
    const answers = [{ question_key: "are you an ey alumni", answer: "Yes" }];
    expect(learnedFor(field("Are you a GE alumni?"), { answers })).toBeNull();
  });

  it("a learned value comes with its own other wordings, never the profile's old ones", () => {
    const d = resolve(field("State"), { answers: [{ question_key: "@state", answer: "Washington" }], values: { state: ["Oregon", "OR"] }, site: "x" });
    expect(d.values).toEqual(["Washington", "WA"]);
  });
});

describe("spec 020 correctness re-review", () => {
  it("a learned answer never brings back the profile's old value for a choice", () => {
    // With no profile value, the learned wording is used as it is.
    const sponsor = resolve(field("Are you authorized to work in the US?"), {
      answers: [{ question_key: "@authorized_to_work", answer: "No, I will need sponsorship" }],
      values: { authorized_to_work: [] },
      site: "x",
    });
    expect(sponsor.values).toEqual(["No, I will need sponsorship"]);
    // One that contradicts the profile's legal fact is only offered (spec 036).
    const against = resolve(field("Are you authorized to work in the US?"), {
      answers: [{ question_key: "@authorized_to_work", answer: "No, I will need sponsorship" }],
      values: { authorized_to_work: ["Yes"] },
      site: "x",
    });
    expect(against).toMatchObject({ skip: "unknown", offer: "No, I will need sponsorship" });
    const state = resolve(field("State"), { answers: [{ question_key: "@state", answer: "Washington" }], values: { state: ["Oregon", "OR"] }, site: "x" });
    expect(state.values).toEqual(["Washington", "WA"]);
  });

  it("pay is per company: a salary answer is kept for that site and never used on another", () => {
    const q = field("Desired salary");
    expect(learnKeyFor(q, "x.example")).toEqual({ scope: "site", key: "x.example|desired salary" });
    const answers = [{ question_key: "x.example|desired salary", answer: "95000" }];
    const values = { desired_salary: ["80000"] };
    expect(resolve(q, { answers, values, site: "x.example" }).values[0]).toBe("95000");
    expect(resolve(q, { answers: [...answers, { question_key: "@desired_salary", answer: "120000" }], values, site: "y.example" }).values[0]).toBe("80000");
  });
});

describe("a learned phone beside a country-code picker", () => {
  it("loses its country code, like the profile's", () => {
    const d = resolve(field("Phone Number", { hints: { dialCode: true } }), { answers: [{ question_key: "@phone", answer: "+1 (555) 010-2345" }], values: {}, site: "x" });
    expect(d.values[0]).toBe("(555) 010-2345");
  });
});
