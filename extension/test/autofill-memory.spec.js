// @vitest-environment happy-dom
// Spec 018: autofill memory. Company-specific questions, this site's answers
// first, saved essays never matched, and "retype your résumé" sections.
// Invented applicant only.
import { describe, expect, it } from "vitest";
import { isCompanySpecific } from "../src/autofill/classify/answers.js";
import { createJobBlocks, jobPart, jobValues, sectionKind } from "../src/autofill/classify/jobHistory.js";
import { learnedFor } from "../src/autofill/resolve.js";
import { collectFields, sectionHeading } from "../src/autofill/scan.js";

const parse = (html) => new DOMParser().parseFromString(html, "text/html");

describe("company-specific questions are kept for that company", () => {
  it.each([
    ["Have you ever worked for our company before?", true],
    ["Have you previously been employed with Opus?", true],
    ["Desired salary", true],
    ["Do you have relatives who work here?", true],
    ["How did you hear about this opportunity?", false],
    ["Which shift do you prefer?", false],
    ["Are you willing to travel?", false],
  ])("%s → %s", (q, want) => expect(isCompanySpecific(q)).toBe(want));
});

describe("remembered answers: this site's first, company ones only there, essays never", () => {
  const answers = [
    { question_key: "which shift do you prefer", answer: "Mornings" },
    { question_key: "opus.example|which shift do you prefer", answer: "Nights" },
    { question_key: "opus.example|have you ever worked for our company before", answer: "Yes" },
    { question_key: "essay|why do you want to work here", answer: "Because…" },
  ];
  const field = (q, key) => ({ question: q, key });
  it("this site's own answer wins", () => {
    expect(learnedFor(field("Which shift do you prefer?", "which shift do you prefer"), { answers, site: "opus.example" }).answer).toBe("Nights");
    expect(learnedFor(field("Which shift do you prefer?", "which shift do you prefer"), { answers, site: "other.example" }).answer).toBe("Mornings");
  });
  it("a company-specific answer never crosses to another company", () => {
    const q = field("Have you ever worked for our company before?", "have you ever worked for our company before");
    expect(learnedFor(q, { answers, site: "opus.example" }).answer).toBe("Yes");
    expect(learnedFor(q, { answers, site: "other.example" })).toBeNull();
  });
  it("a saved essay is never matched", () => {
    expect(learnedFor(field("Why do you want to work here?", "why do you want to work here"), { answers, site: "x" })).toBeNull();
  });
});

describe("retype-your-résumé sections", () => {
  const doc = parse(`<h1>Employment Application</h1>
    <section><h2>Personal Information</h2><label for="a">Address</label><input id="a"></section>
    <section><h2>Employment History</h2>
      <div><h3>Employer 1</h3><label for="c1">Company Name</label><input id="c1"><label for="t1">Job Title</label><input id="t1"><label for="a1">Address</label><input id="a1"></div>
      <div><h3>Employer 2</h3><label for="c2">Company Name</label><input id="c2"></div></section>
    <fieldset><legend>References</legend><label for="rn">Name</label><input id="rn"><label for="rp">Phone</label><input id="rp"><label for="re">Email</label><input id="re"></fieldset>`);
  const byId = Object.fromEntries(collectFields(doc, { visible: () => true }).map((f) => [f.el.id, f]));

  it("knows each box's section from the heading above it — the page title isn't a section", () => {
    expect(sectionHeading(byId.a.el)).toBe("Personal Information");
    expect(sectionKind(byId.a)).toBe("");
    expect(sectionKind(byId.a1)).toBe("job");
    expect(sectionKind(byId.rp)).toBe("reference");
  });

  it("a part asked again starts the next job", () => {
    const blockOf = createJobBlocks();
    expect([byId.c1, byId.t1, byId.c2].map((f) => blockOf(jobPart(f)))).toEqual([0, 0, 1]);
    expect(jobPart(byId.a1)).toBe(""); // the employer's address: never yours, never guessed
  });

  it("dates in the forms boxes take", () => {
    const job = { start_month: 3, start_year: 2023 };
    expect(jobValues("start", job, { question: "Start Date", kind: "text" })).toEqual(["03/2023"]);
    expect(jobValues("start", job, { question: "Start", kind: "month" })).toEqual(["2023-03"]);
    expect(jobValues("start", job, { question: "Start Year", kind: "select" })).toEqual(["2023"]);
    expect(jobValues("start", job, { question: "Start Month", kind: "select" })[0]).toBe("March");
  });
});
