// @vitest-environment happy-dom
// Spec 016: Autofill you can always find, that always works. The pure parts:
// is there a form here, the applicant-system list, reading every common label
// style, the phone beside a country-code picker, the résumé first, and
// filling only inside an open pop-up. Invented applicant only.
import { describe, expect, it, vi } from "vitest";
import { profileValues } from "../src/autofill/classify/profileKeys.js";
import { applicantHost, isApplyUrl } from "../src/autofill/hosts.js";
import { collectFields, dialCodeBeside, hasFormHere, questionFor } from "../src/autofill/scan.js";
import { nationalNumber, resolve } from "../src/autofill/resolve.js";
import { createSession } from "../src/autofill/session.js";

const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const PROFILE = {
  first_name: "Wren",
  last_name: "Calloway",
  phone: "+1 (555) 010-4477",
  address_line1: "12 Ferry Lane",
  city: "Harborview",
  state: "OR",
  postal_code: "97000",
  country: "United States",
};
const EMAIL = "wren@example.com";
const copy = (resumeFile = null) => ({ values: profileValues(PROFILE, EMAIL, new Date("2026-11-23T12:00:00")), answers: [], resumeFile });
const session = (doc, extra = {}) => createSession({ doc, send: vi.fn(async () => ({})), visible: () => true, ...extra });
const fieldsOf = (doc) => collectFields(doc, { visible: () => true });

describe("the applicant systems people really apply through", () => {
  it.each([
    ["https://www.paycomonline.net/v4/ats/web.php/portal/0000/career-page", "Paycom"],
    ["https://recruiting.paylocity.com/Recruiting/Jobs/Apply/123", "Paylocity"],
    ["https://recruiting2.ultipro.com/VEL1000/JobBoard/abc/OpportunityApply?opportunityId=1", "UKG"],
    ["https://vellacor.rec.pro.ukg.net/VEL1000/JobBoard/abc/OpportunityDetail?opportunityId=1", "UKG"],
    ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=1", "ADP"],
    ["https://jobs.dayforcehcm.com/en-US/vellacor/CANDIDATEPORTAL/jobs/42", "Dayforce"],
    ["https://vellacor.bamboohr.com/careers/42", "BambooHR"],
    ["https://careers-vellacor.icims.com/jobs/42/technician/job", "iCIMS"],
    ["https://vellacor.applytojob.com/apply/AbC123/Technician", "JazzHR"],
    ["https://ats.rippling.com/vellacor/jobs/0000/apply", "Rippling"],
  ])("%s → %s", (url, name) => {
    expect(applicantHost(url)?.name).toBe(name);
    expect(isApplyUrl(url)).toBe(true);
  });

  it("not their other pages, and not ordinary sites", () => {
    expect(applicantHost("https://www.paycomonline.net/v4/ee/web.php/app/login")).toBeNull(); // employee login
    expect(applicantHost("https://www.paylocity.com/our-products/")).toBeNull();
    expect(applicantHost("https://vellacor.bamboohr.com/home")).toBeNull();
    expect(isApplyUrl("https://news.example/2026/11/applications-open")).toBe(false);
    expect(isApplyUrl("https://careers.tidewell.example/jobs/42/apply")).toBe(true);
  });
});

describe("is there a form worth filling here?", () => {
  const opts = { isApplication: () => false };
  it("three fields, whatever the address", () => {
    const doc = parse(`<form><input placeholder="Your name"><input type="email" placeholder="Email"><textarea placeholder="Message"></textarea></form>`);
    expect(hasFormHere(fieldsOf(doc), opts)).toBe(true);
  });

  it("a sign-in box is not one (unless it's a sign-up-and-apply form)", () => {
    const login = parse(`<form><label for="u">Email</label><input id="u"><label for="p">Password</label><input id="p" type="password"><input id="x"></form>`);
    expect(hasFormHere(fieldsOf(login), opts)).toBe(false);
    const signup = parse(
      `<form><input type="password">${["First name", "Last name", "Email", "Phone", "City", "Zip"].map((l, i) => `<label for="f${i}">${l}</label><input id="f${i}">`).join("")}</form>`,
    );
    expect(hasFormHere(fieldsOf(signup), opts)).toBe(true);
  });

  it("two fields only when the site marks them as a person's details (or it's an application)", () => {
    const search = parse(`<form><input placeholder="Keywords"><input placeholder="Location"></form>`);
    expect(hasFormHere(fieldsOf(search), opts)).toBe(false);
    expect(hasFormHere(fieldsOf(search), { isApplication: () => true })).toBe(true);
    const contact = parse(`<form><input autocomplete="email"><input autocomplete="tel"></form>`);
    expect(hasFormHere(fieldsOf(contact), opts)).toBe(true);
  });

  it("no fields, no form", () => {
    expect(hasFormHere([], opts)).toBe(false);
  });
});

