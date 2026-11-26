// Spec 034: Job Catcher on Workday. The pure rules, against the Workday lab
// copies (test/lab/workday-*.html): a Create Account page fills the email
// only; "have you worked here before?" from the job history; only real
// agreements are the user's; checkboxes of one question are one list; the
// job read off a Workday page or address; the submit tracker. The real
// browser runs the same pages in e2e/workday-034.spec.js. Invented names only.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { companyCore, formerEmployerAnswer, formerEmployerQuestion, inHistory, sameCompany } from "../src/autofill/classify/formerEmployer.js";
import { guardReason, profileValues } from "../src/autofill/classify/profileKeys.js";
import { collectFields, hasFormHere, isSignupPage, looksLikeApplication } from "../src/autofill/scan.js";
import { learnKeyFor, resolve } from "../src/autofill/resolve.js";
import { createSession, pointRefusal } from "../src/autofill/session.js";
import { jobInfo, tenantCompany, watchForSubmit, workdayAddress } from "../src/autofill/track.js";
import { extractJob } from "../src/extract/index.js";
import { readAgainSays } from "../panel/src/lib/readAgain.ts";
import { detectContext } from "../panel/src/lib/context.ts";

const here = dirname(fileURLToPath(import.meta.url));
const JOB = "https://northwind.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Applications-Developer-II_JR-1001";
const APPLY = `${JOB}/apply/applyManually`;
const SITE = "northwind.wd5.myworkdayjobs.com";

/** A lab page at an address (its own scripts left out: only the markup counts here). */
function lab(name, url = APPLY) {
  const html = readFileSync(join(here, "lab", name), "utf8").replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, "");
  const win = new Window({ url });
  win.document.write(html);
  return win.document;
}
const page = (html, url = APPLY) => {
  const win = new Window({ url });
  win.document.write(html);
  return win.document;
};

const PROFILE = { first_name: "Alex", last_name: "Rivera", phone: "555-010-2233", address_line1: "40 Alder St", city: "Portland", state: "OR", postal_code: null, country: "United States" };
const EMAIL = "alex.rivera@example.com";
const HISTORY = { work: [{ title: "Support Engineer", company: "Tidewell Labs Inc.", current: true }, { title: "Contractor", company: "Self-employed" }] };
const copy = (extra = {}) => ({ values: profileValues(PROFILE, EMAIL, new Date("2026-11-25T12:00:00")), answers: [], history: HISTORY, company: "Northwind", ...extra });
const fieldsOf = (doc) => collectFields(doc, { visible: () => true });
const session = (doc, send = vi.fn(async () => ({}))) => createSession({ doc, send, visible: () => true });
const appCheck = { isIdentity: () => false, isMapped: () => false };

