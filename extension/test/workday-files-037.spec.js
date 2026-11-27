// @vitest-environment happy-dom
// Spec 037: Workday takes the résumé from its box, EMPTIES the box and lists
// the file in its card. Job Catcher attaches each file once per box per step
// and says "attached" (or "unverified" when nothing says), never "failed",
// never a second copy. A "Resume/Cover Letter" box gets the résumé, then the
// cover letter. Invented applicant only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFields } from "../src/autofill/scan.js";
import { isCoverLetterUpload, isResumeUpload, isSharedUpload, uploadKind } from "../src/autofill/resolve.js";
import { createSession } from "../src/autofill/session.js";
import { Window } from "happy-dom";
import { CHIP_WAITS, FILE_WAITS, fileListed, skillWordings, writeField } from "../src/autofill/widgets.js";

const here = dirname(fileURLToPath(import.meta.url));
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const visible = (el) => !(el.getAttribute("class") || "").includes("hidden-input") && el.getAttribute("type") !== "hidden";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const resumeFile = () => new File(["%PDF"], "Sam_Rivera_Northwind.pdf", { type: "application/pdf" });
const letterFile = () => new File(["%PDF"], "Sam Rivera - Cover letter.pdf", { type: "application/pdf" });

/** Step 2 of the lab's one-address application, heading as given. */
function stepTwo(heading = "Resume/CV") {
  const html = readFileSync(join(here, "lab", "apply-workday-steps.html"), "utf8");
  const steps = [...html.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]);
  const doc = parse(`<main>${steps[1]}</main>`);
  doc.querySelector("h3").textContent = heading;
  return doc;
}

/** Like real Workday: read the file, empty the box, list the file (after `late` ms). */
function likeWorkday(doc, { late = 0, list = true } = {}) {
  const uploads = [];
  let drops = 0;
  const card = doc.querySelector("[data-automation-id=attachments-FileUpload]");
  const show = (names) => {
    for (const n of names) card.insertAdjacentHTML("afterbegin", `<div data-automation-id="file-upload-successful">${n}</div>`);
  };
  doc.querySelector("#input-3f9a").addEventListener("change", (e) => {
    const names = [...(e.target.files || [])].map((f) => f.name);
    e.target.value = "";
    uploads.push(...names);
    if (!list) return;
    if (late) setTimeout(() => show(names), late);
    else show(names);
  });
  doc.querySelector("#zone").addEventListener("drop", () => drops++);
  return { uploads, drops: () => drops };
}

function session(doc, kept) {
  return createSession({ doc, send: async () => ({}), visible, onFileTried: kept ? (k, s) => (s ? (kept[k] = s) : delete kept[k]) : undefined });
}

const waits = { ...FILE_WAITS };
beforeEach(() => Object.assign(FILE_WAITS, { listMs: 300, stepMs: 20 }));
afterEach(() => Object.assign(FILE_WAITS, waits));

