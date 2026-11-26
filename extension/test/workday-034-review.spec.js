// Spec 034, PR #67 review: the reviewer's probes as tests. Checkbox lists
// never get round the agreement and self-ID guards; attestations are
// agreements and a tick from another site is only offered; "have you worked
// for X before?" only for a company, never a tool or the Workday site's name;
// sign-up mode only on a short Create Account page; only Workday's final
// Submit is tracked. Invented names only.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { formerEmployerAnswer, formerEmployerQuestion } from "../src/autofill/classify/formerEmployer.js";
import { guardReason, profileValues } from "../src/autofill/classify/profileKeys.js";
import { collectFields, hasFormHere, isSignupPage } from "../src/autofill/scan.js";
import { resolve } from "../src/autofill/resolve.js";
import { createSession, pointRefusal } from "../src/autofill/session.js";
import { watchForSubmit } from "../src/autofill/track.js";
import { writeField } from "../src/autofill/widgets.js";

const here = dirname(fileURLToPath(import.meta.url));
const JOB = "https://northwind.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Applications-Developer-II_JR-1001";
const APPLY = `${JOB}/apply/applyManually`;
const SITE = "northwind.wd5.myworkdayjobs.com";

function page(html, url = APPLY) {
  const win = new Window({ url });
  win.document.write(html);
  return win.document;
}
function lab(name, url = APPLY) {
  return page(readFileSync(join(here, "lab", name), "utf8").replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, ""), url);
}
const PROFILE = { first_name: "Alex", last_name: "Rivera", phone: "555-010-2233", address_line1: "40 Alder St", city: "Portland", state: "OR", postal_code: "97201", country: "United States" };
const copy = (extra = {}) => ({
  values: profileValues(PROFILE, "alex.rivera@example.com", new Date("2026-11-25T12:00:00")),
  answers: [],
  history: { work: [{ company: "Tidewell Labs Inc." }] },
  company: "Northwind",
  ...extra,
});
const fieldsOf = (doc) => collectFields(doc, { visible: () => true });
const session = (doc, send = vi.fn(async () => ({}))) => createSession({ doc, send, visible: () => true });

describe("checkbox lists never get round the agreement and self-ID guards", () => {
  it("an agreement among nameless boxes keeps each box on its own; nothing remembered ticks the agreement", async () => {
    const doc = page(`<div data-automation-id="formField-final">
      <label data-automation-id="formLabel">Before you submit</label>
      <div><input type="checkbox" id="a"><label for="a">I agree to the Terms of Use and Privacy Policy</label></div>
      <div><input type="checkbox" id="b"><label for="b">I would like to hear about other roles</label></div></div>`);
    const fields = fieldsOf(doc);
    expect(fields.map((f) => f.kind)).toEqual(["checkbox", "checkbox"]);
    expect(guardReason(fields[0].question, "checkbox")).toBe("consent");
    await session(doc).fillKnown(
      copy({
        answers: [
          { question_key: `${SITE}|${fields[0].key}`, answer: "Yes" },
          { question_key: "before you submit", answer: "I agree to the Terms of Use and Privacy Policy" },
        ],
      }),
    );
    expect(doc.querySelector("#a").checked).toBe(false);
  });

  it("a named list with an agreement among its options is the user's; the writer refuses the agreement too; never learned", async () => {
    const doc = page(`<form><fieldset><legend>Before you submit</legend>
      <label><input type="checkbox" name="final" id="a"> I agree to the Terms of Use</label>
      <label><input type="checkbox" name="final" id="b"> Send me similar jobs</label></fieldset></form>`);
    const list = fieldsOf(doc).find((f) => f.kind === "checkbox_list");
    expect(list.options.map((o) => o.label)).toEqual(["I agree to the Terms of Use", "Send me similar jobs"]);
    expect(resolve(list, copy({ answers: [{ question_key: list.key, answer: "I agree to the Terms of Use, Send me similar jobs" }] }))).toEqual({ skip: "consent" });
    await writeField(list, ["I agree to the Terms of Use, Send me similar jobs"]);
    expect(doc.querySelector("#a").checked).toBe(false);
    expect(doc.querySelector("#b").checked).toBe(true);
    doc.querySelector("#a").checked = true;
    expect(session(doc).typedAnswers().some((a) => a.question_key === list.key)).toBe(false);
  });

  it("a disability question drawn as tick boxes is self-ID whatever its label says: never filled, learned or taught", async () => {
    const doc = page(`<h2>Form CC-305</h2><p>Page 1 of 1</p>
      <div data-automation-id="formField-disabilityStatus">
      <label data-automation-id="formLabel">Please check one of the boxes below:</label>
      <div><input type="checkbox" id="y"><label for="y">Yes, I have a disability (or previously had a disability)</label></div>
      <div><input type="checkbox" id="n"><label for="n">No, I do not have a disability and have not had one in the past</label></div>
      <div><input type="checkbox" id="x"><label for="x">I do not want to answer</label></div></div>`);
    const list = fieldsOf(doc).find((f) => f.kind === "checkbox_list");
    expect(list.options).toHaveLength(3);
    const s = session(doc);
    await s.fillKnown(copy({ answers: [{ question_key: list.key, answer: "No, I do not have a disability and have not had one in the past" }] }));
    for (const id of ["y", "n", "x"]) expect(doc.querySelector(`#${id}`).checked).toBe(false);
    expect(s.report().need_you.find((n) => n.id === list.id)?.reason).toBe("sensitive");
    doc.querySelector("#n").checked = true; // the user's own answer
    expect(s.typedAnswers()).toEqual([]);
    expect(pointRefusal(list)).toBe("sensitive");
  });

  it("a radio's self-ID option is never picked", async () => {
    const doc = page(`<fieldset><legend>Please choose one</legend>
      <label><input type="radio" name="d" id="d1" value="1"> Yes, I have a disability</label>
      <label><input type="radio" name="d" id="d2" value="2"> No</label></fieldset>`);
    const radio = fieldsOf(doc).find((f) => f.kind === "radio");
    expect(resolve(radio, copy({ answers: [{ question_key: radio.key, answer: "Yes, I have a disability" }] }))).toEqual({ skip: "sensitive" });
    expect((await writeField(radio, ["Yes, I have a disability"])).ok).toBe(false);
    expect(doc.querySelector("#d1").checked).toBe(false);
  });
});

