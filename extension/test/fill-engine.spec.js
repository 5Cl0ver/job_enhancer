// @vitest-environment happy-dom
// The fill engine (spec 015): scan → resolve → write → read back, against the
// saved Greenhouse/Lever forms and small invented ones. The real-browser lab
// (e2e/autofill-*.spec.js) covers what happy-dom can't (React state, search
// dropdowns, frames). Invented applicant only.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchAnswer, matchOption, normalizeQuestion } from "../src/autofill/classify/answers.js";
import { guardReason, profileKeyFor, profileValues } from "../src/autofill/classify/profileKeys.js";
import { collectFields } from "../src/autofill/scan.js";
import { isResumeUpload, resolve } from "../src/autofill/resolve.js";
import { createSession } from "../src/autofill/session.js";
import { detectAts } from "../src/autofill/track.js";

const here = dirname(fileURLToPath(import.meta.url));
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const fixture = (name) => parse(readFileSync(join(here, "fixtures", name), "utf8"));

const PROFILE = {
  first_name: "Wren",
  last_name: "Calloway",
  phone: "555-010-4477",
  address_line1: "12 Ferry Lane",
  address_line2: "Unit 3",
  city: "Harborview",
  state: "OR",
  postal_code: "97000",
  country: "United States",
  linkedin_url: "https://www.linkedin.example/in/wren-calloway",
  github_url: "https://github.example/wrencalloway",
  portfolio_url: "https://wren.example",
  authorized_to_work: true,
  requires_sponsorship: false,
  willing_to_relocate: null,
};
const EMAIL = "wren@example.com";

function copy({ answers = [], resumeFile = null } = {}) {
  return { values: profileValues(PROFILE, EMAIL, new Date("2026-11-23T12:00:00")), answers, resumeFile };
}

function session(doc, send = vi.fn(async () => ({}))) {
  return createSession({ doc, send, visible: () => true });
}

const fieldsOf = (doc) => collectFields(doc, { visible: () => true });
const keyOf = (doc, sel) => {
  const el = doc.querySelector(sel);
  return profileKeyFor(fieldsOf(doc).find((f) => f.el === el));
};