describe("the résumé on Workday (bug 1)", () => {
  it("an emptied box is not a failure: one upload, attached", async () => {
    const doc = stepTwo();
    const page = likeWorkday(doc);
    const s = session(doc);
    const copy = { values: {}, answers: [], resumeFile: resumeFile() };
    expect(await s.uploadResume(copy)).toBe(true);
    expect(s.report().resume).toBe("attached");
    await s.fillKnown(copy); // the rest of the press never attaches it again
    expect(page.uploads).toEqual(["Sam_Rivera_Northwind.pdf"]);
    expect(page.drops()).toBe(0);
  });

  it("two presses in a row, then a step filled by itself: still one upload", async () => {
    const doc = stepTwo();
    const page = likeWorkday(doc);
    const s = session(doc);
    const copy = { values: {}, answers: [], resumeFile: resumeFile() };
    await s.uploadResume(copy);
    await s.fillKnown(copy);
    expect(await s.uploadResume(copy)).toBe(false);
    await s.fillKnown(copy);
    expect(await s.uploadResume(copy, { auto: true })).toBe(false);
    await s.fillKnown(copy, { auto: true });
    expect(s.report().resume).toBe("attached");
    expect(page.uploads).toHaveLength(1);
  });

  it("a fresh Job Catcher (a reload) with the file already listed: nothing attached, attached", async () => {
    const doc = stepTwo();
    const page = likeWorkday(doc);
    doc.querySelector("[data-automation-id=attachments-FileUpload]").insertAdjacentHTML("afterbegin", '<div data-automation-id="file-upload-successful">Sam_Rivera_Northwind.pdf</div>');
    const s = session(doc);
    expect(await s.uploadResume({ values: {}, answers: [], resumeFile: resumeFile() })).toBe(false);
    expect(s.report().resume).toBe("attached");
    expect(page.uploads).toEqual([]);
  });

  it("a card that lists it late (but in time): attached, never dropped on too", async () => {
    const doc = stepTwo();
    const page = likeWorkday(doc, { late: 150 });
    const s = session(doc);
    await s.uploadResume({ values: {}, answers: [], resumeFile: resumeFile() });
    expect(s.report().resume).toBe("attached");
    await sleep(400);
    expect(page.uploads).toHaveLength(1);
    expect(page.drops()).toBe(0);
  });

  it("nothing ever lists it: 'unverified', never dropped, never tried again — a fresh Job Catcher neither", async () => {
    const doc = stepTwo();
    const page = likeWorkday(doc, { list: false });
    const kept = {};
    const s = session(doc, kept);
    const copy = { values: {}, answers: [], resumeFile: resumeFile() };
    await s.uploadResume(copy);
    expect(s.report().resume).toBe("unverified");
    await s.fillKnown(copy);
    await s.uploadResume(copy);
    expect(s.report().resume).toBe("unverified");
    expect(page.uploads).toHaveLength(1);
    expect(page.drops()).toBe(0);
    // The background keeps what was tried for the tab: a reloaded Job Catcher reads it.
    expect(Object.values(kept)).toEqual(["unverified"]);
    const fresh = session(doc);
    fresh.seedTried(kept);
    await fresh.uploadResume(copy);
    await fresh.fillKnown(copy);
    expect(fresh.report().resume).toBe("unverified");
    expect(page.uploads).toHaveLength(1);
  });

  it("a React zone that ignores the box: one drop, attached once it lists the file", async () => {
    const doc = stepTwo();
    let drops = 0;
    doc.querySelector("#zone").addEventListener("drop", (e) => {
      drops++;
      const name = e.dataTransfer.files[0].name;
      doc.querySelector("[data-automation-id=attachments-FileUpload]").insertAdjacentHTML("afterbegin", `<div data-automation-id="file-upload-successful">${name}</div>`);
    });
    const s = session(doc);
    const copy = { values: {}, answers: [], resumeFile: resumeFile() };
    await s.uploadResume(copy);
    await s.uploadResume(copy);
    expect(s.report().resume).toBe("attached");
    expect(drops).toBe(1);
  });

  it("knows a file listed in its card, and only by its own name", () => {
    const doc = stepTwo();
    doc.querySelector("[data-automation-id=attachments-FileUpload]").insertAdjacentHTML("afterbegin", '<div data-automation-id="file-upload-successful">Sam_Rivera_2023.pdf</div>');
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    expect(fileListed(box, "Sam_Rivera_2023.pdf")).toBe(true);
    expect(fileListed(box, "Sam_Rivera_Northwind.pdf")).toBe(false);
  });
});