describe("attestations are agreements; a tick from another site is only offered", () => {
  it("attestations read as agreements", () => {
    for (const q of [
      "I hereby declare that the information provided is accurate",
      "I confirm the information above is correct",
      "I verify that all statements are true",
      "I declare that I have answered all questions honestly",
      "By ticking this box, the information is accurate",
      "By selecting this box I agree",
      "To the best of my knowledge, the above is true",
    ]) {
      expect(guardReason(q, "checkbox")).toBe("consent");
    }
  });

  it("an attestation ticked elsewhere is never ticked here, and never learned", async () => {
    const doc = page(`<div data-automation-id="formField-x"><input type="checkbox" id="d"><label for="d">I hereby declare that the information provided is accurate</label></div>`);
    doc.querySelector("#d").checked = true;
    expect(session(doc).typedAnswers()).toEqual([]);
    doc.querySelector("#d").checked = false;
    await session(doc).fillKnown(copy({ answers: [{ question_key: "i hereby declare that the information provided is accurate", answer: "Yes" }] }));
    expect(doc.querySelector("#d").checked).toBe(false);
  });

  it("a negated or different box never takes a remembered Yes (not even as an offer)", () => {
    const answers = [
      { question_key: "i currently have secondary employment", answer: "Yes" },
      { question_key: "i am at least 18 years of age", answer: "Yes" },
    ];
    for (const q of ["I do not currently have secondary employment", "I currently have no secondary employment", "I am under 18 years of age", "I am at least 21 years of age", "I am not at least 18 years of age"]) {
      const d = resolve({ kind: "checkbox", question: q, key: q.toLowerCase(), hints: {} }, copy({ answers }));
      expect(d.values).toBeUndefined();
      expect(d.offer).toBeUndefined();
    }
  });

  it("the panel's Fix never saves an agreement or a self-ID answer, and keeps a company's answer to that company", async () => {
    const doc = page(`<fieldset><legend>Have you worked for us before?</legend>
      <label><input type="radio" name="w" value="Yes"> Yes</label><label><input type="radio" name="w" value="No"> No</label></fieldset>
      <fieldset><legend>Gender</legend><label><input type="radio" name="g" value="f"> Female</label><label><input type="radio" name="g" value="m"> Male</label></fieldset>
      <div><input type="checkbox" id="t"><label for="t">I certify the above is true</label></div>`);
    const send = vi.fn(async () => ({}));
    const s = session(doc, send);
    const fields = s.scan();
    const saved = () => send.mock.calls.filter(([m]) => m.type === "saveCustomAnswers").flatMap(([m]) => m.answers.map((a) => a.question_key));
    await s.fix(fields.find((f) => /worked for us/.test(f.question)).id, "Yes");
    expect(saved()).toEqual([`${SITE}|have you worked for us before`]);
    send.mockClear();
    await s.fix(fields.find((f) => f.question === "Gender").id, "Female");
    await s.fix(fields.find((f) => f.kind === "checkbox").id, "Yes");
    expect(saved()).toEqual([]);
  });
});

