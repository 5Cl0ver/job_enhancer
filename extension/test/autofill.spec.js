// ATS autofill — mapper (label → vault key) and fill engine, tested against
// saved Greenhouse/Lever form markup. If an ATS changes its forms, these
// fixtures go red and we fix ONE adapter concern, same as the extractor.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { detectAts, collectFields, keyFor } from "../src/autofill/mapper.js";
import { fillFields, buildValues, setNativeValue, setSelectValue } from "../src/autofill/fill.js";

const here = dirname(fileURLToPath(import.meta.url));
function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const w = new Window();
  w.document.write(html);
  return w.document;
}

const PROFILE = {
  first_name: "Fabian",
  last_name: "Example",
  phone: "(555) 010-0199",
  city: "Los Angeles",
  state: "California",
  country: "United States",
  linkedin_url: "https://linkedin.com/in/fabian",
  github_url: "https://github.com/5Cl0ver",
  portfolio_url: "https://fabian.dev",
  authorized_to_work: true,
  requires_sponsorship: false,
  willing_to_relocate: null,
  desired_salary: 95000,
  notice_period: "2 weeks",
};

describe("detectAts", () => {
  it("recognizes the two supported ATSs and nothing else", () => {
    expect(detectAts("https://boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectAts("https://job-boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectAts("https://jobs.lever.co/acme/uuid/apply")).toBe("lever");
    expect(detectAts("https://company.wd5.myworkdayjobs.com/careers")).toBeNull();
    expect(detectAts("https://www.indeed.com/viewjob?jk=x")).toBeNull();
  });
});

describe("Greenhouse form mapping", () => {
  const doc = docFrom("greenhouse-form.html");
  const byKey = Object.fromEntries(collectFields(doc).map((f) => [f.key, f.el]));

  it("maps the standard fields", () => {
    expect(byKey.first_name.id).toBe("first_name");
    expect(byKey.last_name.id).toBe("last_name");
    expect(byKey.email.id).toBe("email");
    expect(byKey.phone.id).toBe("phone");
    expect(byKey.location.id).toBe("job_application_location");
    expect(byKey.resume_file.id).toBe("resume");
  });

  it("maps custom questions by their visible labels", () => {
    expect(byKey.linkedin_url.id).toContain("answers_attributes_0");
    expect(byKey.portfolio_url.id).toContain("answers_attributes_1");
    expect(byKey.authorized_to_work.tagName).toBe("SELECT");
    expect(byKey.requires_sponsorship.tagName).toBe("SELECT");
  });

  it("refuses essays, cover letters, and hidden inputs", () => {
    const keys = Object.keys(byKey);
    // "Why do you want to work at Acme?" and the cover-letter upload stay ours.
    const essay = doc.querySelector("#job_application_answers_attributes_4_text_value");
    expect(keyFor(essay, doc)).toBeNull();
    const cover = doc.querySelector("#cover_letter");
    expect(keyFor(cover, doc)).toBeNull();
    expect(keys).not.toContain("csrf_token");
  });

  it("fills the form from the vault (selects included) and reports honestly", () => {
    const values = buildValues(PROFILE, "fabian@example.com");
    const { filled, attention } = fillFields(collectFields(doc), values, null);

    expect(doc.querySelector("#first_name").value).toBe("Fabian");
    expect(doc.querySelector("#email").value).toBe("fabian@example.com");
    expect(doc.querySelector("#job_application_location").value).toBe(
      "Los Angeles, California",
    );
    // Work auth: Yes; sponsorship: No — matched by option TEXT.
    expect(doc.querySelector("#job_application_answers_attributes_2_boolean_value").value).toBe("1");
    expect(doc.querySelector("#job_application_answers_attributes_3_boolean_value").value).toBe("0");
    expect(filled).toContain("authorized_to_work");
    // No resume file passed → flagged for attention, not silently skipped.
    expect(attention).toContain("resume_file");
  });

  it("never overwrites what the user already typed", () => {
    const doc2 = docFrom("greenhouse-form.html");
    const el = doc2.querySelector("#first_name");
    setNativeValue(el, "MyOwnName");
    fillFields(collectFields(doc2), buildValues(PROFILE, "x@y.z"), null);
    expect(el.value).toBe("MyOwnName");
  });
});

describe("Lever form mapping (name-attribute + placeholder style)", () => {
  const doc = docFrom("lever-form.html");
  const byKey = Object.fromEntries(collectFields(doc).map((f) => [f.key, f.el]));

  it("maps full name, contacts, urls, location, resume", () => {
    expect(byKey.full_name.getAttribute("name")).toBe("name");
    expect(byKey.email.getAttribute("name")).toBe("email");
    expect(byKey.phone.getAttribute("name")).toBe("phone");
    expect(byKey.linkedin_url.getAttribute("name")).toBe("urls[LinkedIn]");
    expect(byKey.github_url.getAttribute("name")).toBe("urls[GitHub]");
    expect(byKey.portfolio_url.getAttribute("name")).toBe("urls[Portfolio]");
    expect(byKey.location.getAttribute("name")).toBe("location");
    expect(byKey.resume_file.getAttribute("name")).toBe("resume");
  });

  it("fills full_name as first+last and leaves 'Additional information' alone", () => {
    const { filled } = fillFields(
      collectFields(doc),
      buildValues(PROFILE, "fabian@example.com"),
      null,
    );
    expect(doc.querySelector("[name='name']").value).toBe("Fabian Example");
    expect(doc.querySelector("[name='comments']").value).toBe("");
    expect(filled).toContain("full_name");
  });
});

describe("select matching", () => {
  it("matches by text, value, or prefix", () => {
    const w = new Window();
    w.document.write(
      `<select id="s"><option value=""></option><option value="us_state_CA">California</option></select>`,
    );
    const el = w.document.querySelector("#s");
    expect(setSelectValue(el, "California")).toBe(true);
    expect(el.value).toBe("us_state_CA");
    expect(setSelectValue(el, "Narnia")).toBe(false);
  });
});