describe("US2: Workday's Create Account page", () => {
  it("is a sign-up form on an application host: a form, and an application", () => {
    const doc = lab("workday-signup.html");
    const fields = fieldsOf(doc);
    expect(fields.some((f) => f.hints.type === "password")).toBe(false); // passwords are never even read
    expect(isSignupPage(fields)).toBe(true);
    expect(hasFormHere(fields, { isApplication: () => false })).toBe(true);
    expect(looksLikeApplication(fields, appCheck)).toBe(true);
  });

  it("the same page on a job board (not an application host) is still a sign-in page", () => {
    const doc = lab("workday-signup.html", "https://jobs.example-board.test/login");
    const fields = fieldsOf(doc);
    expect(isSignupPage(fields)).toBe(false);
    expect(hasFormHere(fields, { isApplication: () => false })).toBe(false);
    expect(looksLikeApplication(fields, appCheck)).toBe(false);
  });

  it("fills the email only: never a password, never the agreement", async () => {
    const doc = lab("workday-signup.html");
    const s = session(doc);
    await s.fillKnown(copy());
    expect(doc.querySelector("#email").value).toBe(EMAIL);
    expect(doc.querySelector("#password").value).toBe("");
    expect(doc.querySelector("#verifyPassword").value).toBe("");
    expect(doc.querySelector("#agree").checked).toBe(false);
    const r = s.report();
    expect(r.signup).toBe(true);
    expect(r.entries.map((e) => e.label)).toEqual(["Email Address"]);
    expect(r.need_you.map((n) => n.reason)).toEqual(["consent"]);
    expect(s.presence()).toMatchObject({ form: true, signup: true, password: true });
  });

  it("an email Chrome already filled shows as Already filled, never silence", async () => {
    const doc = lab("workday-signup.html");
    doc.querySelector("#email").value = EMAIL;
    const s = session(doc);
    await s.fillKnown(copy());
    const r = s.report();
    expect(r.entries).toEqual([]);
    expect(r.already.map((a) => [a.label, a.value])).toEqual([["Email Address", EMAIL]]);
  });

  it("Read the page again says what it saw", () => {
    expect(readAgainSays({ ok: true, signup: true, form: true, fields: 2 })).toBe("Sign-up page: Job Catcher fills your email; passwords are yours.");
    expect(readAgainSays({ ok: true, form: true, fields: 7 })).toBe("Read again: found 7 boxes.");
    expect(readAgainSays({ ok: true, form: false, seen: 2, password: true })).toMatch(/sign-in page \(2 boxes\)/);
    expect(readAgainSays({ ok: true, form: false, seen: 1 })).toMatch(/found 1 box, but not a form/);
    expect(readAgainSays({ ok: true, form: false, seen: 0 })).toBe("Read again: no boxes found.");
    expect(readAgainSays({ ok: false })).toMatch(/doesn't let extensions/);
  });
});

describe("US3: have you worked here before?", () => {
  it("compares whole company names, loosely", () => {
    expect(companyCore("Cascadia Corporation")).toBe("cascadia");
    expect(companyCore("Tidewell Labs, Inc.")).toBe("tidewell labs");
    expect(sameCompany("Northwind", "Northwind Labs Inc.")).toBe(true);
    expect(sameCompany("acmecorp", "Acme Corp")).toBe(true); // a Workday site's name
    expect(sameCompany("Apple", "Pineapple Labs")).toBe(false);
    expect(sameCompany("Nova", "Novaline Systems")).toBe(false);
    expect(inHistory("Northwind", { work: [{ company: "Self-employed" }, { company: "Freelance" }] })).toBe(false);
  });

  it("reads which company the question asks about", () => {
    expect(formerEmployerQuestion("Have you previously been employed by Northwind Labs?")).toEqual({ company: "Northwind Labs" });
    expect(formerEmployerQuestion("Have you ever worked for Bank of Cascadia as an employee or contractor?")).toEqual({ company: "Bank of Cascadia" });
    expect(formerEmployerQuestion("Are you a current or former employee of Northwind?")).toEqual({ company: "Northwind" });
    expect(formerEmployerQuestion("Have you worked for us before?")).toEqual({ ours: true });
    expect(formerEmployerQuestion("Have you ever worked here?")).toEqual({ ours: true });
    // Not that question: applying, relatives, another name, a kind of place.
    expect(formerEmployerQuestion("Have you previously applied to Northwind?")).toBeNull();
    expect(formerEmployerQuestion("Do you have relatives previously employed by Northwind?")).toBeNull();
    expect(formerEmployerQuestion("Have you ever worked under a different name?")).toBeNull();
    expect(formerEmployerQuestion("Have you ever worked for a government agency?")).toBeNull();
    expect(formerEmployerQuestion("Are you legally authorized to work in the United States?")).toBeNull();
  });

  it("No when the company isn't in the job history, Yes when it is, left when unknown", () => {
    const q = "Have you previously been employed by Northwind Labs?";
    expect(formerEmployerAnswer(q, copy())).toBe("No");
    expect(formerEmployerAnswer(q, copy({ history: { work: [{ company: "Northwind Labs Inc." }] } }))).toBe("Yes");
    expect(formerEmployerAnswer("Have you worked for us before?", copy({ company: "" }))).toBeNull(); // no company
    expect(formerEmployerAnswer(q, copy({ history: null }))).toBeNull(); // no history to go on
  });

  it("the Workday My Information step: the radio from the job history, tagged so", async () => {
    const doc = lab("workday-info.html");
    const s = session(doc);
    await s.fillKnown(copy());
    expect(doc.querySelector("#prev-no").checked).toBe(true);
    const entry = s.report().entries.find((e) => /previously been employed/.test(e.label));
    expect(entry.source).toBe("history");

    const again = lab("workday-info.html");
    await session(again).fillKnown(copy({ history: { work: [{ company: "Northwind Labs Inc." }] } }));
    expect(again.querySelector("#prev-yes").checked).toBe(true);
  });

  it("the user's own answer for this company wins over the history", () => {
    const doc = lab("workday-info.html");
    const field = fieldsOf(doc).find((f) => f.kind === "radio");
    const site = "northwind.wd5.myworkdayjobs.com";
    const d = resolve(field, { ...copy(), site, answers: [{ question_key: `${site}|${field.key}`, answer: "Yes" }] });
    expect(d).toMatchObject({ values: ["Yes"], source: "learned" });
  });

  it("the Workday site's name (only to name an unsaved job, never to answer 'worked here before?')", () => {
    expect(tenantCompany(workdayAddress(APPLY).tenant)).toBe("Northwind");
    expect(tenantCompany(workdayAddress("https://wd3.myworkdaysite.com/en-US/recruiting/cascadia/External/job/X_R1/apply").tenant)).toBe("Cascadia");
  });
});

describe("US4: only real agreements are only yours", () => {
  it("a lone checkbox is an agreement only when it reads like one", () => {
    for (const q of ["I agree to the terms", "I acknowledge the privacy policy", "I certify that the information I have provided is true and complete.", "I have read the notice", "Electronic signature", "Text me updates about my application"]) {
      expect(guardReason(q, "checkbox")).toBe("consent");
    }
    for (const q of ["I currently have secondary employment", "I serve on a board of directors", "I am at least 18 years of age"]) {
      expect(guardReason(q, "checkbox")).toBeNull();
    }
  });

  it("the Application Questions step: only the agreement and the required unknown box are listed", async () => {
    const doc = lab("workday-questions.html");
    const fields = fieldsOf(doc);
    // The shift choices (no shared name) are one list, not three lone boxes.
    const shifts = fields.find((f) => f.kind === "checkbox_list");
    expect(shifts.question).toBe("Which shifts can you work?");
    expect(shifts.options.map((o) => o.label)).toEqual(["Day", "Evening", "Weekend"]);
    expect(fields.filter((f) => f.kind === "checkbox").map((f) => f.el.id)).toEqual(["secondary", "board", "age", "attest"]);

    const s = session(doc);
    await s.fillKnown(copy());
    for (const id of ["secondary", "board", "age", "attest"]) expect(doc.querySelector(`#${id}`).checked).toBe(false);
    const need = Object.fromEntries(s.report().need_you.map((n) => [n.label, n.reason]));
    expect(need).toEqual({
      "I am at least 18 years of age": "unknown",
      "Which shifts can you work?": "unknown",
      "I certify that the information I have provided is true and complete.": "consent",
    });
  });

  it("a Yes remembered on this site ticks it; one from another site is only offered; a No leaves it", async () => {
    const doc = lab("workday-questions.html");
    const s = session(doc);
    await s.fillKnown(
      copy({
        answers: [
          { question_key: `${SITE}|i currently have secondary employment`, answer: "Yes" },
          { question_key: "i serve on a board of directors", answer: "Yes" }, // answered on another site
          { question_key: `${SITE}|i am at least 18 years of age`, answer: "No" },
        ],
      }),
    );
    expect(doc.querySelector("#secondary").checked).toBe(true);
    expect(doc.querySelector("#board").checked).toBe(false); // never ticked by itself…
    const board = s.report().need_you.find((n) => n.label === "I serve on a board of directors");
    expect(board).toMatchObject({ reason: "unknown", saved: "Yes" }); // …offered: "Use saved answer"
    expect(doc.querySelector("#age").checked).toBe(false);
    expect(doc.querySelector("#attest").checked).toBe(false); // never, whatever was remembered
  });

  it("ticking or unticking one is remembered like any other answer; agreements never", async () => {
    const doc = lab("workday-questions.html");
    const s = session(doc);
    await s.fillKnown(copy({ answers: [{ question_key: `${SITE}|i serve on a board of directors`, answer: "Yes" }] }));
    expect(doc.querySelector("#board").checked).toBe(true);
    doc.querySelector("#secondary").checked = true; // the user ticks one
    doc.querySelector("#board").checked = false; // and unticks the one Job Catcher ticked
    doc.querySelector("#attest").checked = true; // and the agreement
    const typed = s.typedAnswers();
    const of = (k) => typed.filter((a) => a.question_key === k).map((a) => [a.answer, !!a.company]);
    // Kept for this site (ticked here next time) and for every site (offered there).
    expect(of("i currently have secondary employment")).toEqual([["Yes", true], ["Yes", false]]);
    expect(of("i serve on a board of directors")).toEqual([["No", true], ["No", false]]);
    expect(typed.some((a) => a.question_key.includes("certify"))).toBe(false);
  });

  it("a yes/no box can be pointed at and taught; an agreement can't", () => {
    const doc = lab("workday-questions.html");
    const fields = fieldsOf(doc);
    const box = fields.find((f) => f.el.id === "secondary");
    const agreement = fields.find((f) => f.el.id === "attest");
    expect(pointRefusal(box)).toBe("");
    expect(pointRefusal(agreement)).toBe("consent");
    expect(learnKeyFor(box, "northwind.wd5.myworkdayjobs.com")).toMatchObject({ scope: "all" });
    expect(learnKeyFor(agreement, "northwind.wd5.myworkdayjobs.com")).toBeNull();
  });

  it("self-identification stays yours", () => {
    expect(guardReason("I identify as a protected veteran", "checkbox")).toBe("sensitive");
    expect(guardReason("Gender", "radio")).toBe("sensitive");
  });
});

describe("US5: Workday jobs are seen and tracked", () => {
  it("reads a Workday address: the posting, its title and place", () => {
    expect(workdayAddress(APPLY)).toEqual({
      tenant: "northwind",
      posting: JOB,
      title: "Applications Developer II",
      location: "Portland, OR",
      apply: true,
    });
    expect(workdayAddress(JOB).apply).toBe(false);
    expect(workdayAddress("https://example.com/job/x")).toBeNull();
  });

  it("a job called 'Applications Developer' is a job page, its apply steps an application", () => {
    expect(detectContext(JOB).kind).toBe("page");
    expect(detectContext(APPLY)).toMatchObject({ kind: "application", site: "Workday" });
  });

  it("reads a Workday job page by itself (its own job data first)", () => {
    const doc = lab("workday-job.html", JOB);
    const job = extractJob(doc, JOB);
    expect(job).toMatchObject({ title: "Applications Developer II", company: "Northwind Labs" });
    expect(job.location).toMatch(/^Portland, OR/);
    expect(job.description).toContain("Build and support the apps");
  });

  it("without job data: the page's heading and the site's name", () => {
    const doc = page(`<h2 data-automation-id="jobPostingHeader">Data Analyst</h2><div data-automation-id="jobPostingDescription"><p>Numbers.</p></div>`, JOB);
    expect(extractJob(doc, JOB)).toMatchObject({ title: "Data Analyst", company: "Northwind" });
  });

  it("the submit tracker: the job from the page, what to save it as, once", () => {
    const doc = lab("workday-questions.html", APPLY);
    const loc = new URL(APPLY);
    expect(jobInfo(doc, "workday", loc)).toMatchObject({ title: "Applications Developer II", company: "Northwind", url: JOB, location: "Portland, OR" });
    const onSubmit = vi.fn();
    watchForSubmit({ doc, loc, isCurrent: () => true, onSubmit });
    doc.querySelector("#submit").click();
    doc.querySelector("#submit").click(); // a double click
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].create).toEqual({ url: JOB, title: "Applications Developer II", company: "Northwind", location: "Portland, OR" });
  });

  it("never offers to save a job from another site's form", () => {
    const doc = page(`<form><input name="q"><button>Submit</button></form>`, "https://shop.example.test/search");
    const onSubmit = vi.fn();
    watchForSubmit({ doc, loc: new URL("https://shop.example.test/search"), isCurrent: () => true, onSubmit });
    doc.querySelector("form").dispatchEvent(new doc.defaultView.Event("submit", { bubbles: true, cancelable: true }));
    expect(onSubmit.mock.calls[0]?.[0]?.create).toBeUndefined();
  });
});

describe("US6: missing profile details", () => {
  it("a postal code the profile lacks is listed with what it wants, and Add to profile fills it", async () => {
    const doc = lab("workday-info.html");
    const s = session(doc);
    await s.fillKnown(copy());
    const need = s.report().need_you.find((n) => n.label === "Postal Code");
    expect(need).toMatchObject({ reason: "no_data", key: "postal_code" });
    expect((await s.useProfile(need.id, ["97201"])).ok).toBe(true);
    expect(doc.querySelector("#addressSection_postalCode").value).toBe("97201");
    expect(s.report().need_you.some((n) => n.label === "Postal Code")).toBe(false);
  });
});
