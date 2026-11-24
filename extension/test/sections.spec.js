// @vitest-environment happy-dom
// Spec 020 (US2): "retype your résumé" sections — one row per entry of the
// chosen résumé, added with the page's own Add button; a site's wrong value
// corrected (Undo puts it back); the user's own edits never touched; lists one
// at a time; languages by level; skills as chips. Invented applicant only.
import { describe, expect, it, vi } from "vitest";
import { eduPart, eduValues, jobPart } from "../src/autofill/classify/jobHistory.js";
import { profileValues } from "../src/autofill/classify/profileKeys.js";
import { collectFields } from "../src/autofill/scan.js";
import { fillSections } from "../src/autofill/sections/index.js";
import { addControlFor, countBlocks } from "../src/autofill/sections/generic.js";
import { workdaySections } from "../src/autofill/sections/workday.js";
import { createSession } from "../src/autofill/session.js";
import { openPopupCount } from "../src/autofill/widgets.js";

const parse = (html) => new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
const NOW = () => Promise.resolve();

const WORK = [
  { title: "Platform Engineer (Cloud & Tooling)", company: "Brightfold Labs", location: "Harborview, OR", start_month: 3, start_year: 2023, current: true, description: "Built CI/CD pipelines." },
  { title: "Support Analyst", company: "Quillstone", location: "Salem, OR", start_month: 1, start_year: 2020, end_month: 2, end_year: 2023, current: false, description: "Helped 200 users." },
  { title: "Help Desk Intern", company: "Tidewell", location: "", start_month: 6, start_year: 2019, end_month: 8, end_year: 2019, current: false, description: "" },
];

function session(doc, edited = new WeakSet()) {
  return createSession({ doc, send: vi.fn(async () => ({})), visible: () => true, userEdited: (el) => edited.has(el) });
}

function copyOf(history, languages = []) {
  return { values: profileValues({ first_name: "Wren", last_name: "Calloway" }, "wren@example.com"), answers: [], taught: [], history, languages };
}

// ---- A Workday-shaped page (markup from working fillers; research R4) ---------

const stats = { open: 0, max: 0 };

function wireListboxes(doc) {
  for (const btn of doc.querySelectorAll('button[aria-haspopup="listbox"]')) {
    if (btn.dataset.wired) continue;
    btn.dataset.wired = "1";
    let popup = null;
    const close = () => {
      if (!popup) return;
      popup.remove();
      popup = null;
      btn.setAttribute("aria-expanded", "false");
      stats.open--;
    };
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      if (popup) return close();
      popup = doc.createElement("div");
      popup.setAttribute("data-automation-activepopup", "true");
      for (const label of btn.dataset.options.split("|")) {
        const li = doc.createElement("li");
        li.setAttribute("role", "option");
        li.innerHTML = `<div data-automation-id="promptOption"><div data-automation-id="promptLeafNode"></div></div>`;
        const leaf = li.querySelector('[data-automation-id="promptLeafNode"]');
        leaf.textContent = label;
        leaf.addEventListener("click", () => {
          btn.textContent = label;
          close();
        });
        popup.appendChild(li);
      }
      doc.body.appendChild(popup);
      btn.setAttribute("aria-expanded", "true");
      stats.open++;
      stats.max = Math.max(stats.max, stats.open);
    });
    btn.addEventListener("keydown", (e) => e.key === "Escape" && close());
  }
}

const LEVELS = "Select One|1 - Beginner|2 - Classroom Study|3 - Intermediate|4 - Advanced|5 - Fluent";
const workRow = (n, { title = "", company = "", desc = "" } = {}) => `
  <div role="group" aria-labelledby="Work-Experience-${n}-panel"><h4 id="Work-Experience-${n}-panel">Work Experience ${n}</h4>
    <div data-automation-id="formField-jobTitle"><label>Job Title</label><input value="${title}"></div>
    <div data-automation-id="formField-companyName"><label>Company</label><input value="${company}"></div>
    <div data-automation-id="formField-location"><label>Location</label><input></div>
    <div data-automation-id="formField-currentlyWorkHere"><label><input type="checkbox"> I currently work here</label></div>
    <div data-automation-id="formField-startDate"><input data-automation-id="dateSectionMonth-input"><input data-automation-id="dateSectionYear-input"></div>
    <div data-automation-id="formField-endDate"><input data-automation-id="dateSectionMonth-input"><input data-automation-id="dateSectionYear-input"></div>
    <div data-automation-id="formField-roleDescription"><label>Role Description</label><textarea>${desc}</textarea></div>
  </div>`;
