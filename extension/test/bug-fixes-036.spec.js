// Spec 036: fixes from the owner's Bugs & ideas reports. Invented company
// and applicant. Happy-dom builds of the lab pages (the browser lab, e2e/,
// covers the real layout):
// - B: the phone never goes in Phone Extension, also from a remembered
//   answer or a taught box, and a box the user emptied stays empty after the
//   site re-draws it;
// - C: sponsorship questions get the profile's answer, whatever their
//   wording, and a remembered legal answer never beats the profile;
// - D: Workday's search prompt ("How Did You Hear About Us?") counts only a
//   pill, and a choice the page drops is reported as still needing an answer.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { matchOption } from "../src/autofill/classify/answers.js";
import { profileKeyFor, profileValues } from "../src/autofill/classify/profileKeys.js";
import { resolve } from "../src/autofill/resolve.js";
import { collectFields } from "../src/autofill/scan.js";
import { createSession, taughtDecision } from "../src/autofill/session.js";

const here = dirname(fileURLToPath(import.meta.url));
const lab = (name) => readFileSync(join(here, "lab", name), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
const PROFILE = { first_name: "Wren", last_name: "Calloway", phone: "555-010-4477", city: "Harborview", authorized_to_work: true, requires_sponsorship: false };
const VALUES = profileValues(PROFILE, "wren@example.com");
const field = (question, extra = {}) => ({ question, kind: "text", key: question.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim(), hints: {}, ...extra });

function page(html) {
  const w = new Window();
  const doc = w.document;
  doc.body.innerHTML = `<div data-automation-id="mainContent">${html}</div>`;
  return doc;
}

// ---- B. Phone Extension ------------------------------------------------------

describe("B: the phone number never goes in Phone Extension", () => {
  const ext = field("Phone Extension", { hints: { id: "phoneNumber--extension", type: "tel" } });

  it("a remembered 'phone extension' that is the whole number is never filled; a real extension is", () => {
    const whole = resolve(ext, { values: VALUES, answers: [{ question_key: "phone extension", answer: "555-010-4477" }] });
    expect(whole).toEqual({ skip: "no_data" });
    const real = resolve(ext, { values: VALUES, answers: [{ question_key: "phone extension", answer: "204" }] });
    expect(real.values).toEqual(["204"]);
  });

  it("a box taught as the phone that is the extension: never the number", () => {
    expect(taughtDecision(ext, { profile_key: "phone" }, { values: VALUES })).toEqual({ skip: "no_data" });
    expect(taughtDecision(ext, { answer: "5550104477" }, { values: VALUES })).toEqual({ skip: "no_data" });
    expect(taughtDecision(ext, { answer: "12" }, { values: VALUES })).toEqual({ values: ["12"], source: "learned" });
    // The number's own box still gets the phone.
    const number = field("Phone Number", { hints: { id: "phoneNumber--phoneNumber", type: "tel" } });
    expect(taughtDecision(number, { profile_key: "phone" }, { values: VALUES }).values).toEqual(["555-010-4477"]);
  });

  /** The lab's My Information step, drawn again as new boxes (Workday's Back). */
  const STEP = (vals = {}) => `
    <div data-automation-id="formField-phone"><label for="phoneNumber--phoneNumber">Phone Number</label><input id="phoneNumber--phoneNumber" type="tel" value="${vals.phone ?? ""}"></div>
    <div data-automation-id="formField-ext"><label for="phoneNumber--extension">Phone Extension</label><input id="phoneNumber--extension" type="tel" value="${vals.ext ?? ""}"></div>
    <div data-automation-id="formField-city"><label for="addressSection_city">City</label><input id="addressSection_city" value="${vals.city ?? ""}"></div>
    <div data-automation-id="formField-schedule"><label for="schedule">Preferred work schedule</label><input id="schedule" value="${vals.schedule ?? ""}"></div>`;
  const OTHER = `<div><label for="t">Job Title</label><input id="t"></div><div><label for="c">Company</label><input id="c"></div>`;

  it("a box the user emptied stays empty after a step change and back: by itself and on a press", async () => {
    const doc = page(`<div id="step">${STEP({ ext: "555-010-4477" })}</div>`);
    const emptied = new Set();
    const s = createSession({ doc, send: async () => ({}), visible: () => true, userEdited: (el) => emptied.has(el.id) && el.value === "" });
    const copy = { values: VALUES, answers: [{ question_key: "phone extension", answer: "555-010-4477" }], taught: [] };
    await s.fillKnown(copy);
    expect(doc.querySelector("#addressSection_city").value).toBe("Harborview");
    // The user empties the extension (the old mistake) and City.
    for (const id of ["phoneNumber--extension", "addressSection_city"]) {
      doc.getElementById(id).value = "";
      emptied.add(id);
    }
    // Save and Continue, then Back: the step drawn again, new boxes.
    doc.querySelector("#step").innerHTML = OTHER;
    await s.fillKnown(copy, { auto: true });
    doc.querySelector("#step").innerHTML = STEP({ phone: "555-010-4477" });
    await s.fillKnown(copy, { auto: true });
    expect(doc.querySelector("#phoneNumber--extension").value).toBe("");
    expect(doc.querySelector("#addressSection_city").value).toBe("");
    await s.fillKnown(copy); // a press
    expect(doc.querySelector("#phoneNumber--extension").value).toBe("");
    expect(doc.querySelector("#addressSection_city").value).toBe("");
  });

  it("after a re-draw, Job Catcher's own fills are never offered to Remember, nor the phone in the extension", async () => {
    const doc = page(`<div id="step">${STEP()}</div>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    const copy = { values: VALUES, answers: [{ question_key: "preferred work schedule", answer: "Days" }], taught: [] };
    await s.fillKnown(copy);
    expect(doc.querySelector("#schedule").value).toBe("Days");
    // Next step, then Back: the same values, new boxes; the page put the
    // whole number in the extension box.
    doc.querySelector("#step").innerHTML = OTHER;
    await s.fillKnown(copy, { auto: true });
    doc.querySelector("#step").innerHTML = STEP({ phone: "555-010-4477", ext: "(555) 010-4477", city: "Harborview", schedule: "Days" });
    expect(s.typedAnswers()).toEqual([]);
    // A real change by the user is still offered.
    doc.querySelector("#schedule").value = "Evenings";
    expect(s.typedAnswers().map((a) => [a.question_key, a.answer])).toEqual([["preferred work schedule", "Evenings"]]);
  });
});

// ---- C. Sponsorship ----------------------------------------------------------

describe("C: sponsorship gets the profile's answer, whatever the wording", () => {
  const copy = { values: VALUES, answers: [] };
  const answer = (q) => resolve(field(q), copy).values?.[0];

  it("sponsorship questions that also say 'legally work' or 'work authorization' are about sponsorship: No", () => {
    for (const q of [
      "Will you now, or in the future, require sponsorship to legally work in the United States?",
      "Will you now or in the future require the company's sponsorship to obtain or maintain work authorization?",
      "Do you require sponsorship to be eligible for employment in the U.S.?",
      "Will you require visa sponsorship now or in the future? (If you do not require sponsorship, select No)",
    ]) {
      expect([q, profileKeyFor(field(q))]).toEqual([q, "requires_sponsorship"]);
      expect([q, answer(q)]).toEqual([q, "No"]);
    }
  });

  it("the reversed question is answered the other way round: Yes", () => {
    for (const q of ["Are you able to work in the US without visa sponsorship?", "Do you NOT require sponsorship?"]) {
      expect([q, profileKeyFor(field(q))]).toEqual([q, "no_sponsorship_needed"]);
      expect([q, answer(q)]).toEqual([q, "Yes"]);
    }
    // Needing sponsorship makes it No; an unknown profile, nothing.
    const needs = profileValues({ ...PROFILE, requires_sponsorship: true });
    expect(needs.no_sponsorship_needed).toEqual(["No"]);
    expect(profileValues({}).no_sponsorship_needed).toEqual([]);
  });

  it("work authorization is still Yes, help text after the question doesn't change it", () => {
    expect(answer("Are you authorized to work in the U.S.?")).toBe("Yes");
    expect(answer("Are you legally authorized to work in the U.S.? Note: we do not sponsor visas.")).toBe("Yes");
  });

  it("two questions in one are left for the user", () => {
    for (const q of ["Are you legally authorized to work in the US, and will you require sponsorship?", "Are you authorized to work in the US? Will you require sponsorship?"]) {
      expect([q, profileKeyFor(field(q))]).toEqual([q, null]);
      expect(resolve(field(q, { kind: "radio" }), copy).skip).toBe("unknown");
    }
  });

  // Every wording from the reviews (spec 036), for someone authorized who
  // needs no sponsorship. null: left for the user (never a guess).
  const WORDINGS = [
    ["Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?", "No"],
    ["Will you now, or in the future, require sponsorship to legally work in the United States?", "No"],
    ["Are you legally authorized to work in the US?", "Yes"],
    ["Are you legally authorized to work in the United States?", "Yes"],
    ["Do you have the legal right to work in the United States?", "Yes"],
    ["Do you have the legal right to work in the country where this job is located?", "Yes"],
    ["Will you require Kenexa sponsorship to work in the US?", "No"],
    ["Will you require company sponsorship to work in the US?", "No"],
    ["Are you able to work without the need for sponsorship now or in the future?", "Yes"],
    ["Are you able to work in the US without visa sponsorship?", "Yes"],
    ["Do you need a visa to work?", "No"],
    ["Do you need a visa to work in the United States?", "No"],
    ["Will you need visa support to work here?", "No"],
    ["Do you require visa sponsorship?", "No"],
    ["Do you now or will you in the future require immigration sponsorship?", "No"],
    ["Would you need sponsorship?", "No"],
    ["Visa sponsorship required?", "No"],
    ["Sponsorship required", "No"],
    ["Do you NOT require sponsorship?", "Yes"],
    ["Can you work in the US without requiring sponsorship?", "Yes"],
    ["Are you eligible to work in the US without sponsorship?", "Yes"],
    ["Are you currently eligible to work in the U.S. without company sponsorship?", "Yes"],
    ["Are you authorized to work in the US without sponsorship?", "Yes"],
    ["Will you be able to work without sponsorship?", "Yes"],
    ["Are you authorized to work lawfully in the U.S. for any employer without the need for visa sponsorship now or in the future?", "Yes"],
    ["Is sponsorship not required for you?", "Yes"],
    ["Is sponsorship required for you to work in the US? We do not sponsor visas.", "No"],
    ["Will you now or in the future require sponsorship? Note: we cannot sponsor without a visa", "No"],
    ["Are you authorized to work in the U.S.? We do not provide sponsorship.", "Yes"],
    ["Are you legally authorized to work in the US, and will you require sponsorship?", null],
    ["Are you authorized to work in the US? Will you require sponsorship?", null],
    ["Are you legally eligible to work in the US and do you not require sponsorship?", null],
    ["Are you legally authorized to work in the United States and not require sponsorship now or in the future?", null],
    ["Are you legally authorized to work in the U.S. without sponsorship?", "Yes"],
    ["I will not require sponsorship", "Yes"],
    ["Do you currently hold, or will you require, sponsorship for an employment visa?", "No"],
    ["Will you now or in the future need the company to sponsor you for a work visa?", "No"],
    ["Would you require us to sponsor a visa now or in the future?", "No"],
    ["Do you require H-1B sponsorship?", "No"],
    ["Are you a U.S. citizen or permanent resident?", null],
    ["Work Authorization", "Yes"],
    ["Will you require visa sponsorship now or in the future (if you do not need sponsorship, select No)?", "No"],
    ["Will you require visa sponsorship now or in the future? (if you do not need sponsorship, select No)", "No"],
    ["Will you require sponsorship now or in the future (if you are not sure whether you need sponsorship, select Yes)", "No"],
    ["Sponsorship - please answer No if you can work without sponsorship", "No"],
    ["Will you now or in the future require sponsorship (H-1B, TN, etc.) to work without restriction in the US?", "No"],
    ["Will you require sponsorship to continue working without interruption?", "No"],
    ["Do you require sponsorship to work in the US? If not, select No.", "No"],
    ["Visa Sponsorship Required: We are not able to sponsor at this time. Will you require sponsorship?", "No"],
    ["We are unable to sponsor. Do you need sponsorship?", "No"],
    ["Will you require sponsorship? *", "No"],
    ["Do you or will you require sponsorship? Note: candidates who will not need sponsorship are preferred", "No"],
    ["Would you now or in the future require the company to sponsor your work visa, and if so, which type?", "No"],
    ["Are you legally authorized to work in the United States (we are unable to sponsor visas for this role)", "Yes"],
    ["Legally authorized to work in the US. Note: this position is not eligible for sponsorship", "Yes"],
    ["Work authorization: are you legally authorized to work in the U.S. (sponsorship not available)", "Yes"],
    ["Are you legally authorized to work in the U.S. (this role does not offer visa sponsorship)?", "Yes"],
    ["Are you authorized to work in the US for this employer? Sponsorship is not available.", "Yes"],
    ["Are you legally authorized to work in the United States and not require sponsorship now or in the future?", null],
    ["Are you authorized to work in the US for this employer? Sponsorship is not available.", "Yes"],
  ];
  it.each(WORDINGS)("%s → %s", (q, want) => {
    const d = resolve(field(q, { kind: "select", options: [{ label: "Yes" }, { label: "No" }] }), copy);
    if (want === null) expect(d.values).toBeUndefined();
    else expect(d.values?.[0]).toBe(want);
  });

  it("a passing mention of sponsorship never makes it a sponsorship question", () => {
    for (const q of [
      "Are you legally authorized to work in the U.S. (this role does not offer visa sponsorship)?",
      "Legally authorized to work in the US. Note: this position is not eligible for sponsorship",
      "Work authorization: are you legally authorized to work in the U.S. (sponsorship not available)",
    ]) expect([q, profileKeyFor(field(q))]).toEqual([q, "authorized_to_work"]);
    for (const q of [
      "Will you require visa sponsorship now or in the future (if you do not need sponsorship, select No)?",
      "Sponsorship - please answer No if you can work without sponsorship",
    ]) expect([q, profileKeyFor(field(q))]).toEqual([q, "requires_sponsorship"]);
  });

  it("a remembered relocation answer still fills (a preference, not a legal fact)", () => {
    const q = field("Are you willing to relocate?", { kind: "select", options: [{ label: "Yes" }, { label: "No" }] });
    const values = profileValues({ ...PROFILE, willing_to_relocate: false });
    expect(resolve(q, { values, answers: [{ question_key: q.key, answer: "Yes" }] }).values).toEqual(["Yes"]);
  });

  it("each way the choices are worded finds the right one", () => {
    const opts = (...labels) => labels.map((label) => ({ label }));
    expect(matchOption("No", opts("Yes", "No"))).toBe(1);
    expect(matchOption("No", opts("Yes, I will require sponsorship", "No, I will not require sponsorship"))).toBe(1);
    expect(matchOption("No", opts("I will require sponsorship", "I will not require sponsorship"))).toBe(1);
    expect(matchOption("Yes", opts("Yes, I will require sponsorship", "No, I will not require sponsorship"))).toBe(0);
  });

  it("a remembered @requires_sponsorship that contradicts the profile is offered, never filled", () => {
    const q = field("Will you now or in the future require sponsorship?", { kind: "radio" });
    const d = resolve(q, { values: VALUES, answers: [{ question_key: "@requires_sponsorship", answer: "Yes" }] });
    expect(d).toMatchObject({ skip: "unknown", offer: "Yes" });
    // One that agrees is used.
    expect(resolve(q, { values: VALUES, answers: [{ question_key: "@requires_sponsorship", answer: "No" }] }).values).toEqual(["No"]);
  });

  it("the lab's Workday questions: every sponsorship wording answered from the profile, the double one left", async () => {
    const doc = page(lab("workday-sponsorship.html").replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, ""));
    // The Workday listbox, as the page draws it.
    const btn = doc.getElementById("sponsor-legally");
    btn.addEventListener("click", () => {
      const open = doc.getElementById("sponsor-legally-list");
      if (open) return open.remove();
      const list = doc.createElement("ul");
      list.setAttribute("role", "listbox");
      list.id = "sponsor-legally-list";
      for (const o of ["Yes", "No"]) {
        const li = doc.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = o;
        li.addEventListener("click", () => {
          btn.textContent = o;
          list.remove();
        });
        list.appendChild(li);
      }
      btn.after(list);
    });
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: VALUES, answers: [], taught: [] });
    const checked = (name) => doc.querySelector(`input[name="${name}"]:checked`)?.value || "";
    expect(btn.textContent).toBe("No");
    expect(checked("sponsor-authorization")).toBe("No");
    const sel = doc.getElementById("sponsor-eligible");
    expect(sel.options[sel.selectedIndex].textContent).toBe("No, I will not require sponsorship");
    expect(checked("without-sponsorship")).toBe("Yes");
    expect(checked("authorized")).toBe("Yes");
    expect(checked("both")).toBe("");
    expect(s.report().need_you.map((n) => n.label)).toEqual(["Are you legally authorized to work in the US, and will you require sponsorship?"]);

    // The user changes a sponsorship answer: never remembered as an answer
    // (a legal fact), offered as "Save to my profile" instead.
    const yes = doc.querySelector('input[name="sponsor-authorization"][value="Yes"]');
    yes.checked = true;
    expect(s.typedAnswers().filter((a) => /sponsor|authori/i.test(a.question_text))).toEqual([]);
    const without = doc.querySelector('input[name="without-sponsorship"][value="No"]');
    without.checked = true;
    expect(s.typedProfile(VALUES)).toEqual({ requires_sponsorship: true });
  });
});

// ---- D. Workday's search prompt ---------------------------------------------

/**
 * "How Did You Hear About Us?" as Workday draws it: results only after
 * Enter, a pill per choice, a category opens its own list, typed text is
 * cleared when the box is left. `topOnly`: a search finds only the top level.
 */
function hearAbout(doc, { topOnly = false } = {}) {
  doc.querySelector("[data-automation-id=mainContent]").insertAdjacentHTML(
    "beforeend",
    `<div data-automation-id="formField-source"><label for="source--source">How Did You Hear About Us?</label>
      <div data-automation-id="multiselectInputContainer">
        <ul data-automation-id="selectedItemList" role="listbox"></ul>
        <input id="source--source" type="text" data-uxi-widget-type="selectinput" placeholder="Search">
      </div></div>`,
  );
  const CATALOG = [
    { label: "Company Website" },
    { label: "Job Board", items: ["Indeed", "Glassdoor Jobs"] },
    { label: "Social Media", items: ["LinkedIn", "Facebook"] },
  ];
  const input = doc.getElementById("source--source");
  const pills = doc.querySelector("[data-automation-id=selectedItemList]");
  let pop = null;
  const close = () => {
    pop?.remove();
    pop = null;
  };
  const add = (label) => {
    const li = doc.createElement("li");
    li.setAttribute("data-automation-id", "selectedItem");
    li.textContent = label;
    pills.appendChild(li);
    input.value = "";
    close();
  };
  const show = (entries) => {
    close();
    pop = doc.createElement("div");
    pop.setAttribute("data-automation-activepopup", "true");
    for (const e of entries) {
      const opt = doc.createElement("div");
      opt.setAttribute("role", "option");
      opt.innerHTML = '<div data-automation-id="promptOption"><div data-automation-id="promptLeafNode"></div></div>';
      opt.querySelector("[data-automation-id=promptLeafNode]").textContent = e.label;
      opt.addEventListener("click", () => (e.items ? show(e.items.map((label) => ({ label }))) : add(e.label)));
      pop.appendChild(opt);
    }
    doc.body.appendChild(pop);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return close();
    if (e.key !== "Enter") return;
    const q = input.value.trim().toLowerCase();
    const hits = [];
    for (const c of CATALOG) {
      if (c.label.toLowerCase().includes(q)) hits.push(c);
      if (!topOnly) for (const item of c.items || []) if (item.toLowerCase().includes(q)) hits.push({ label: item });
    }
    show(hits);
  });
  input.addEventListener("blur", () => (input.value = ""));
  return { input, pills: () => [...pills.children].map((c) => c.textContent) };
}

const HEARD = "how did you hear about us";

describe("D: Workday's 'How Did You Hear About Us?' counts only a pill", () => {
  it("the real markup is a search prompt, never a text box", () => {
    const doc = page("");
    hearAbout(doc);
    const f = collectFields(doc, { visible: () => true }).find((x) => x.question.startsWith("How Did You Hear"));
    expect(f.kind).toBe("chips");
    expect(f.single).toBe(true);
  });

  it("a remembered 'LinkedIn' becomes a LinkedIn pill and an entry", async () => {
    const doc = page("");
    const m = hearAbout(doc);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: {}, answers: [{ question_key: HEARD, answer: "LinkedIn" }], taught: [] });
    expect(m.pills()).toEqual(["LinkedIn"]);
    const r = s.report();
    expect(r.entries.map((e) => [e.label, e.value])).toEqual([["How Did You Hear About Us?", "LinkedIn"]]);
    expect(r.need_you).toEqual([]);
  }, 10_000);

  it("an answer the site doesn't offer: no pill, and it still needs an answer", async () => {
    const doc = page("");
    const m = hearAbout(doc);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: {}, answers: [{ question_key: HEARD, answer: "Radio advert" }], taught: [] });
    expect(m.pills()).toEqual([]);
    expect(m.input.value).toBe("");
    const r = s.report();
    expect(r.entries).toEqual([]);
    expect(r.need_you.map((n) => [n.label, n.reason])).toEqual([["How Did You Hear About Us?", "no_option"]]);
  }, 10_000);

  it("a category's item: the category first, then the item in its own list", async () => {
    const doc = page("");
    const m = hearAbout(doc, { topOnly: true });
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: {}, answers: [{ question_key: HEARD, answer: "Social Media > LinkedIn" }], taught: [] });
    expect(m.pills()).toEqual(["LinkedIn"]);
    expect(s.report().entries.map((e) => e.value)).toEqual(["LinkedIn"]);
  }, 10_000);

  it("a typeahead that shows the typed text but never takes a choice is not filled", async () => {
    const doc = page(`<div><label for="ref">Referral source</label>
      <input id="ref" role="combobox" aria-autocomplete="list" aria-controls="ref-list"><ul id="ref-list" role="listbox"></ul></div>`);
    const input = doc.getElementById("ref");
    const list = doc.getElementById("ref-list");
    // Lists what's typed; a click on a result does nothing; leaving empties it.
    input.addEventListener("input", () => {
      list.innerHTML = input.value ? `<li role="option">${input.value}</li>` : "";
    });
    input.addEventListener("blur", () => {
      input.value = "";
      list.innerHTML = "";
    });
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: {}, answers: [{ question_key: "referral source", answer: "LinkedIn" }], taught: [] });
    const r = s.report();
    expect(r.entries).toEqual([]);
    expect(r.need_you.map((n) => [n.label, n.reason])).toEqual([["Referral source", "rejected"]]);
  }, 10_000);

  it("a box the page empties after the fill is reported as still needing an answer", async () => {
    const doc = page(`<div><label for="city">City</label><input id="city"></div>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: VALUES, answers: [], taught: [] });
    expect(s.report().entries.map((e) => e.label)).toEqual(["City"]);
    doc.getElementById("city").value = ""; // the page's own script wiped it
    const r = s.report();
    expect(r.entries).toEqual([]);
    expect(r.need_you.map((n) => [n.label, n.reason])).toEqual([["City", "didnt_stick"]]);
  });

  it("one the user emptied is theirs: not Job Catcher's, and not listed as a failure", async () => {
    const doc = page(`<div><label for="city">City</label><input id="city"></div>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true, userEdited: (el) => el.id === "city" && !el.value });
    await s.fillKnown({ values: VALUES, answers: [], taught: [] });
    doc.getElementById("city").value = "";
    const r = s.report();
    expect(r.entries).toEqual([]);
    expect(r.need_you).toEqual([]);
  });
});

describe("a short lead-in never turns a sponsorship question round (final review)", () => {
  it.each([
    ["Not including OPT, will you require sponsorship in the future?", "requires_sponsorship"],
    ["Not counting OPT, do you need sponsorship?", "requires_sponsorship"],
    ["Not including OPT will you require sponsorship in the future?", "requires_sponsorship"],
    ["Without OPT, will you require sponsorship?", "requires_sponsorship"],
    ["Are you able to work in the US without sponsorship?", "no_sponsorship_needed"],
    ["Do you NOT require sponsorship?", "no_sponsorship_needed"],
    ["Can you work without the need for sponsorship now or in the future?", "no_sponsorship_needed"],
  ])("%s → %s", async (question, want) => {
    const { sponsorshipKey } = await import("../src/autofill/classify/sponsorship.js");
    expect(sponsorshipKey(question)).toBe(want);
  });
});