describe("a box for the résumé and the cover letter (bug 2)", () => {
  const box = (heading) => collectFields(stepTwo(heading), { visible }).find((f) => f.kind === "file");

  it("is the résumé's, and shared: never the letter's alone", () => {
    for (const heading of ["Resume/Cover Letter", "Résumé and cover letter", "Upload your CV or cover letter"]) {
      const f = box(heading);
      expect(uploadKind(f)).toBe("both");
      expect(isResumeUpload(f)).toBe(true);
      expect(isSharedUpload(f)).toBe(true);
      expect(isCoverLetterUpload(f)).toBe(false);
    }
    expect(isSharedUpload(box("Resume/CV"))).toBe(false);
    expect(uploadKind(box("Cover Letter"))).toBe("other");
  });

  it("a heading over two separate boxes is never 'both'", () => {
    const doc = parse(`<section><h2>Resume and cover letter</h2>
      <div><label for="r">Resume</label><input type="file" id="r" accept=".pdf"></div>
      <div><label for="c">Cover letter</label><input type="file" id="c" accept=".pdf"></div></section>`);
    const [r, c] = collectFields(doc, { visible: () => true }).filter((f) => f.kind === "file");
    expect(uploadKind(r)).toBe("resume");
    expect(isCoverLetterUpload(c)).toBe(true);
  });

  it("the résumé, then the letter: exactly two files; filled again, still two", async () => {
    const doc = stepTwo("Resume/Cover Letter");
    const page = likeWorkday(doc);
    const s = session(doc);
    const copy = { values: {}, answers: [], resumeFile: resumeFile(), coverLetterFile: letterFile() };
    await s.uploadResume(copy);
    await s.fillKnown(copy);
    expect(page.uploads).toEqual(["Sam_Rivera_Northwind.pdf", "Sam Rivera - Cover letter.pdf"]);
    expect(s.report()).toMatchObject({ resume: "attached", cover_letter: "attached" });
    await s.uploadResume(copy);
    await s.fillKnown(copy);
    expect(page.uploads).toHaveLength(2);
    expect(s.report()).toMatchObject({ resume: "attached", cover_letter: "attached" });
  });

  it("no letter for the job: the résumé only", async () => {
    const doc = stepTwo("Resume/Cover Letter");
    const page = likeWorkday(doc);
    const s = session(doc);
    const copy = { values: {}, answers: [], resumeFile: resumeFile() };
    await s.uploadResume(copy);
    await s.fillKnown(copy);
    expect(page.uploads).toEqual(["Sam_Rivera_Northwind.pdf"]);
    expect(s.report().cover_letter).toBeUndefined();
  });

  it("a plain box that takes several files holds both", async () => {
    const doc = parse(`<form><label for="docs">Resume / Cover Letter</label><input type="file" id="docs" multiple accept=".pdf"></form>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.uploadResume({ values: {}, answers: [], resumeFile: resumeFile(), coverLetterFile: letterFile() });
    expect([...doc.querySelector("#docs").files].map((f) => f.name)).toEqual(["Sam_Rivera_Northwind.pdf", "Sam Rivera - Cover letter.pdf"]);
    expect(s.report()).toMatchObject({ resume: "attached", cover_letter: "attached" });
  });

  it("a plain box for one file: the résumé stays in it", async () => {
    const doc = parse(`<form><label for="docs">Resume / Cover Letter</label><input type="file" id="docs" accept=".pdf"></form>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.uploadResume({ values: {}, answers: [], resumeFile: resumeFile(), coverLetterFile: letterFile() });
    expect([...doc.querySelector("#docs").files].map((f) => f.name)).toEqual(["Sam_Rivera_Northwind.pdf"]);
    expect(s.report()).toMatchObject({ resume: "attached", cover_letter: "no_box" });
  });

  it("the letter's own box says what happened to it; a page with no box for it says so", async () => {
    const doc = parse(`<form><label for="r">Resume</label><input type="file" id="r" accept=".pdf">
      <label for="c">Cover letter</label><input type="file" id="c" accept=".pdf"></form>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    const copy = { values: {}, answers: [], resumeFile: resumeFile(), coverLetterFile: letterFile() };
    await s.uploadResume(copy);
    await s.fillKnown(copy);
    expect(s.report()).toMatchObject({ resume: "attached", cover_letter: "attached" });
    const none = parse(`<form><label for="r">Resume</label><input type="file" id="r" accept=".pdf"></form>`);
    const t = createSession({ doc: none, send: async () => ({}), visible: () => true });
    await t.uploadResume(copy);
    await t.fillKnown(copy);
    expect(t.report().cover_letter).toBe("no_box");
    // A box for the letter, and no letter for the job.
    const empty = parse(`<form><label for="r">Resume</label><input type="file" id="r" accept=".pdf">
      <label for="c">Cover letter</label><input type="file" id="c" accept=".pdf"></form>`);
    const u = createSession({ doc: empty, send: async () => ({}), visible: () => true });
    await u.uploadResume({ ...copy, coverLetterFile: null });
    await u.fillKnown({ ...copy, coverLetterFile: null });
    expect(u.report().cover_letter).toBe("no_file");
  });
});

describe("Workday Skills (bug 4)", () => {
  /** Workday's search prompt: results `slow` ms after Enter, "No Items" when
   * none; `autopick`: a lone result becomes a chip by itself, whatever it is. */
  function skillsBox(catalog, { slow = 0, autopick = false } = {}) {
    const w = new Window();
    const doc = w.document;
    doc.body.innerHTML = `<div data-automation-id="mainContent"><div data-automation-id="formField-skills"><label for="s">Skills</label>
      <div data-automation-id="multiSelectContainer"><ul data-automation-id="selectedItemList"></ul><input id="s" placeholder="Search"></div></div></div>`;
    const input = doc.querySelector("#s");
    const chips = doc.querySelector("ul");
    let popup = null;
    let asked = 0;
    const close = () => {
      popup?.remove();
      popup = null;
    };
    const add = (label) => {
      chips.insertAdjacentHTML("beforeend", `<li data-automation-id="selectedItem">${label}</li>`);
      input.value = "";
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Enter") return;
      close();
      const q = input.value.toLowerCase();
      const hits = catalog.filter((c) => c.toLowerCase().includes(q));
      const n = ++asked;
      const results = () => {
        if (n !== asked) return;
        if (hits.length === 1 && (autopick || hits[0].toLowerCase() === q)) return add(hits[0]);
        popup = doc.createElement("div");
        popup.setAttribute("data-automation-activepopup", "true");
        for (const h of hits) {
          const leaf = doc.createElement("div");
          leaf.setAttribute("data-automation-id", "promptLeafNode");
          leaf.setAttribute("role", "option");
          leaf.textContent = h;
          leaf.addEventListener("click", () => {
            add(h);
            close();
          });
          popup.appendChild(leaf);
        }
        if (!hits.length) popup.innerHTML = "<p>No Items.</p>";
        doc.body.appendChild(popup);
      };
      if (slow) setTimeout(results, slow);
      else results();
    });
    return { input, chips: () => [...chips.children].map((c) => c.textContent), field: { id: "s", el: input, kind: "chips", question: "Skills", hints: {} } };
  }

  const CATALOG = ["Microsoft 365 Copilot for Sales", "Office 365", "Active Directory", "Windows 10", "Windows 11", "Intune", "Python", "Python Scripting", "PowerShell"];
  const chipWaits = { ...CHIP_WAITS };
  afterEach(() => Object.assign(CHIP_WAITS, chipWaits));

  it("other names and a shared start: M365, AD, 'Windows 10/11'; 'TCP/IP' stays whole", () => {
    expect(skillWordings("M365").names).toEqual(["M365", "Microsoft 365"]);
    expect(skillWordings("Active Directory").names).toEqual(["Active Directory", "AD"]);
    expect(skillWordings("o365").names).toEqual(["o365", "Office 365"]);
    expect(skillWordings("Windows 10/11").parts).toEqual(["Windows 10", "Windows 11"]);
    expect(skillWordings("Office 2016 / 2019").parts).toEqual(["Office 2016", "Office 2019"]);
    expect(skillWordings("TCP/IP").parts).toEqual([]);
    expect(skillWordings("CI/CD").parts).toEqual([]);
  });

  it("never a longer entry that starts the same, and a chip Workday picks by itself that isn't it comes off", async () => {
    const m = skillsBox(CATALOG, { autopick: true });
    const res = await writeField(m.field, ["Microsoft 365", "Python"]);
    expect(m.chips()).toEqual(["Python"]);
    expect(res).toMatchObject({ ok: true, notAdded: ["Microsoft 365"] });
  });

  it("other names, the same but for spaces and case, 'Windows 10/11' as two", async () => {
    const m = skillsBox([...CATALOG, "Power Shell"]);
    const res = await writeField(m.field, ["O365", "ad", "Windows 10/11", "powershell", "Cobol"]);
    expect(m.chips()).toEqual(["Office 365", "Active Directory", "Windows 10", "Windows 11", "PowerShell"]);
    expect(res.notAdded).toEqual(["Cobol"]);
  });

  it("a server-side search slower than 1.5 s is waited for", async () => {
    const m = skillsBox(CATALOG, { slow: 1900 });
    await writeField(m.field, ["Python"]);
    expect(m.chips()).toEqual(["Python"]);
  }, 10_000);

  it("'No Items' ends the wait at once", async () => {
    const m = skillsBox(CATALOG);
    const t0 = Date.now();
    const res = await writeField(m.field, ["Cobol"]);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(res).toMatchObject({ ok: false, reason: "no_option", notAdded: ["Cobol"] });
  });

  it("the whole box keeps to its budget: the skills left are listed, never dropped", async () => {
    Object.assign(CHIP_WAITS, { budgetMs: 1500 });
    const m = skillsBox(CATALOG, { slow: 700 });
    const t0 = Date.now();
    const res = await writeField(m.field, ["Python", "Intune", "Office 365", "Windows 10", "Windows 11"]);
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(m.chips().length).toBeLessThan(5);
    expect([...m.chips(), ...res.notAdded].sort()).toEqual(["Intune", "Office 365", "Python", "Windows 10", "Windows 11"]);
  }, 10_000);

  it("the session lists them: 'Skills not added: …' beside the skills that were", async () => {
    const m = skillsBox(CATALOG);
    const s = createSession({ doc: m.input.ownerDocument, send: async () => ({}), visible: () => true });
    await s.putSection(m.field, ["Python", "Cobol", "Fortran"]);
    const r = s.report();
    expect(r.entries.map((e) => e.label)).toEqual(["Skills"]);
    expect(r.need_you).toEqual([expect.objectContaining({ label: "Skills not added: Cobol, Fortran", reason: "not_added" })]);
  });
});