const langRow = (n) => `
  <div role="group" aria-labelledby="Languages-${n}-panel"><h4 id="Languages-${n}-panel">Languages ${n}</h4>
    <div data-automation-id="formField-language"><label>Language</label><button type="button" aria-haspopup="listbox" data-options="Select One|English|French|Spanish">Select One</button></div>
    <div data-automation-id="formField-native"><label><input type="checkbox" name="native"> I am fluent in this language.</label></div>
    <div data-automation-id="formField-ability-c"><label>Comprehension</label><button type="button" aria-haspopup="listbox" data-options="${LEVELS}">Select One</button></div>
    <div data-automation-id="formField-ability-w"><label>Writing</label><button type="button" aria-haspopup="listbox" data-options="${LEVELS}">Select One</button></div>
  </div>`;
const urlRow = (n) => `<div role="group" aria-labelledby="Websites-${n}-panel"><h4 id="Websites-${n}-panel">Websites ${n}</h4>
  <div data-automation-id="formField-url"><label>URL</label><input></div></div>`;

function workdayPage({ prefilled = true } = {}) {
  const doc = parse(`<div data-automation-id="mainContent">
    <div aria-labelledby="Work-Experience-section"><h3 id="Work-Experience-section">Work Experience</h3>
      <div class="rows">${workRow(1, prefilled ? { title: "Platform Engineer", desc: "Cloud &amp; Tooling) · Brightfold Labs" } : {})}</div>
      <button data-automation-id="add-button" data-kind="work">Add Another</button></div>
    <div aria-labelledby="Languages-section"><h3 id="Languages-section">Languages</h3>
      <div class="rows">${langRow(1)}</div><button data-automation-id="add-button" data-kind="lang">Add Another</button></div>
    <div aria-labelledby="Websites-section"><h3 id="Websites-section">Websites</h3>
      <div class="rows"></div><button data-automation-id="add-button" data-kind="url">Add</button></div>
    <div data-automation-id="formField-skills"><label>Type to Add Skills</label>
      <div data-automation-id="multiSelectContainer"><ul data-automation-id="selectedItemList"></ul><input placeholder="Search"></div></div>
    <button id="submit">Submit</button>
  </div>`);
  const counts = { work: 1, lang: 1, url: 0 };
  for (const btn of doc.querySelectorAll('[data-automation-id="add-button"]')) {
    btn.addEventListener("click", () => {
      const k = btn.dataset.kind;
      counts[k]++;
      const html = k === "work" ? workRow(counts[k]) : k === "lang" ? langRow(counts[k]) : urlRow(counts[k]);
      btn.previousElementSibling.insertAdjacentHTML("beforeend", html);
      wireListboxes(doc);
    });
  }
  wireListboxes(doc);
  // The skills prompt: Enter shows matches; a pick adds a chip.
  const input = doc.querySelector('[data-automation-id="formField-skills"] input');
  const chips = doc.querySelector('[data-automation-id="selectedItemList"]');
  let pop = null;
  const closePop = () => {
    pop?.remove();
    pop = null;
  };
  doc.addEventListener("click", (e) => pop && !pop.contains(e.target) && e.target !== input && closePop());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closePop();
    if (e.key !== "Enter") return;
    closePop();
    pop = doc.createElement("div");
    pop.setAttribute("data-automation-activepopup", "true");
    for (const s of ["Python", "TypeScript", "SQL", "Azure"].filter((x) => x.toLowerCase().includes(input.value.toLowerCase()))) {
      const leaf = doc.createElement("div");
      leaf.setAttribute("data-automation-id", "promptLeafNode");
      leaf.textContent = s;
      leaf.addEventListener("click", () => {
        chips.insertAdjacentHTML("beforeend", `<li data-automation-id="selectedItem">${s}</li>`);
        input.value = "";
        closePop();
      });
      pop.appendChild(leaf);
    }
    doc.body.appendChild(pop);
  });
  let submitted = 0;
  doc.getElementById("submit").addEventListener("click", () => submitted++);
  return { doc, submitted: () => submitted };
}

const rowsOf = (doc, kind) => workdaySections(doc).get(kind)?.rows || [];
const val = (row, ff, sel = "input") => row.querySelector(`[data-automation-id="formField-${ff}"] ${sel}`).value;

