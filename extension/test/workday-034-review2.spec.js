// Spec 034, PR #67 re-review (probes p9, p10): Workday's real final-Submit
// variants; option-level guards that are neither too wide nor too narrow;
// self-ID by the heading a box sits under; kinds of places that aren't
// companies. Invented names only.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { formerEmployerQuestion } from "../src/autofill/classify/formerEmployer.js";
import { fieldGuard, untouchableChoice } from "../src/autofill/classify/profileKeys.js";
import { collectFields } from "../src/autofill/scan.js";
import { createSession } from "../src/autofill/session.js";
import { isWorkdayFinalSubmit, watchForSubmit } from "../src/autofill/track.js";

const here = dirname(fileURLToPath(import.meta.url));
const APPLY = "https://northwind.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Dev-II_JR-1001/apply/applyManually";
const guard = (question, kind, options = [], hints = {}) => fieldGuard({ question, kind, options: options.map((label) => ({ label })), hints });

function submits(html, pick) {
  const win = new Window({ url: APPLY });
  win.document.write(html);
  const onSubmit = vi.fn();
  watchForSubmit({ doc: win.document, loc: new URL(APPLY), isCurrent: () => true, onSubmit });
  pick(win.document).click();
  return onSubmit.mock.calls.length;
}

describe("Workday's final Submit, as tenants really draw it", () => {
  it.each([
    ["the bottom navigation button", '<button data-automation-id="bottom-navigation-next-button">Submit</button>'],
    ["the page-footer button", '<button data-automation-id="pageFooterNextButton">Submit</button>'],
    ["a 'Submit Application' button", '<button data-automation-id="bottom-navigation-next-button">Submit Application</button>'],
    ["a plain button", "<button>Submit</button>"],
  ])("%s counts", (_, html) => {
    expect(submits(html, (d) => d.querySelector("button"))).toBe(1);
  });

  it("the click_filter overlay (no text, aria-label Submit) counts, once", () => {
    const html = readFileSync(join(here, "lab", "workday-review.html"), "utf8");
    const win = new Window({ url: APPLY });
    win.document.write(html);
    const onSubmit = vi.fn();
    watchForSubmit({ doc: win.document, loc: new URL(APPLY), isCurrent: () => true, onSubmit });
    win.document.getElementById("back").click();
    win.document.getElementById("save").click();
    expect(onSubmit).not.toHaveBeenCalled();
    win.document.getElementById("filter").click();
    win.document.getElementById("submit").click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Next", '<button data-automation-id="bottom-navigation-next-button">Next</button>'],
    ["Save and Continue", '<button data-automation-id="bottom-navigation-next-button">Save and Continue</button>'],
    ["Back", '<button data-automation-id="pageFooterBackButton">Back</button>'],
    ["Submitted? no: a password showing", '<input type="password"><button>Submit</button>'],
  ])("%s never counts", (_, html) => {
    expect(submits(html, (d) => d.querySelector("button"))).toBe(0);
  });

  it("the job page itself never has the final Submit", () => {
    const win = new Window({ url: APPLY.replace("/apply/applyManually", "") });
    win.document.write("<button>Submit</button>");
    expect(isWorkdayFinalSubmit(win.document.querySelector("button"), win.document, win.location)).toBe(false);
  });
});