describe("'have you worked for X before?' only for a company, never a tool or a guess", () => {
  it("tools, lists, families of companies and kinds of places are not that question", () => {
    for (const q of [
      "Have you ever worked with Python before?",
      "Have you previously worked with Salesforce?",
      "Have you ever worked with AWS before?",
      "Have you ever worked with Kubernetes in production?",
      "Have you previously been employed by Cascadia or any of its subsidiaries?",
      "Have you ever been employed by Smith & Jones or any of its affiliates?",
      "Have you ever worked at Northwind, Cascadia, or Tidewell?",
      "Are you currently employed or have you previously been employed by a competitor of Northwind?",
      "Have you ever worked for a Fortune 500 company?",
      "Have you previously worked in a regulated industry?",
      "Have you previously worked on SAP projects?",
      "Do you have any prior experience working with Excel?",
    ]) {
      expect(formerEmployerQuestion(q)).toBeNull();
    }
    expect(formerEmployerQuestion("Have you previously worked as an intern at Acme?")).toEqual({ company: "Acme" });
  });

  it("'us' is answered only from the linked job's or the page's company, never the Workday site's name", async () => {
    expect(formerEmployerAnswer("Have you ever worked for us before?", copy({ company: "" }))).toBeNull();
    const doc = lab("workday-info.html", "https://jj.wd5.myworkdayjobs.com/en-US/External/job/X_R-1/apply");
    doc.querySelector("legend span").textContent = "Have you worked for us before?";
    await session(doc).fillKnown(copy({ company: "" }));
    expect(doc.querySelector("#prev-yes").checked || doc.querySelector("#prev-no").checked).toBe(false);
  });

  it("an answer from the job history is tagged so (the panel shows it to check)", async () => {
    const doc = lab("workday-info.html");
    const s = session(doc);
    await s.fillKnown(copy());
    expect(s.report().entries.find((e) => /previously been employed/.test(e.label)).source).toBe("history");
  });
});

describe("sign-up mode only on a short Create Account page", () => {
  const REGISTER = `<form>
    <label for=fn>First name</label><input id=fn autocomplete=given-name>
    <label for=ln>Last name</label><input id=ln autocomplete=family-name>
    <label for=em>Email</label><input id=em type=email autocomplete=email>
    <label for=ph>Phone</label><input id=ph type=tel autocomplete=tel>
    <label for=ci>City</label><input id=ci autocomplete=address-level2>
    <label for=pc>Postal code</label><input id=pc autocomplete=postal-code>
    <label for=pw>Create a password</label><input id=pw type=password></form>`;

  it("a register-and-apply form (Taleo) is filled as usual, never the password", async () => {
    const doc = page(REGISTER, "https://acme.taleo.net/careersection/apply");
    expect(isSignupPage(fieldsOf(doc))).toBe(false);
    await session(doc).fillKnown(copy());
    expect(["fn", "ln", "em", "ph", "ci", "pc"].map((id) => !!doc.querySelector(`#${id}`).value)).toEqual([true, true, true, true, true, true]);
    expect(doc.querySelector("#pw").value).toBe("");
  });

  it("a sign-in page (one password, a Create Account button beside it) is not a sign-up form", () => {
    const doc = page(`<h2>Sign In</h2><label for=e>Email Address</label><input id=e type=text>
      <label for=p>Password</label><input id=p type=password><button>Sign In</button><button>Create Account</button>`);
    expect(isSignupPage(fieldsOf(doc))).toBe(false);
    expect(hasFormHere(fieldsOf(doc), { isApplication: () => false })).toBe(false);
  });
});

describe("only Workday's final Submit is tracked", () => {
  const SIGN_IN = "<form id=f><label>Email Address<input type=text></label><label>Password<input type=password></label><button id=b>Sign In</button></form>";

  it("a sign-in form on a Workday job page or Create Account step never marks anything applied", () => {
    for (const url of [JOB, APPLY]) {
      const win = new Window({ url });
      win.document.write(SIGN_IN);
      const onSubmit = vi.fn();
      watchForSubmit({ doc: win.document, loc: new URL(url), isCurrent: () => true, onSubmit });
      win.document.getElementById("f").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      win.document.getElementById("b").click();
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });

  it("a Submit with a password box showing never counts, and doesn't use up the real one", () => {
    const win = new Window({ url: APPLY });
    win.document.write(`<input type=password id=p><button id=s data-automation-id="bottom-navigation-next-button">Submit</button>`);
    const onSubmit = vi.fn();
    watchForSubmit({ doc: win.document, loc: new URL(APPLY), isCurrent: () => true, onSubmit });
    win.document.getElementById("s").click();
    expect(onSubmit).not.toHaveBeenCalled();
    win.document.getElementById("p").remove(); // signed in: the application's own Review step
    win.document.getElementById("s").click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("a Submit on the job page itself (not an application step) never counts", () => {
    const win = new Window({ url: JOB });
    win.document.write("<button id=s>Submit</button>");
    const onSubmit = vi.fn();
    watchForSubmit({ doc: win.document, loc: new URL(JOB), isCurrent: () => true, onSubmit });
    win.document.getElementById("s").click();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