describe("Workday résumé sections", () => {
  it("adds a row per job, corrects Workday's cut title and scrap description, fills dates; Undo puts the page's back", async () => {
    stats.max = 0;
    const { doc, submitted } = workdayPage();
    const s = session(doc);
    await fillSections(doc, copyOf({ work: WORK }), { session: s, auto: false, userEdited: () => false, wait: NOW });
    const rows = rowsOf(doc, "work");
    expect(rows).toHaveLength(3);
    expect(val(rows[0], "jobTitle")).toBe("Platform Engineer (Cloud & Tooling)");
    expect(val(rows[0], "companyName")).toBe("Brightfold Labs");
    expect(val(rows[0], "roleDescription", "textarea")).toBe("Built CI/CD pipelines.");
    expect(rows[0].querySelector('[data-automation-id="formField-currentlyWorkHere"] input').checked).toBe(true);
    expect(rows[0].querySelector('[data-automation-id="formField-startDate"] [data-automation-id="dateSectionYear-input"]').value).toBe("2023");
    expect(val(rows[1], "companyName")).toBe("Quillstone");
    expect(rows[1].querySelector('[data-automation-id="formField-endDate"] [data-automation-id="dateSectionMonth-input"]').value).toBe("02");
    expect(val(rows[2], "jobTitle")).toBe("Help Desk Intern");
    expect(submitted()).toBe(0);

    const entries = s.report().entries;
    expect(entries.find((e) => /Work Experience 1 · Job Title/.test(e.label))?.corrected).toBe(true);
    await s.undo();
    expect(val(rows[0], "jobTitle")).toBe("Platform Engineer");
    expect(val(rows[0], "roleDescription", "textarea")).toBe("Cloud & Tooling) · Brightfold Labs");
  });

  it("never touches a box the user edited on this page", async () => {
    const { doc } = workdayPage();
    const edited = new WeakSet();
    const company = rowsOf(doc, "work")[0].querySelector('[data-automation-id="formField-companyName"] input');
    company.value = "My Own Note";
    edited.add(company);
    const s = session(doc, edited);
    await fillSections(doc, copyOf({ work: WORK }), { session: s, auto: false, userEdited: (el) => edited.has(el), wait: NOW });
    expect(company.value).toBe("My Own Note");
    expect(val(rowsOf(doc, "work")[0], "jobTitle")).toBe("Platform Engineer (Cloud & Tooling)");
  });

  it("languages: a row per language, the language, 'fluent', and each level from the ladder — one list open at a time", async () => {
    stats.max = 0;
    stats.open = 0;
    const { doc } = workdayPage({ prefilled: false });
    const s = session(doc);
    const languages = [
      { language: "English", native: true },
      { language: "Spanish", native: false, comprehension: 4, writing: 3 },
    ];
    await fillSections(doc, copyOf({ work: [] }, languages), { session: s, auto: false, userEdited: () => false, wait: NOW });
    const rows = rowsOf(doc, "languages");
    expect(rows).toHaveLength(2);
    const btns = (row) => [...row.querySelectorAll('button[aria-haspopup="listbox"]')].map((b) => b.textContent);
    expect(btns(rows[0])).toEqual(["English", "5 - Fluent", "5 - Fluent"]);
    expect(rows[0].querySelector('input[name="native"]').checked).toBe(true);
    expect(btns(rows[1])).toEqual(["Spanish", "4 - Advanced", "3 - Intermediate"]);
    expect(rows[1].querySelector('input[name="native"]').checked).toBe(false);
    expect(stats.max).toBe(1);
    expect(openPopupCount(doc)).toBe(0);
  }, 20000);

  it("websites: the first Add makes the row; skills become chips, one at a time", async () => {
    const { doc } = workdayPage({ prefilled: false });
    const s = session(doc);
    await fillSections(doc, copyOf({ work: [], websites: ["https://wren.example"], skills: ["Python", "SQL", "Cobol"] }), { session: s, auto: false, userEdited: () => false, wait: NOW });
    expect(rowsOf(doc, "websites")).toHaveLength(1);
    expect(val(rowsOf(doc, "websites")[0], "url")).toBe("https://wren.example");
    const chips = [...doc.querySelectorAll('[data-automation-id="selectedItem"]')].map((c) => c.textContent);
    expect(chips).toEqual(["Python", "SQL"]); // Cobol isn't offered: skipped
    expect(openPopupCount(doc)).toBe(0);
  }, 20000);

  it("a step filled by itself never re-adds rows it added before on this page", async () => {
    const { doc } = workdayPage();
    const s = session(doc);
    const opts = { session: s, userEdited: () => false, wait: NOW };
    await fillSections(doc, copyOf({ work: WORK.slice(0, 2) }), { ...opts, auto: false });
    expect(rowsOf(doc, "work")).toHaveLength(2);
    rowsOf(doc, "work")[1].remove(); // the user deleted one
    await fillSections(doc, copyOf({ work: WORK.slice(0, 2) }), { ...opts, auto: true });
    expect(rowsOf(doc, "work")).toHaveLength(1);
  });
});

// ---- Other sites: Greenhouse-style rows ---------------------------------------

const ghRow = `<div class="employment-form">
  <label>Company name <input class="co"></label>
  <label>Title <input class="ti"></label>
  <label>Start date year <input class="sy"></label></div>`;

