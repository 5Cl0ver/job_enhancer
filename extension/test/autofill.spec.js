// ATS autofill — mapper (label → vault key) and fill engine, tested against
// saved Greenhouse/Lever form markup. If an ATS changes its forms, these
// fixtures go red and we fix ONE adapter concern, same as the extractor.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import {
  detectAts,
  collectFields,
  keyFor,
  normalizeQuestion,
  collectUnmapped,
  collectRadioGroups,
  matchAnswer,
} from "../src/autofill/mapper.js";
import {
  fillFields,
  buildValues,
  setNativeValue,
  setSelectValue,
  fillCustomAnswers,
  fillRadioGroups,
  captureAnswers,
  captureRadioAnswers,
} from "../src/autofill/fill.js";

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
  address_line1: "123 Main St",
  address_line2: "Apt 4",
  city: "Los Angeles",
  state: "California",
  postal_code: "90001",
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

describe("universal matching — autocomplete + address (any site, e.g. Amazon Jobs)", () => {
  function amazonForm() {
    const w = new Window();
    w.document.write(`
      <form>
        <label for="fn">First name</label><input id="fn" autocomplete="given-name" />
        <label for="ln">Last name</label><input id="ln" autocomplete="family-name" />
        <label for="em">Email address</label><input id="em" type="email" />
        <label for="ph">Phone number</label><input id="ph" type="tel" />
        <label for="a1">Address line 1 (Street address, P.O. Box, etc...)</label><input id="a1" />
        <label for="a2">Address line 2 (Unit, suite, etc...)</label><input id="a2" />
        <label for="ct">City</label><input id="ct" />
        <label for="pc">Postal/Zip code</label><input id="pc" />
        <label for="co">Country/Region</label><select id="co"><option value=""></option><option>United States</option></select>
        <label for="st">Province/State</label><select id="st"><option value=""></option><option>California</option></select>
      </form>`);
    return w.document;
  }

  it("maps contact + address fields via autocomplete attrs and labels", () => {
    const doc = amazonForm();
    const byKey = Object.fromEntries(collectFields(doc).map((f) => [f.key, f.el]));
    expect(byKey.first_name.id).toBe("fn"); // autocomplete="given-name"
    expect(byKey.last_name.id).toBe("ln");
    expect(byKey.email.id).toBe("em");
    expect(byKey.phone.id).toBe("ph");
    expect(byKey.address_line1.id).toBe("a1");
    expect(byKey.address_line2.id).toBe("a2");
    expect(byKey.city.id).toBe("ct");
    expect(byKey.postal_code.id).toBe("pc");
    expect(byKey.country.id).toBe("co"); // "Country/Region" beats the /region/ state alias
    expect(byKey.state.id).toBe("st");
  });

  it("fills the whole contact step, selects included", () => {
    const doc = amazonForm();
    const { filled } = fillFields(collectFields(doc), buildValues(PROFILE, "fabian@example.com"), null);
    expect(doc.querySelector("#fn").value).toBe("Fabian");
    expect(doc.querySelector("#a1").value).toBe("123 Main St");
    expect(doc.querySelector("#a2").value).toBe("Apt 4");
    expect(doc.querySelector("#ct").value).toBe("Los Angeles");
    expect(doc.querySelector("#pc").value).toBe("90001");
    expect(doc.querySelector("#co").value).toBe("United States");
    expect(doc.querySelector("#st").value).toBe("California");
    expect(filled).toEqual(
      expect.arrayContaining(["first_name", "address_line1", "city", "postal_code", "country", "state"]),
    );
  });
});