describe("option-level guards: only declarations and agreements", () => {
  it("ordinary choices stay ordinary", () => {
    expect(guard("How did you hear about us?", "radio", ["LinkedIn", "Military.com", "Veteran job fair", "Referral"])).toBeNull();
    expect(guard("How did you hear about us?", "checkbox_list", ["LinkedIn", "Email from recruiter", "Contact me later"])).toBeNull();
    expect(guard("Which of these skills do you have?", "checkbox_list", ["Data verification", "Accurate typing", "SQL"])).toBeNull();
    expect(guard("What is your preferred contact method?", "radio", ["Email me", "Call me", "Text me"])).toBeNull();
    expect(guard("Do you have experience with electronic signature tools (DocuSign)?", "radio", ["Yes", "No"])).toBeNull();
    expect(guard("Is your degree information correct?", "select", ["Yes", "No"])).toBeNull();
    expect(guard("Are you able to verify employment eligibility?", "radio", ["Yes", "No"])).toBeNull();
    expect(untouchableChoice("Accurate typing")).toBe(false);
    expect(untouchableChoice("Contact me later")).toBe(false);
    expect(untouchableChoice("Veteran job fair", "radio", "How did you hear about us?")).toBe(false);
  });

  it("a vague question with gender, race or ethnicity answers is self-ID (dropdowns too)", () => {
    expect(guard("Please select one", "select", ["Male", "Female", "Decline to self-identify"])).toBe("sensitive");
    expect(guard("Please select one", "combobox", ["Hispanic or Latino", "Not Hispanic or Latino"])).toBe("sensitive");
    expect(guard("Please check one", "checkbox_list", ["Yes, I have a disability", "No", "I do not want to answer"])).toBe("sensitive");
    expect(untouchableChoice("Yes, I have a disability", "radio")).toBe(true);
  });

  it("agreements among the options are still the user's", () => {
    expect(guard("Before you submit", "checkbox_list", ["I agree to the Terms of Use", "Send me similar jobs"])).toBe("consent");
    expect(guard("Please confirm", "radio", ["I acknowledge the privacy policy", "No"])).toBe("consent");
    expect(untouchableChoice("By ticking this box I confirm the above")).toBe(true);
  });

  it("a lone box under a self-ID heading is self-ID, never a learnable yes/no", async () => {
    expect(guard("I do not wish to answer", "checkbox")).toBeNull();
    expect(guard("I do not wish to answer", "checkbox", [], { section: "Voluntary Self-Identification" })).toBe("sensitive");
    const win = new Window({ url: APPLY });
    win.document.write(`<fieldset><legend>Voluntary Self-Identification of Disability</legend>
      <div><input type="checkbox" id="x"><label for="x">I do not wish to answer</label></div>
      <div><label for="n">Name</label><input id="n"></div></fieldset>`);
    const s = createSession({ doc: win.document, send: vi.fn(async () => ({})), visible: () => true });
    const box = collectFields(win.document, { visible: () => true }).find((f) => f.kind === "checkbox");
    expect(fieldGuard(box)).toBe("sensitive");
    win.document.getElementById("x").checked = true;
    expect(s.typedAnswers().some((a) => /wish to answer/.test(a.question_key))).toBe(false);
  });
});

describe("kinds of places are not companies", () => {
  it.each([
    "Have you previously worked at Level 3 support?",
    "Have you previously worked at Tier 1 Help Desk?",
    "Have you ever worked at Big 4 accounting firms?",
    "Have you ever worked at Remote companies?",
    "Have you previously worked at Night Shift Pharmacy?",
    "Have you ever been employed by any Northwind entity?",
    "Have you worked here before, or at any of our affiliates?",
  ])("%s", (q) => {
    expect(formerEmployerQuestion(q)).toBeNull();
  });

  it("real names and 'us' still are", () => {
    expect(formerEmployerQuestion("Have you ever worked for Northwind in any capacity?")).toEqual({ company: "Northwind" });
    expect(formerEmployerQuestion("Are you a former Northwind employee?")).toEqual({ company: "Northwind" });
    expect(formerEmployerQuestion("Have you ever worked for UPS before?")).toEqual({ company: "UPS" });
    expect(formerEmployerQuestion("Have you previously worked for us, including as a contractor?")).toEqual({ ours: true });
    expect(formerEmployerQuestion("Have you been employed with us previously?")).toEqual({ ours: true });
  });
});

describe("self-ID lists under a question that doesn't say so (final review)", () => {
  const race = ["Hispanic or Latino", "White (Not Hispanic or Latino)", "Asian (Not Hispanic or Latino)", "I do not wish to answer"];
  for (const question of ["Which describes you?", "Page 1 of 1", "Please make a selection", "Select from the list", "Form CC-305"]) {
    it(`a race list under "${question}" is the user's`, () => {
      expect(fieldGuard({ question, kind: "radio", options: race.map((label) => ({ label })) })).toBe("sensitive");
      expect(fieldGuard({ question, kind: "select", options: race.map((label) => ({ label })) })).toBe("sensitive");
    });
  }
  it("a plain-word disability list is the user's", () => {
    const options = ["Disabled", "Not disabled", "Prefer not to say"].map((label) => ({ label }));
    expect(fieldGuard({ question: "Which applies?", kind: "radio", options })).toBe("sensitive");
  });
  it("one stray topic word in an ordinary list stays fillable", () => {
    const options = ["LinkedIn", "Military.com", "Veteran job fair", "Referral"].map((label) => ({ label }));
    expect(fieldGuard({ question: "How did you hear about us?", kind: "radio", options })).toBeNull();
  });
});