function greenhousePage() {
  const doc = parse(`<form><h3>Employment</h3><div class="employment--container"><div class="rows">${ghRow}</div>
    <button type="button" class="add-another-button">+ Add another</button></div>
    <h3>Education</h3><div class="education--container"><div class="rows"><div class="education--form">
      <label>School <input class="sc"></label><label>Degree <input class="dg"></label></div></div></div>
    <button type="button" id="save">Save and continue</button></form>`);
  doc.querySelector(".add-another-button").addEventListener("click", () => doc.querySelector(".employment--container .rows").insertAdjacentHTML("beforeend", ghRow));
  let saved = 0;
  doc.getElementById("save").addEventListener("click", () => saved++);
  return { doc, saved: () => saved };
}

describe("other sites' job and school blocks", () => {
  it("adds blocks with the page's own Add control (never Save), then the general fill fills each", async () => {
    const { doc, saved } = greenhousePage();
    const s = session(doc);
    const copy = copyOf({ work: WORK, education: [{ school: "Harborview Community College", degree: "Associate" }] });
    await fillSections(doc, copy, { session: s, auto: false, userEdited: () => false, wait: NOW });
    expect(doc.querySelectorAll(".employment-form")).toHaveLength(3);
    expect(saved()).toBe(0);
    await s.fillKnown(copy);
    expect([...doc.querySelectorAll(".co")].map((i) => i.value)).toEqual(["Brightfold Labs", "Quillstone", "Tidewell"]);
    expect([...doc.querySelectorAll(".ti")].map((i) => i.value)).toEqual(["Platform Engineer (Cloud & Tooling)", "Support Analyst", "Help Desk Intern"]);
    expect(doc.querySelector(".sc").value).toBe("Harborview Community College");
  });

  it("a block the site pre-filled wrong is corrected; the user's own edit stays", async () => {
    const { doc } = greenhousePage();
    doc.querySelector(".ti").value = "Platform Engineer";
    doc.querySelector(".co").value = "Typed By Me";
    const edited = new WeakSet([doc.querySelector(".co")]);
    const s = session(doc, edited);
    await s.fillKnown(copyOf({ work: WORK.slice(0, 1) }));
    expect(doc.querySelector(".ti").value).toBe("Platform Engineer (Cloud & Tooling)");
    expect(doc.querySelector(".co").value).toBe("Typed By Me");
    expect(s.report().entries.find((e) => e.label === "Title")?.corrected).toBe(true);
  });

  it("counts blocks and finds the section's Add control after its last box", () => {
    const { doc } = greenhousePage();
    doc.querySelector(".add-another-button").click();
    const list = collectFields(doc, { visible: () => true });
    expect(countBlocks(list, "job")).toBe(2);
    const jobs = list.filter((f) => /company|title|start/i.test(f.question));
    expect(addControlFor(jobs)?.className).toBe("add-another-button");
  });
});

describe("which part of a job or school a box asks for", () => {
  const f = (question, kind = "text") => ({ question, kind, hints: {} });
  it("jobs: description, location and 'I currently work here' too", () => {
    expect(jobPart(f("Role Description", "textarea"))).toBe("description");
    expect(jobPart(f("Responsibilities", "textarea"))).toBe("description");
    expect(jobPart(f("Location"))).toBe("location");
    expect(jobPart(f("I currently work here", "checkbox"))).toBe("current");
    expect(jobPart(f("Supervisor name"))).toBe("");
  });
  it("schools: dates first, then field, degree, school", () => {
    expect(eduPart(f("Year of graduation from college"))).toBe("end");
    expect(eduPart(f("First Year Attended"))).toBe("start");
    expect(eduPart(f("Field of Study"))).toBe("field");
    expect(eduPart(f("Degree"))).toBe("degree");
    expect(eduPart(f("School or University"))).toBe("school");
    expect(eduPart(f("GPA"))).toBe("");
    expect(eduValues("end", { end_year: 2019 }, f("Graduation year"))).toEqual(["2019"]);
  });
});

describe("a plain Skills box", () => {
  it("gets the chosen résumé's skills as a comma list; a question about skills doesn't", async () => {
    const { profileKeyFor } = await import("../src/autofill/classify/profileKeys.js");
    const f = (question) => ({ question, kind: "textarea", hints: {} });
    expect(profileKeyFor(f("Skills"))).toBe("skills");
    expect(profileKeyFor(f("Technical Skills (comma separated)"))).toBe("skills");
    expect(profileKeyFor(f("List your relevant skills"))).toBe("skills");
    expect(profileKeyFor(f("Do you have the skills needed for this role?"))).not.toBe("skills");
    expect(profileValues({}, "", new Date(), { skills: ["Python", "SQL"] }).skills).toEqual(["Python, SQL"]);
    expect(profileValues({}, "", new Date(), { skills: [] }).skills).toEqual([]);
  });
});
