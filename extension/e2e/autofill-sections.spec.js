// Spec 020 part 2: "retype your résumé" sections in real Chromium — one press
// fills a row per job / school / language / website, adds rows with the
// page's own Add button, corrects what Workday's own résumé reading got
// wrong (Undo puts it back), never touches the user's edits, never leaves a
// list open or two open at once, and adds skills as chips. No AI anywhere.
// Invented applicant only.
import { test, expect } from "@playwright/test";
import { startFakeApi } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { launchExtension } from "./support/launch.js";

let api;
let lab;
let ext;

const WORK = [
  { title: "Platform Engineer (Cloud & Tooling)", company: "Brightfold Labs", location: "Harborview, OR", start_month: 3, start_year: 2023, end_month: null, end_year: null, current: true, description: "Built CI/CD pipelines." },
  { title: "Support Analyst", company: "Quillstone", location: "Salem, OR", start_month: 1, start_year: 2020, end_month: 2, end_year: 2023, current: false, description: "Helped 200 users." },
  { title: "Help Desk Intern", company: "Tidewell", location: "", start_month: 6, start_year: 2019, end_month: 8, end_year: 2019, current: false, description: "" },
];
const HISTORY = {
  work: WORK,
  education: [{ school: "Harborview Community College", degree: "Associate", field_of_study: "Computer Science", start_year: 2017, end_year: 2019 }],
  skills: ["Python", "SQL", "Azure", "Cobol"],
  certifications: [],
  websites: ["https://wren.example"],
};
const LANGUAGES = [
  { language: "English", native: true, overall: 5, comprehension: null, reading: null, speaking: null, writing: null },
  { language: "Spanish", native: false, overall: 4, comprehension: null, reading: null, speaking: null, writing: 3 },
];

test.beforeAll(async () => {
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url });
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

test.beforeEach(async () => {
  api.reset();
  api.state.answers = [];
  api.state.taught = [];
  api.state.history = HISTORY;
  api.state.profile = { ...api.state.profile, languages: LANGUAGES };
  api.state.promoted = true;
  api.state.bundleVersion++;
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.remove(["je_autofill"]);
    await chrome.storage.sync.set({ je_super: false }); // one press per test
  });
});

const rowVal = (page, kind, n, ff, sel = "input") =>
  page.locator(`[aria-labelledby="${kind}-${n}-panel"] [data-automation-id="formField-${ff}"] ${sel}`).first();
const listText = (page, id) => page.locator(`#${id}`).innerText();

test("Workday: rows per job, school, language and website; Workday's wrong values corrected; skills chips; never two lists open", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/workday-sections.html"));
  const res = await ext.autofill(page);
  expect(res.ok).toBe(true);

  // Jobs: three rows, the cut title and scrap description corrected.
  await expect(page.locator('[aria-labelledby^="Work-Experience-"][role=group]')).toHaveCount(3);
  await expect(rowVal(page, "Work-Experience", 1, "jobTitle")).toHaveValue("Platform Engineer (Cloud & Tooling)");
  await expect(rowVal(page, "Work-Experience", 1, "companyName")).toHaveValue("Brightfold Labs");
  await expect(rowVal(page, "Work-Experience", 1, "roleDescription", "textarea")).toHaveValue("Built CI/CD pipelines.");
  await expect(page.locator("#w1-current")).toBeChecked();
  await expect(rowVal(page, "Work-Experience", 3, "jobTitle")).toHaveValue("Help Desk Intern");
  // Dates: taken the page's way (they survive leaving the box).
  const data = await page.evaluate(() => window.__formData());
  expect(data["w1-from-m"]).toBe("03");
  expect(data["w1-from-y"]).toBe("2023");
  expect(data["w2-to-m"]).toBe("02");
  expect(data["w2-to-y"]).toBe("2023");

  // School: the search prompt, the degree list, the years.
  await expect(page.locator("#e1-school").locator("xpath=..").locator('[data-automation-id="selectedItem"]')).toHaveText(["Harborview Community College"]);
  expect(await listText(page, "e1-degree")).toBe("Associate's Degree");
  expect(data["e1-to-y"]).toBe("2019");

  // Languages: two rows, fluent, each level from the ladder.
  await expect(page.locator('[aria-labelledby^="Languages-"][role=group]')).toHaveCount(2);
  expect(await listText(page, "l1-language")).toBe("English");
  await expect(page.locator("#l1-native")).toBeChecked();
  expect(await listText(page, "l1-w")).toBe("5 - Fluent");
  expect(await listText(page, "l2-language")).toBe("Spanish"); // far down a list that draws only what's in view
  expect(await listText(page, "l2-c")).toBe("4 - Advanced");
  expect(await listText(page, "l2-w")).toBe("3 - Intermediate");
  await expect(page.locator("#l2-native")).not.toBeChecked();

  // Websites: the first Add made the row. Skills: chips, Cobol isn't offered.
  await expect(page.locator("#u1-url")).toHaveValue("https://wren.example");
  await expect(page.locator('[data-automation-id="formField-skills"] [data-automation-id="selectedItem"]')).toHaveText(["Python", "SQL", "Azure"]);

  // One list at a time, none left open.
  expect(await page.evaluate(() => window.__maxOpen())).toBe(1);
  expect(await page.evaluate(() => window.__openNow())).toBe(0);

  // Undo puts Workday's own values back.
  const tabId = await ext.tabIdOf(page);
  await ext.bg({ type: "fillAction", tabId, frameId: 0, action: "undo" });
  await expect(rowVal(page, "Work-Experience", 1, "jobTitle")).toHaveValue("Platform Engineer");
  await expect(rowVal(page, "Work-Experience", 1, "roleDescription", "textarea")).toHaveValue("Cloud & Tooling) · Brightfold Labs");
  await page.close();
});

test("Workday: a box the user typed in first is never changed", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/workday-sections.html"));
  await page.locator("#w1-company").fill("Mine, Typed");
  await page.locator("#w1-title").fill("My Own Title");
  await ext.autofill(page);
  await expect(page.locator("#w1-company")).toHaveValue("Mine, Typed");
  await expect(page.locator("#w1-title")).toHaveValue("My Own Title");
  await expect(page.locator("#w1-location")).toHaveValue("Harborview, OR"); // the rest still filled
  await page.close();
});

test("Greenhouse-style rows: '+ Add another' until each job has a row; never Save", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/greenhouse-rows.html"));
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect(page.locator(".employment-form")).toHaveCount(3);
  for (const [n, job] of WORK.entries()) {
    await expect(page.locator(`#co-${n + 1}`)).toHaveValue(job.company);
    await expect(page.locator(`#ti-${n + 1}`)).toHaveValue(job.title);
  }
  await expect(page.locator("#sy-2")).toHaveValue("2020");
  await expect(page.locator("#cur-1")).toBeChecked();
  await expect(page.locator("#sc-1")).toHaveValue("Harborview Community College");
  expect(await page.evaluate(() => window.__saved())).toBe(0);
  await page.close();
});

test("SuccessFactors-style rows: the 'Add' row control is used; each row gets its job", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/successfactors-rows.html"));
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect(page.locator(".rcmSectionComponent")).toHaveCount(3);
  await expect(page.locator("#emp-1")).toHaveValue("Brightfold Labs");
  await expect(page.locator("#jt-2")).toHaveValue("Support Analyst");
  await expect(page.locator("#emp-3")).toHaveValue("Tidewell");
  await expect(page.locator("#ed-2")).toHaveValue("02/2023");
  await page.close();
});