describe("detectAts (submit tracking)", () => {
  it("recognizes Greenhouse, Lever and Workday", () => {
    expect(detectAts("https://job-boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectAts("https://jobs.lever.co/acme/uuid/apply")).toBe("lever");
    expect(detectAts("https://company.wd5.myworkdayjobs.com/careers")).toBe("workday");
    expect(detectAts("https://www.indeed.com/viewjob?jk=x")).toBeNull();
  });
});

describe("Greenhouse form", () => {
  it("maps the standard fields and custom questions by their visible labels", () => {
    const doc = fixture("greenhouse-form.html");
    expect(keyOf(doc, "#first_name")).toBe("first_name");
    expect(keyOf(doc, "#last_name")).toBe("last_name");
    expect(keyOf(doc, "#email")).toBe("email");
    expect(keyOf(doc, "#phone")).toBe("phone");
    expect(keyOf(doc, "#job_application_location")).toBe("location");
    expect(keyOf(doc, "#job_application_answers_attributes_0_text_value")).toBe("linkedin_url");
    expect(keyOf(doc, "#job_application_answers_attributes_2_boolean_value")).toBe("authorized_to_work");
    expect(keyOf(doc, "#job_application_answers_attributes_3_boolean_value")).toBe("requires_sponsorship");
  });

  it("fills it — dropdowns by their option text — and leaves essays and the cover letter alone", async () => {
    const doc = fixture("greenhouse-form.html");
    const s = session(doc);
    await s.fillKnown(copy());
    expect(doc.querySelector("#first_name").value).toBe("Wren");
    expect(doc.querySelector("#email").value).toBe(EMAIL);
    expect(doc.querySelector("#job_application_location").value).toBe("Harborview, OR");
    expect(doc.querySelector("#job_application_answers_attributes_2_boolean_value").value).toBe("1"); // Yes
    expect(doc.querySelector("#job_application_answers_attributes_3_boolean_value").value).toBe("0"); // No
    expect(doc.querySelector("#job_application_answers_attributes_4_text_value").value).toBe("");
    const report = s.report();
    expect(report.entries.find((e) => e.label.match(/first name/i))?.source).toBe("profile");
    // No résumé on hand: the upload is left for the user, not silently skipped.
    expect(report.need_you.some((n) => n.kind === "file")).toBe(true);
    expect(isResumeUpload(fieldsOf(doc).find((f) => f.el.id === "cover_letter"))).toBe(false);
  });

  it("never overwrites what the user already typed", async () => {
    const doc = fixture("greenhouse-form.html");
    doc.querySelector("#first_name").value = "Robin";
    await session(doc).fillKnown(copy());
    expect(doc.querySelector("#first_name").value).toBe("Robin");
  });
});

describe("Lever form", () => {
  it("fills the full name and leaves 'Additional information' alone", async () => {
    const doc = fixture("lever-form.html");
    await session(doc).fillKnown(copy());
    expect(doc.querySelector("[name='name']").value).toBe("Wren Calloway");
    expect(doc.querySelector("[name='urls[GitHub]']").value).toBe(PROFILE.github_url);
    expect(doc.querySelector("[name='comments']").value).toBe("");
  });
});

describe("any site: autocomplete, addresses, dropdown wording", () => {
  const form = () =>
    parse(`<form>
      <label for="fn">First name</label><input id="fn" autocomplete="given-name" />
      <label for="ln">Last name</label><input id="ln" autocomplete="family-name" />
      <label for="em">Email address</label><input id="em" type="email" />
      <label for="em2">Confirm your email</label><input id="em2" type="email" />
      <label for="ph">Phone number</label><input id="ph" type="tel" />
      <label for="a1">Address line 1 (Street address, P.O. Box)</label><input id="a1" />
      <label for="a2">Address line 2 (Unit, suite)</label><input id="a2" />
      <label for="ct">City</label><input id="ct" />
      <label for="pc">Postal/Zip code</label><input id="pc" />
      <label for="co">Country/Region</label><select id="co"><option value="">Select…</option><option>Canada</option><option value="US">United States of America</option></select>
      <label for="st">Province/State</label><select id="st"><option value="">--</option><option>Ohio</option><option>Oregon</option></select>
    </form>`);

  it("fills the whole contact step, confirm email and state names included", async () => {
    const doc = form();
    await session(doc).fillKnown(copy());
    expect(doc.querySelector("#fn").value).toBe("Wren");
    expect(doc.querySelector("#em2").value).toBe(EMAIL);
    expect(doc.querySelector("#a2").value).toBe("Unit 3");
    expect(doc.querySelector("#pc").value).toBe("97000");
    expect(doc.querySelector("#co").value).toBe("US"); // "United States" ≈ "United States of America"
    expect(doc.querySelector("#st").value).toBe("Oregon"); // "OR" → "Oregon"
  });

  it("reads labels the modern ways: aria-labelledby and nearby text", async () => {
    const doc = parse(`<div id="lbl">LinkedIn Profile</div><input id="li" aria-labelledby="lbl">
      <div class="field"><div class="label">Preferred first name</div><input id="pref"></div>`);
    await session(doc).fillKnown(copy());
    expect(doc.querySelector("#li").value).toBe(PROFILE.linkedin_url);
    expect(doc.querySelector("#pref").value).toBe("Wren");
  });

  it("finds fields inside components that hide their insides (shadow DOM)", async () => {
    const doc = parse(`<form><city-field></city-field></form>`);
    const host = doc.querySelector("city-field");
    host.attachShadow({ mode: "open" }).innerHTML = '<label for="c">City</label><input id="c">';
    await session(doc).fillKnown(copy());
    expect(host.shadowRoot.querySelector("#c").value).toBe("Harborview");
  });
});

describe("never touched", () => {
  it("self-identification, agreements and essays", async () => {
    const doc = parse(`<form>
      <label for="g">Gender</label><select id="g"><option value=""></option><option>Female</option><option>Male</option></select>
      <fieldset><legend>Are you a protected veteran?</legend>
        <label><input type="radio" name="v" value="y">Yes</label><label><input type="radio" name="v" value="n">No</label></fieldset>
      <label><input type="checkbox" id="agree"> I agree to the privacy policy</label>
      <label for="why">Why do you want to work here?</label><textarea id="why"></textarea>
      <label for="fn">First name</label><input id="fn">
    </form>`);
    const s = session(doc);
    await s.fillKnown(copy({ answers: [{ question_key: "i agree to the privacy policy", answer: "Yes" }] }));
    expect(doc.querySelector("#g").value).toBe("");
    expect(doc.querySelector("input[name=v]:checked")).toBeNull();
    expect(doc.querySelector("#agree").checked).toBe(false);
    expect(doc.querySelector("#why").value).toBe("");
    expect(doc.querySelector("#fn").value).toBe("Wren");
    expect(guardReason("Gender", "select")).toBe("sensitive");
    expect(guardReason("Why do you want to work here?", "textarea")).toBe("essay");
  });
});

describe("remembered answers", () => {
  it("normalizes questions into stable keys", () => {
    expect(normalizeQuestion("Years of React experience? *")).toBe("years of react experience");
    expect(normalizeQuestion("How did you hear about us? (required)")).toBe("how did you hear about us");
  });

  it("match by exact key, then a close rewording — never across a country, number or 'not'", () => {
    const mem = [{ question_key: "years of react experience", answer: "3" }];
    expect(matchAnswer("years of react experience at acme", mem)?.answer).toBe("3");
    expect(matchAnswer("favorite programming language", mem)).toBeNull();
    const us = [{ question_key: "are you authorized to work in the united states", answer: "Yes" }];
    expect(matchAnswer("are you authorized to work in canada", us)).toBeNull();
    expect(matchAnswer("do you have 3 years of experience", [{ question_key: "do you have 5 years of experience", answer: "Yes" }])).toBeNull();
    expect(matchAnswer("are you not authorized to work here", [{ question_key: "are you authorized to work here", answer: "Yes" }])).toBeNull();
  });

  it("fill custom questions, radios included, and leave the rest for the user", async () => {
    const doc = parse(`<form>
      <label for="q1">Years of React experience? *</label><input id="q1">
      <label for="q2">How did you hear about us?</label><input id="q2">
      <div><p>Have you previously applied to Vellacor?</p>
        <label><input type="radio" name="prev" value="Yes">Yes</label><label><input type="radio" name="prev" value="No">No</label></div>
      <div><p>Would you be legally eligible to begin employment immediately?</p>
        <label><input type="radio" name="elig" value="Yes">Yes</label><label><input type="radio" name="elig" value="No">No</label></div>
    </form>`);
    const s = session(doc);
    await s.fillKnown(
      copy({
        answers: [
          { question_key: "years of react experience", answer: "3" },
          { question_key: normalizeQuestion("Have you previously applied to Vellacor?"), answer: "No" },
        ],
      }),
    );
    expect(doc.querySelector("#q1").value).toBe("3");
    expect(doc.querySelector("input[name=prev]:checked").value).toBe("No");
    expect(doc.querySelector("input[name=elig]:checked").value).toBe("Yes"); // from the profile
    const r = s.report();
    expect(r.entries.find((e) => e.label.includes("React"))?.source).toBe("learned");
    expect(r.need_you.map((n) => n.label)).toContain("How did you hear about us?");
  });

  it("collect what the user typed, to remember it", async () => {
    const doc = parse(`<form><label for="fn">First name</label><input id="fn">
      <label for="q2">How did you hear about us?</label><input id="q2"></form>`);
    const s = session(doc);
    doc.querySelector("#q2").value = "LinkedIn";
    expect(s.typedAnswers()).toEqual([
      { question_key: "how did you hear about us", question_text: "How did you hear about us?", answer: "LinkedIn" },
    ]);
  });
});

describe("dropdown options mean the same thing", () => {
  it("matches Yes/No wordings, values and prefixes, never placeholders", () => {
    const yes = [{ label: "Select…" }, { label: "Yes, I am authorized to work in the US" }, { label: "No, I am not" }];
    expect(matchOption("Yes", yes)).toBe(1);
    expect(matchOption("No", yes)).toBe(2);
    expect(matchOption("Select…", yes)).toBe(-1);
    expect(matchOption("us_state_CA", [{ label: "California", value: "us_state_CA" }])).toBe(0);
    expect(matchOption("Narnia", [{ label: "California" }])).toBe(-1);
  });
});

describe("Fix and Undo", () => {
  it("undo puts every field back exactly; fix on a custom question is remembered", async () => {
    const doc = parse(`<form><label for="fn">First name</label><input id="fn">
      <label for="q">Years of SQL?</label><input id="q"></form>`);
    const send = vi.fn(async () => ({}));
    const s = session(doc, send);
    await s.fillKnown(copy());
    expect(doc.querySelector("#fn").value).toBe("Wren");
    expect(await s.undo()).toBe(1);
    expect(doc.querySelector("#fn").value).toBe("");

    const id = s.report().need_you.find((n) => n.label === "Years of SQL?").id;
    expect((await s.fix(id, "4")).ok).toBe(true);
    expect(doc.querySelector("#q").value).toBe("4");
    expect(send).toHaveBeenCalledWith({
      type: "saveCustomAnswers",
      answers: [{ question_key: "years of sql", question_text: "Years of SQL?", answer: "4" }],
    });
  });
});

describe("a résumé upload", () => {
  it("is found by what it accepts even with no label; images and cover letters aren't", () => {
    const doc = parse(
      '<input type="file" id="r" accept="application/pdf,application/msword">' +
        '<input type="file" id="img" accept="image/*">' +
        '<label for="cl">Cover letter</label><input type="file" id="cl" accept=".pdf">',
    );
    const byId = Object.fromEntries(fieldsOf(doc).map((f) => [f.el.id, f]));
    expect(isResumeUpload(byId.r)).toBe(true);
    expect(isResumeUpload(byId.img)).toBe(false);
    expect(isResumeUpload(byId.cl)).toBe(false);
    expect(resolve(byId.r, copy()).skip).toBe("no_data"); // no file on hand
  });
});

describe("PR #31 review: wrong answers that must not happen", () => {
  it("a country list without a plain 'United States' gets the right one", () => {
    const c = copy();
    const options = [{ label: "United Kingdom" }, { label: "United States Minor Outlying Islands" }, { label: "United States of America" }];
    const doc = parse(
      `<label for="co">Country</label><select id="co"><option value="">Select</option>${options.map((o) => `<option>${o.label}</option>`).join("")}</select>`,
    );
    return session(doc)
      .fillKnown(c)
      .then(() => expect(doc.querySelector("#co").value).toBe("United States of America"));
  });

  it("'No' never picks 'Not applicable'", () => {
    expect(matchOption("No", [{ label: "Not applicable" }, { label: "None" }])).toBe(-1);
    expect(matchOption("No", [{ label: "Not applicable" }, { label: "No" }])).toBe(1);
  });

  it.each([
    ["I accept the Terms & Conditions", "checkbox", "consent"],
    ["I authorize a background check", "radio", "consent"],
    ["Do you agree to the terms?", "radio", "consent"],
    ["Military status", "select", "sensitive"],
    ["Have you served in the armed forces?", "radio", "sensitive"],
    ["Do you have a handicap?", "radio", "sensitive"],
    ["Date of birth", "date", "sensitive"],
    ["Are you a U.S. citizen?", "radio", "sensitive"],
    ["Social Security Number", "text", "sensitive"],
    ["Driver's license number", "text", "sensitive"],
  ])("never touches %s", (q, kind, why) => {
    expect(guardReason(q, kind)).toBe(why);
  });

  it.each([
    ["Excellent communication skills?", null],
    ["Please state your salary expectations", "desired_salary"],
    ["Are you authorized to work in the country where this job is located?", "authorized_to_work"],
    ["Reference 1 – Full name", null],
    ["Emergency contact phone", null],
    ["Cell phone", "phone"],
  ])("'%s' → %s", (q, key) => {
    expect(profileKeyFor({ question: q, hints: {} })).toBe(key);
  });

  it("a lone checkbox is never ticked, even with a remembered 'Yes'", async () => {
    const doc = parse(`<label><input type="checkbox" id="c"> Text me about my application</label>
      <label for="fn">First name</label><input id="fn">`);
    await session(doc).fillKnown(copy({ answers: [{ question_key: "text me about my application", answer: "Yes" }] }));
    expect(doc.querySelector("#c").checked).toBe(false);
  });

  it("Undo leaves alone a field the user changed after the fill", async () => {
    const doc = parse(`<label for="ph">Phone</label><input id="ph" type="tel">`);
    const s = session(doc);
    await s.fillKnown(copy());
    doc.querySelector("#ph").value = "555-999-0000"; // the user's correction
    await s.undo();
    expect(doc.querySelector("#ph").value).toBe("555-999-0000");
  });

  it("Remember never offers private numbers or a ticked box", () => {
    const doc = parse(`<label for="ssn">Social Security Number</label><input id="ssn">
      <label><input type="checkbox" id="c"> Text me updates</label>
      <label for="q">Favorite tool?</label><input id="q">`);
    const s = session(doc);
    doc.querySelector("#ssn").value = "000-00-0000";
    doc.querySelector("#c").checked = true;
    doc.querySelector("#q").value = "Vim";
    expect(s.typedAnswers().map((a) => a.question_text)).toEqual(["Favorite tool?"]);
  });
});
