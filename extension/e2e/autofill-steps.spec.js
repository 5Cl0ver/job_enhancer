// Multi-step applications and learning (spec 015, Stories 3–4): one press,
// then each Workday-shaped step fills as it appears; what the user types as they
// move on is offered to remember — and fills the next application. Real
// Chromium, the lab's invented 4-step application, the fake server.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { ROOT, launchExtension } from "./support/launch.js";

const URL = "https://vellacor.wd5.myworkdayjobs.com/en-US/External/job/Harborview-OR/Field-Service-Technician_R-2041/apply/applyManually";
const HISTORY = {
  work: [
    { title: "Field Service Technician", company: "Tidewell Labs", location: "Harborview, OR", start_month: 3, start_year: 2023, end_month: null, end_year: null, current: true, description: "Repaired lab equipment at customer sites." },
  ],
  education: [{ school: "Harborview Community College", degree: "Associate of Science", field_of_study: "Electronics", start_year: 2019, end_year: 2021 }],
};

let api;
let lab;
let ext;

test.beforeAll(async () => {
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url });
  const html = readFileSync(join(ROOT, "test", "lab", "workday.html"), "utf8");
  await ext.context.route(URL, (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

test.beforeEach(async () => {
  api.reset();
  api.clearCalls();
  api.state.history = HISTORY;
  api.state.answers = [];
  api.state.profile = { ...PERSON.profile, address_line1: null };
  api.state.bundleVersion++;
  // A fresh copy for each test (the extension refreshes at most once a minute).
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill"]));
  await ext.worker.evaluate(() => chrome.storage.sync.remove("je_super")); // Super autofill back to its default (on)
});

const form = (page) => page.evaluate(() => window.__formData());
const next = (page) => page.locator("#next").click();

async function panelFor(page) {
  const tabId = await ext.worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, URL);
  const panel = await ext.context.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${tabId}`);
  return panel;
}

test("Super autofill (on by default): one press, then every later step fills as it appears", async () => {
  const page = await ext.context.newPage();
  await page.goto(URL);
  await ext.autofill(page);
  // The step is done when its last field (after the country dropdown) is in.
  await expect.poll(async () => (await form(page)).addressSection_city, { timeout: 15000 }).toBe("Harborview");
  const one = await form(page);
  expect(one.email).toBe(PERSON.email);
  expect(one["phone-number"]).toBe(PERSON.profile.phone);
  expect(one.country).toBe("United States of America"); // not "…Minor Outlying Islands"
  expect(one.addressSection_city).toBe("Harborview");

  // Step 2, no press: work experience and education from the résumé.
  await next(page);
  await expect.poll(async () => (await form(page))["wx-title"], { timeout: 15000 }).toBe("Field Service Technician");
  await expect.poll(async () => (await form(page)).degree, { timeout: 15000 }).toBe("Associate's Degree");
  await expect.poll(async () => (await form(page)).fieldOfStudy, { timeout: 15000 }).toBe("Electronics"); // the step's last
  const two = await form(page);
  expect(two["wx-company"]).toBe("Tidewell Labs");
  expect(two.schoolName).toBe("Harborview Community College");
  expect(two.fieldOfStudy).toBe("Electronics");

  // Step 3: the profile's Yes/No answers; the custom question waits for the user.
  await next(page);
  await expect.poll(async () => (await form(page))["q-auth"], { timeout: 15000 }).toBe("Yes");
  await expect.poll(async () => (await form(page))["q-sponsor"], { timeout: 15000 }).toBe("No");
  expect((await form(page))["q-heard"]).toBeUndefined();

  // Step 4: self-identification is never touched.
  await next(page);
  await page.waitForTimeout(3000);
  const four = await form(page);
  expect(four.gender).toBeUndefined();
  expect(four.veteran).toBeUndefined();
  await page.close();
});

test("what you type is saved as you move on — answers and the profile's missing parts — and fills the next application", async () => {
  const page = await ext.context.newPage();
  await page.goto(URL);
  await ext.autofill(page);
  // The step is done when its last field (after the country dropdown) is in.
  await expect.poll(async () => (await form(page)).addressSection_city, { timeout: 15000 }).toBe("Harborview");
  // The profile had no street address: the user types it, then moves on.
  await page.locator("#addressSection_addressLine1").fill("12 Ferry Lane");
  await next(page);
  await next(page);
  await ext.autofill(page); // each step fills when pressed
  await expect.poll(async () => (await form(page))["q-auth"], { timeout: 15000 }).toBe("Yes");
  // A question the app didn't know, answered by hand (once autofill is done
  // with this step: it asked the AI about it).
  await expect
    .poll(() => api.calls("/v1/ai/autofill-map").some((c) => JSON.stringify(c.body).includes("How did you hear")), { timeout: 15000 })
    .toBe(true);
  await page.waitForTimeout(500);
  await page.locator("#q-heard").click();
  await page.getByRole("option", { name: "Employee Referral" }).click();
  await next(page);

  // Saved automatically as the user moved on — no press (spec 018): the new
  // answer, and the street address the profile was missing.
  await expect.poll(() => api.state.profile.address_line1, { timeout: 8000 }).toBe("12 Ferry Lane");
  await expect
    .poll(() => api.state.answers.map((x) => `${x.question_key}=${x.answer}`), { timeout: 8000 })
    .toContain("how did you hear about this opportunity=Employee Referral");
  const panel = await panelFor(page);
  const saved = panel.getByTestId("saved-now");
  await expect(saved).toBeVisible({ timeout: 8000 });
  await saved.getByRole("button", { name: "Review" }).click();
  await expect(saved.getByLabel("Saved answer to How did you hear about this opportunity?")).toHaveValue("Employee Referral");

  // The next application: both fill by themselves.
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill"]));
  const again = await ext.context.newPage();
  await again.goto(URL);
  await ext.autofill(again);
  await expect.poll(async () => (await form(again)).addressSection_addressLine1, { timeout: 15000 }).toBe("12 Ferry Lane");
  await next(again);
  await next(again);
  await ext.autofill(again); // each step fills when pressed
  await expect.poll(async () => (await form(again))["q-heard"], { timeout: 15000 }).toBe("Employee Referral");
  await Promise.all([page.close(), panel.close(), again.close()]);
});

test("Super autofill switched off: nothing fills without a press; switched on: the next step fills", async () => {
  const page = await ext.context.newPage();
  await page.goto(URL);
  await ext.autofill(page);
  // The step is done when its last field (after the country dropdown) is in.
  await expect.poll(async () => (await form(page)).addressSection_city, { timeout: 15000 }).toBe("Harborview");
  const panel = await panelFor(page);
  const keep = panel.getByRole("switch", { name: "Super autofill" });
  await expect(keep).toHaveAttribute("aria-checked", "true"); // on by default
  await keep.click();
  await expect(keep).toHaveAttribute("aria-checked", "false");
  await expect(panel.getByText("Off: Job Catcher fills only when you press Autofill.")).toBeVisible();
  // The next step: nothing fills until a press.
  await next(page);
  await page.waitForTimeout(3000);
  expect((await form(page))["wx-title"]).toBeUndefined();
  // Switched on: the step after fills by itself.
  await keep.click();
  await expect(keep).toHaveAttribute("aria-checked", "true");
  await next(page);
  await expect.poll(async () => (await form(page))["q-auth"], { timeout: 15000 }).toBe("Yes");
  await Promise.all([page.close(), panel.close()]);
});

test("an unsure AI answer is a suggestion: shown, filled only on Use", async () => {
  api.state.aiAnswers = { "How did you hear about this opportunity?": { value: "LinkedIn", confidence: 0.6 } };
  const page = await ext.context.newPage();
  await page.goto(URL);
  await ext.autofill(page);
  // The step is done when its last field (after the country dropdown) is in.
  await expect.poll(async () => (await form(page)).addressSection_city, { timeout: 15000 }).toBe("Harborview");
  await next(page);
  await next(page);
  await ext.autofill(page); // each step fills when pressed
  await expect.poll(async () => (await form(page))["q-auth"], { timeout: 15000 }).toBe("Yes");
  const panel = await panelFor(page);
  const row = panel.getByRole("listitem").filter({ hasText: "How did you hear about this opportunity?" });
  await expect(row).toContainText("Suggested: LinkedIn", { timeout: 15000 });
  expect((await form(page))["q-heard"]).toBeUndefined();
  await row.getByRole("button", { name: /Use the suggestion/ }).click();
  await expect.poll(async () => (await form(page))["q-heard"], { timeout: 10000 }).toBe("LinkedIn");
  await Promise.all([page.close(), panel.close()]);
});
