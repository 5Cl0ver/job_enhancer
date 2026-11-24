// Autofill memory (spec 018): Super autofill, saving what you answer, the
// inspect-and-teach tool, and "retype your résumé" sections that must never
// get the user's own details. Real Chromium, the lab, the fake server.
// Invented applicant only.
import { test, expect } from "@playwright/test";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { launchExtension } from "./support/launch.js";

let api;
let lab;
let ext;

const HISTORY = {
  work: [
    { title: "Field Service Technician", company: "Tidewell Labs", location: "Harborview, OR", start_month: 3, start_year: 2023, end_month: null, end_year: null, current: true },
    { title: "Help Desk Analyst", company: "Quillstone", location: "Salt Creek, WA", start_month: 6, start_year: 2020, end_month: 2, end_year: 2023, current: false },
  ],
  education: [],
};

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
  api.clearCalls();
  api.state.answers = [];
  api.state.taught = [];
  api.state.history = HISTORY;
  api.state.bundleVersion++;
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill"]));
});

test("employment blocks get the résumé's jobs — never your own address or phone", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/employment.html"));
  expect((await ext.autofill(page)).ok).toBe(true);
  const f = await page.evaluate(() => window.__formData());
  // Yours, in your section.
  expect(f).toMatchObject({ "p-first": "Wren", "p-email": PERSON.email, "p-addr": PERSON.profile.address_line1, "p-city": "Harborview", "p-phone": PERSON.profile.phone });
  // The résumé's jobs, one block each.
  expect(f).toMatchObject({
    "e1-company": "Tidewell Labs", "e1-title": "Field Service Technician", "e1-city": "Harborview", "e1-state": "OR", "e1-start": "03/2023",
    "e2-company": "Quillstone", "e2-title": "Help Desk Analyst", "e2-city": "Salt Creek",
  });
  // Never your own details in a past job's boxes.
  for (const id of ["e1-addr", "e1-phone", "e1-super", "e2-addr", "e2-phone"]) expect(f[id]).toBe("");
  await page.close();
});

test("answers are saved as you move on: everyday ones everywhere, this company's for this site, essays offered not filled; Undo removes one", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/learn.html"));
  expect((await ext.autofill(page)).ok).toBe(true);
  await page.locator("#shift").fill("Mornings");
  await page.locator("input[name=before][value=No]").check();
  await page.locator("#why").fill("I build tools that help small teams move faster, and Brightfold's mission fits that.");
  await page.locator("#continue").click();
  await expect.poll(() => api.state.answers.length, { timeout: 8000 }).toBe(3);
  const keys = Object.fromEntries(api.state.answers.map((x) => [x.question_key, x.answer]));
  expect(keys["which shift do you prefer"]).toBe("Mornings");
  expect(keys["localhost|have you ever worked for our company before"]).toBe("No");
  expect(Object.keys(keys).some((k) => k.startsWith("essay|why do you want to work here"))).toBe(true);

  // The panel lists them; Undo forgets one.
  const panel = await (async () => {
    const tabId = await ext.tabIdOf(page);
    const p = await ext.context.newPage();
    await p.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${tabId}`);
    return p;
  })();
  const saved = panel.getByTestId("saved-now");
  await expect(saved.getByText("Saved 3 answers")).toBeVisible({ timeout: 8000 });
  await saved.getByRole("button", { name: "Review" }).click();
  await expect(saved.getByText("Only for this company")).toBeVisible();
  await saved.getByRole("listitem").filter({ hasText: "Which shift" }).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => api.state.answers.length).toBe(2);
  await api.state.answers.push({ question_key: "which shift do you prefer", question_text: "Which shift do you prefer?", answer: "Mornings" });
  api.state.bundleVersion++;
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill"]));

  // Another company's application (another site): the everyday answer fills;
  // "worked for our company" doesn't; the essay is offered, never filled.
  const other = await ext.context.newPage();
  await other.goto(lab.otherOrigin("/lab/learn.html"));
  expect((await ext.autofill(other)).ok).toBe(true);
  await expect(other.locator("#shift")).toHaveValue("Mornings");
  await expect(other.locator("input[name=before]:checked")).toHaveCount(0);
  await expect(other.locator("#why")).toHaveValue("");
  const p2 = await ext.context.newPage();
  await p2.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${await ext.tabIdOf(other)}`);
  await p2.getByRole("button", { name: "Use saved answer" }).click();
  await expect(other.locator("#why")).toHaveValue(/Brightfold's mission/);
  await Promise.all([page.close(), panel.close(), other.close(), p2.close()]);
});
