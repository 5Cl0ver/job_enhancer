// @vitest-environment happy-dom
// Spec 018: autofill memory. Company-specific questions, this site's answers
// first, saved essays never matched, and "retype your résumé" sections.
// Invented applicant only.
import { describe, expect, it } from "vitest";
import { isCompanySpecific } from "../src/autofill/classify/answers.js";
import { classifySections, createJobBlocks, jobPart, jobValues } from "../src/autofill/classify/jobHistory.js";
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
  const doc = parse(`<form><h1>Employment Application</h1>
    <section><h2>Personal Information</h2><label for="a">Address</label><input id="a"><label for="ph">Phone</label><input id="ph"></section>
    <section><h2>Employment History</h2>
      <div><h3>Employer 1</h3><label for="c1">Company Name</label><input id="c1"><label for="t1">Job Title</label><input id="t1"><label for="a1">Address</label><input id="a1">
        <label for="sm1">Start Month</label><input id="sm1"><label for="sy1">Start Year</label><input id="sy1"><label for="ep1">Employer Phone</label><input id="ep1"></div>
      <div><h3>Employer 2</h3><label for="c2">Company Name</label><input id="c2"></div></section>
    <section><h2>References</h2><label for="rn">Name</label><input id="rn"><label for="rp">Phone</label><input id="rp"><label for="re">Email</label><input id="re"></section></form>`);
  const fields = collectFields(doc, { visible: () => true });
  const byId = Object.fromEntries(fields.map((f) => [f.el.id, f]));
  const kinds = classifySections(fields);

  it("knows each box's section from the heading above it — the page title isn't a section", () => {
    expect(sectionHeading(byId.a.el)).toBe("Personal Information");
    expect(kinds.get(byId.a.id)).toBeUndefined();
    expect(kinds.get(byId.ph.id)).toBeUndefined();
    expect(kinds.get(byId.a1.id)).toBe("job");
    expect(kinds.get(byId.rp.id)).toBe("reference");
  });

  it("a new employer heading (or the same question again) starts the next job; Start Month + Year are one job", () => {
    const blockOf = createJobBlocks();
    const order = [byId.c1, byId.t1, byId.sm1, byId.sy1, byId.c2];
    expect(order.map((f) => blockOf(jobPart(f), f))).toEqual([0, 0, 0, 0, 1]);
  });

  it("an employer's address or phone is never a job part (never a company name)", () => {
    expect(jobPart(byId.a1)).toBe("");
    expect(jobPart(byId.ep1)).toBe("");
    expect(jobPart({ question: "Position Start Date" })).toBe("start");
    expect(jobPart({ question: "Role Description" })).toBe("");
    expect(jobPart({ question: "Are you willing to relocate?" })).toBe("");
  });

  it("dates in the forms boxes take", () => {
    const job = { start_month: 3, start_year: 2023 };
    expect(jobValues("start", job, { question: "Start Date", kind: "text" })).toEqual(["03/2023"]);
    expect(jobValues("start", job, { question: "Start", kind: "month" })).toEqual(["2023-03"]);
    expect(jobValues("start", job, { question: "Start Year", kind: "select" })).toEqual(["2023"]);
    expect(jobValues("start", job, { question: "Start Month", kind: "select" })[0]).toBe("March");
  });
});

describe("never a false section (the PR #36 review's cases)", () => {
  const kindsOf = (html) => {
    const fields = collectFields(parse(html), { visible: () => true });
    const k = classifySections(fields);
    return Object.fromEntries(fields.map((f) => [f.el.id || f.el.name, k.get(f.id) || ""]));
  };

  it("a MUI outlined box's hidden legend never makes the next box 'education'", () => {
    const k = kindsOf(`<form>
      <div><label for="edu">Highest Education Level</label><div><input id="edu"><fieldset aria-hidden="true"><legend><span>Highest Education Level</span></legend></fieldset></div></div>
      <div><label for="ph">Phone</label><div><input id="ph"><fieldset aria-hidden="true"><legend><span>Phone</span></legend></fieldset></div></div></form>`);
    expect(k.ph).toBe("");
  });

  it("a question's legend never makes the next questions a past job", () => {
    const k = kindsOf(`<form><fieldset><legend>Do you have experience with Salesforce?</legend>
      <label><input type="radio" name="sf" value="y"> Yes</label><label><input type="radio" name="sf" value="n"> No</label></fieldset>
      <label for="hear">How did you hear about this position?</label><input id="hear"><label for="ph">Phone</label><input id="ph"></form>`);
    expect(k.hear).toBe("");
    expect(k.ph).toBe("");
  });

  it("a job description saying 'Experience' above the form never touches the form", () => {
    const k = kindsOf(`<div class="posting"><h3>Experience</h3><p>3+ years. Equal Opportunity Employer.</p></div>
      <form><label for="fn">First name</label><input id="fn"><label for="em">Email</label><input id="em"><label for="ph">Phone</label><input id="ph"></form>`);
    expect(k).toEqual({ fn: "", em: "", ph: "" });
  });

  it("a section titled 'Experience' with only questions (no company box) isn't a past job", () => {
    const k = kindsOf(`<form><h2>Experience</h2><label for="yrs">Years of experience with SQL</label><input id="yrs"><label for="ph">Phone</label><input id="ph"></form>`);
    expect(k).toEqual({ yrs: "", ph: "" });
  });
});

describe("where one company ends and another begins", async () => {
  const { siteKey, companyKnown } = await import("../src/autofill/hosts.js");
  it("Paycom and ADP: the company's key in the address", () => {
    expect(siteKey("https://www.paycomonline.net/v4/ats/web.php/portal/ABC123/career-page")).toBe("www.paycomonline.net/ABC123");
    expect(siteKey("https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=1&clientkey=XYZ")).toBe("www.paycomonline.net/XYZ");
    expect(siteKey("https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=c-9")).toBe("workforcenow.adp.com/c-9");
  });
  it("Indeed's and LinkedIn's apply pages can't tell companies apart", () => {
    expect(companyKnown("https://smartapply.indeed.com/beta/indeedapply/form")).toBe(false);
    expect(companyKnown("https://www.linkedin.com/jobs/view/1")).toBe(false);
    expect(companyKnown("https://jobs.lever.co/quillstone/1")).toBe(true);
  });
});