describe("reading the question, in every common label style", () => {
  const q = (html, sel = "input") => questionFor(parse(html).querySelector(sel));
  it.each([
    ["label before, linked by for", `<label for="a">First name</label><input id="a">`],
    ["label wrapping the box", `<label>First name <input></label>`],
    ["aria-labelledby", `<span id="l">First name</span><input aria-labelledby="l">`],
    ["aria-label", `<input aria-label="First name">`],
    ["floating label after the box", `<div class="field"><input id="x1"><label>First name</label></div>`],
    ["floating label span after the box", `<div class="mdc-text-field"><input><span class="mdc-floating-label">First name</span></div>`],
    ["table cell beside it", `<table><tr><td>First name</td><td><input></td></tr></table>`],
    ["placeholder only", `<div><input placeholder="First name"></div>`],
  ])("%s", (_name, html) => {
    expect(q(html)).toBe("First name");
  });

  it("a flat 'label, box, label, box' list never hands a box the NEXT label", () => {
    const doc = parse(`<form><label>First name</label><input id="a"><label>Last name</label><input id="b"></form>`);
    expect(questionFor(doc.querySelector("#a"))).toBe("First name");
    expect(questionFor(doc.querySelector("#b"))).toBe("Last name");
  });

  it("an error or hint line after the box is never its question", () => {
    expect(q(`<div><input aria-label="First name"><span class="error-label">This field is required</span></div>`)).toBe("First name");
    expect(q(`<div><label for="z">First name</label><div><input id="z"><label class="char-count-label">0/50</label></div></div>`)).toBe("First name");
  });

  it("a label of symbols only (':' or '*') gives way to the placeholder", () => {
    expect(q(`<div><span>:</span><input placeholder="City"></div>`)).toBe("City");
  });
});

describe("phone beside a country-code picker", () => {
  it("knows the national number", () => {
    expect(nationalNumber("+1 (555) 010-4477")).toBe("(555) 010-4477");
    expect(nationalNumber("+44 20 7946 0000")).toBe("20 7946 0000");
    expect(nationalNumber("15550104477")).toBe("5550104477");
    expect(nationalNumber("555-010-4477")).toBe("555-010-4477");
    // Stored without spaces (review of PR #33): never cut into the number.
    expect(nationalNumber("+15550104477")).toBe("5550104477");
    expect(nationalNumber("+447700900123")).toBe("+447700900123"); // unsure where the code ends: whole
    expect(nationalNumber("+1(555) 010-4477")).toBe("(555) 010-4477");
  });

  it("sees the picker, a '+1' in front, or '+1' already in the box", () => {
    const picker = parse(`<div><select><option>🇺🇸 +1</option></select><input id="p" type="tel"></div>`);
    expect(dialCodeBeside(picker.querySelector("#p"))).toBe(true);
    const prefix = parse(`<div><span>+1</span><input id="p" type="tel"></div>`);
    expect(dialCodeBeside(prefix.querySelector("#p"))).toBe(true);
    const inBox = parse(`<input id="p" type="tel" value="+1">`);
    expect(dialCodeBeside(inBox.querySelector("#p"))).toBe(true);
    const plain = parse(`<form><div><label for="p">Phone</label><input id="p" type="tel"></div><div><input id="c"></div></form>`);
    expect(dialCodeBeside(plain.querySelector("#p"))).toBe(false);
  });

  it("fills the national number there, the full one elsewhere — and a lone '+1' counts as empty", async () => {
    const doc = parse(`<form>
      <div><label for="cc">Country code</label><select id="cc"><option>+1</option><option>+44</option></select>
        <label for="p1">Mobile phone</label><input id="p1" type="tel"></div>
      <div><label for="p2">Phone number</label><input id="p2" type="tel" value="+1"></div>
    </form>`);
    await session(doc).fillKnown(copy());
    expect(doc.querySelector("#p1").value).toBe("(555) 010-4477");
    expect(doc.querySelector("#p2").value).toBe("(555) 010-4477");
    const plain = parse(`<form><label for="p">Phone</label><input id="p" type="tel"></form>`);
    const f = fieldsOf(plain)[0];
    expect(resolve(f, copy()).values[0]).toBe("+1 (555) 010-4477");
  });
});

describe("the résumé goes first; an open pop-up is filled alone", () => {
  it("uploads the résumé before anything else", async () => {
    const doc = parse(`<form><label for="fn">First name</label><input id="fn"><label for="r">Résumé</label><input id="r" type="file" accept=".pdf"></form>`);
    const s = session(doc);
    const file = new File(["%PDF"], "wren.pdf", { type: "application/pdf" });
    expect(await s.uploadResume(copy(file))).toBe(true);
    expect(doc.querySelector("#r").files[0].name).toBe("wren.pdf");
    expect(doc.querySelector("#fn").value).toBe(""); // the rest waits for the page to settle
    expect(await s.uploadResume(copy(file))).toBe(false); // never twice
  });

  it("with a pop-up open, only its fields count and fill", async () => {
    const doc = parse(`<form id="behind"><label for="q">Search jobs</label><input id="q"><label for="n0">Newsletter first name</label><input id="n0"></form>
      <div role="dialog" aria-modal="true" id="pop"><label for="fn">First name</label><input id="fn"><label for="ln">Last name</label><input id="ln"><label for="em">Email</label><input id="em" type="email"></div>`);
    const s = session(doc, { scope: () => doc.querySelector("#pop") });
    expect(s.presence()).toMatchObject({ form: true, app: true, fields: 3 });
    await s.fillKnown(copy());
    expect(doc.querySelector("#fn").value).toBe("Wren");
    expect(doc.querySelector("#n0").value).toBe(""); // behind the pop-up: left alone
  });

  it("a pop-up holding a single box is filled alone; one whose boxes aren't showing leaves the page as is", async () => {
    const doc = parse(`<form><label for="fn">First name</label><input id="fn"><label for="ln">Last name</label><input id="ln"></form>
      <div role="dialog" aria-modal="true" id="pop"><label for="em">Email</label><input id="em" type="email"></div>
      <div role="dialog" id="empty"></div>`);
    const one = session(doc, { scope: () => doc.querySelector("#pop") });
    await one.fillKnown(copy());
    expect(doc.querySelector("#em").value).toBe("wren@example.com");
    expect(doc.querySelector("#fn").value).toBe(""); // behind the pop-up
    const none = session(doc, { scope: () => doc.querySelector("#empty") });
    expect(none.presence().fields).toBe(3);
  });
});