describe("learn-as-you-go — custom question memory", () => {
  function questionForm() {
    const w = new Window();
    w.document.write(`
      <form>
        <label for="fn">First name</label><input id="fn" autocomplete="given-name" />
        <label for="q1">Years of React experience? *</label><input id="q1" />
        <label for="q2">How did you hear about us?</label><input id="q2" />
        <label for="q3">What is your favorite programming language?</label><input id="q3" type="text" />
      </form>`);
    return w.document;
  }

  it("normalizes questions into stable keys", () => {
    expect(normalizeQuestion("Years of React experience? *")).toBe("years of react experience");
    expect(normalizeQuestion("How did you hear about us? (required)")).toBe(
      "how did you hear about us",
    );
  });

  it("collects only the UNMAPPED questions (skips profile fields)", () => {
    const keys = collectUnmapped(questionForm()).map((u) => u.questionKey);
    expect(keys).toContain("years of react experience");
    expect(keys).toContain("how did you hear about us");
    expect(keys).toContain("what is your favorite programming language");
    expect(keys).not.toContain("first name"); // that one maps to the profile
  });

  it("matches by exact key, then fuzzy token overlap", () => {
    const mem = [{ question_key: "years of react experience", answer: "3" }];
    expect(matchAnswer("years of react experience", mem)?.answer).toBe("3");
    // Reworded/extended question still matches (Jaccard ≥ 0.6).
    expect(matchAnswer("years of react experience at acme", mem)?.answer).toBe("3");
    expect(matchAnswer("favorite programming language", mem)).toBeNull();
  });

  it("fills learned answers and reports what still needs answering", () => {
    const doc = questionForm();
    const mem = [
      { question_key: "years of react experience", question_text: "Years…", answer: "3" },
    ];
    const { learned, remaining } = fillCustomAnswers(collectUnmapped(doc), mem, matchAnswer);
    expect(doc.querySelector("#q1").value).toBe("3");
    expect(learned.map((l) => l.questionKey)).toContain("years of react experience");
    expect(learned[0].value).toBe("3");
    const remKeys = remaining.map((r) => r.questionKey);
    expect(remKeys).toContain("how did you hear about us");
    expect(remKeys).toContain("what is your favorite programming language");
  });

  it("captures the user's own answers to remember them", () => {
    const doc = questionForm();
    setNativeValue(doc.querySelector("#q2"), "LinkedIn");
    setNativeValue(doc.querySelector("#q3"), "2026-09-01");
    const captured = captureAnswers(collectUnmapped(doc));
    const byKey = Object.fromEntries(captured.map((c) => [c.question_key, c.answer]));
    expect(byKey["how did you hear about us"]).toBe("LinkedIn");
    expect(byKey["what is your favorite programming language"]).toBe("2026-09-01");
    // Empty question (q1) isn't captured.
    expect(byKey["years of react experience"]).toBeUndefined();
  });
});

describe("radio groups — yes/no questions (e.g. Amazon Work Eligibility)", () => {
  function radioForm() {
    const w = new Window();
    w.document.write(`
      <form>
        <div>
          <p>If offered employment by Amazon, would you be legally eligible to begin employment immediately?</p>
          <label><input type="radio" name="elig" value="Yes" />Yes</label>
          <label><input type="radio" name="elig" value="No" />No</label>
        </div>
        <div>
          <p>Have you previously applied to Amazon or any subsidiary?</p>
          <label><input type="radio" name="prev" value="Yes" />Yes</label>
          <label><input type="radio" name="prev" value="No" />No</label>
        </div>
      </form>`);
    return w.document;
  }

  it("maps a work-eligibility group to the profile, leaves others custom", () => {
    const groups = collectRadioGroups(radioForm());
    const elig = groups.find((g) => g.questionKey.includes("legally eligible"));
    const prev = groups.find((g) => g.questionKey.includes("previously applied"));
    expect(elig.key).toBe("authorized_to_work");
    expect(prev.key).toBeNull(); // custom → learnable
    expect(elig.options.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  it("fills profile yes/no + learned yes/no, and reports the rest", () => {
    const doc = radioForm();
    const groups = collectRadioGroups(doc);
    const mem = [
      {
        question_key: normalizeQuestion("Have you previously applied to Amazon or any subsidiary?"),
        answer: "No",
      },
    ];
    const { filled, learned } = fillRadioGroups(
      groups,
      buildValues({ authorized_to_work: true }, ""),
      mem,
      matchAnswer,
    );
    expect(doc.querySelector('input[name="elig"][value="Yes"]').checked).toBe(true);
    expect(doc.querySelector('input[name="prev"][value="No"]').checked).toBe(true);
    expect(filled).toContain("authorized_to_work");
    expect(learned[0].value).toBe("No");
  });

  it("captures the user's radio choice for CUSTOM questions only", () => {
    const doc = radioForm();
    doc.querySelector('input[name="prev"][value="Yes"]').checked = true;
    doc.querySelector('input[name="elig"][value="No"]').checked = true;
    const captured = captureRadioAnswers(collectRadioGroups(doc));
    // Only the custom "previously applied" question is remembered (elig is profile-driven).
    expect(captured).toHaveLength(1);
    expect(captured[0].answer).toBe("Yes");
    expect(captured[0].question_key).toContain("previously applied");
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
