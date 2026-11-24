// Spec 020: correct a box once and every application gets it; the résumé
// chosen for an application is the one uploaded and filled from. Real
// Chromium, the lab, the fake server. Invented applicant only.
import { test, expect } from "@playwright/test";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { launchExtension } from "./support/launch.js";

let api;
let lab;
let ext;

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
  api.state.resumes = {};
  api.state.history = null;
  api.state.bundleVersion++;
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill", "je_chosen_resume", "je_promoted_020"]));
});

async function clickBox(page, box) {
  const b = await box.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function panelFor(page) {
  const p = await ext.context.newPage();
  await p.setViewportSize({ width: 380, height: 900 });
  await p.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${await ext.tabIdOf(page)}`);
  return p;
}

test("correct a preferred name once with the pointer: every other wording on another page gets it; the legal name never does", async () => {
  const a = await ext.context.newPage();
  await a.goto(lab.url("/lab/names-a.html"));
  expect((await ext.autofill(a)).ok).toBe(true);
  await expect(a.locator("#pref")).toHaveValue(PERSON.profile.first_name); // the profile's first name, as before

  const panel = await panelFor(a);
  await ext.bg({ type: "startPick", tabId: await ext.tabIdOf(a) });
  await expect(panel.getByTestId("pointing")).toBeVisible({ timeout: 5000 });
  await clickBox(a, a.locator("#pref"));
  const ask = panel.getByTestId("what-goes-here");
  await expect(ask.getByTestId("where-saved")).toHaveText(/every site/, { timeout: 5000 });
  await ask.getByLabel("The answer").fill("Ren");
  await ask.getByRole("button", { name: "Always use this", exact: true }).click();
  await expect(a.locator("#pref")).toHaveValue("Ren");
  await expect.poll(() => api.state.answers.find((x) => x.question_key === "@preferred_name")?.answer).toBe("Ren");
  expect(api.state.taught.length).toBe(0); // not a one-site box any more

  const b = await ext.context.newPage();
  await b.goto(lab.url("/lab/names-b.html"));
  expect((await ext.autofill(b)).ok).toBe(true);
  await expect(b.locator("#nick")).toHaveValue("Ren");
  await expect(b.locator("#goes")).toHaveValue("Ren");
  await expect(b.locator("#first")).toHaveValue(PERSON.profile.first_name);
  await Promise.all([a.close(), b.close(), panel.close()]);
});

test("typing over what Job Catcher filled teaches it too; a question about one company stays with that company", async () => {
  const a = await ext.context.newPage();
  await a.goto(lab.url("/lab/names-a.html"));
  expect((await ext.autofill(a)).ok).toBe(true);
  await a.locator("#pref").fill("Ren");
  await a.locator("#heard").fill("A friend");
  await a.locator("#team").fill("Robotics");
  // Moving on saves what was typed (spec 018), now for every site (spec 020).
  await a.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => api.state.answers.map((x) => `${x.question_key}=${x.answer}`), { timeout: 8000 }).toEqual(
    expect.arrayContaining(["@preferred_name=Ren", "how did you hear about us=A friend"]),
  );
  const team = api.state.answers.find((x) => x.answer === "Robotics");
  expect(team?.question_key).toMatch(/\|which team are you most excited about at our company$/);

  const b = await ext.context.newPage();
  await b.goto(lab.url("/lab/names-b.html"));
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill"]));
  expect((await ext.autofill(b)).ok).toBe(true);
  await expect(b.locator("#nick")).toHaveValue("Ren");
  await expect(b.locator("#heard")).toHaveValue("A friend");
  await expect(b.locator("#first")).toHaveValue(PERSON.profile.first_name);
  await Promise.all([a.close(), b.close()]);
});

test("Only this site keeps an answer to the box where it was taught", async () => {
  const a = await ext.context.newPage();
  await a.goto(lab.url("/lab/names-a.html"));
  const panel = await panelFor(a);
  await ext.bg({ type: "startPick", tabId: await ext.tabIdOf(a) });
  await expect(panel.getByTestId("pointing")).toBeVisible({ timeout: 5000 });
  await clickBox(a, a.locator("#heard"));
  const ask = panel.getByTestId("what-goes-here");
  await expect(ask.getByTestId("where-saved")).toBeVisible({ timeout: 5000 });
  await ask.getByLabel("The answer").fill("Career fair");
  await ask.getByRole("button", { name: "Only this site" }).click();
  await expect(a.locator("#heard")).toHaveValue("Career fair");
  await expect.poll(() => api.state.taught.map((t) => t.answer)).toEqual(["Career fair"]);
  expect(api.state.answers.length).toBe(0);
  await Promise.all([a.close(), panel.close()]);
});

test("answers taught on one site before 0.36 are promoted once: preferred name everywhere, never the legal first name", async () => {
  api.state.taught = [
    { id: "t1", site: "apply.example.com", fingerprint: { label: "preferred name", kind: "text", section: "" }, profile_key: null, answer: "Ren", updated_at: "2026-11-20T00:00:00Z" },
    { id: "t2", site: "acme.wd5.myworkdayjobs.com", fingerprint: { label: "first name", kind: "text", section: "" }, profile_key: null, answer: "Ren", updated_at: "2026-11-23T00:00:00Z" },
  ];
  api.state.bundleVersion++;
  // A refresh still running from an earlier test may have marked it done.
  await new Promise((r) => setTimeout(r, 500));
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill", "je_promoted_020"]));
  await ext.bg({ type: "refreshAutofillCopy" });
  await expect.poll(() => api.state.answers.map((x) => `${x.question_key}=${x.answer}`), { timeout: 8000 }).toEqual(["@preferred_name=Ren"]);
  const b = await ext.context.newPage();
  await b.goto(lab.url("/lab/names-b.html"));
  expect((await ext.autofill(b)).ok).toBe(true);
  await expect(b.locator("#nick")).toHaveValue("Ren");
  await expect(b.locator("#first")).toHaveValue(PERSON.profile.first_name);
  // Once only.
  const before = api.calls("/v1/users/me/custom-answers").length;
  await ext.bg({ type: "refreshAutofillCopy" });
  expect(api.calls("/v1/users/me/custom-answers").length).toBe(before);
  await b.close();
});

test("the résumé chosen for an application is uploaded, and its jobs fill the employment blocks", async () => {
  api.state.history = { work: [{ title: "Help Desk Analyst", company: "Quillstone", start_month: 6, start_year: 2020, end_month: 2, end_year: 2023, current: false }], education: [] };
  api.state.resumes = {
    "resume-2": {
      filename: "wren-data.pdf",
      bytes: Buffer.from("%PDF-1.4\n% invented data résumé\n"),
      details: { work: [{ title: "Data Analyst", company: "Tidewell Labs", location: "Harborview, OR", start_month: 3, start_year: 2023, end_month: null, end_year: null, current: true, description: "" }] },
    },
  };
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/employment.html"));
  const panel = await panelFor(page);
  const choice = panel.getByTestId("resume-choice");
  await expect(choice).toBeVisible({ timeout: 8000 });
  await choice.getByRole("button", { name: "Change" }).click();
  await choice.getByLabel("Résumé for this application").selectOption("resume-2");
  await expect(choice).toContainText("wren-data.pdf");
  expect((await ext.autofill(page)).ok).toBe(true);
  const f = await page.evaluate(() => window.__formData());
  expect(f["e1-company"]).toBe("Tidewell Labs");
  expect(f["e1-title"]).toBe("Data Analyst");
  expect(api.calls("/v1/autofill/resumes/resume-2/file").length).toBeGreaterThan(0);
  await Promise.all([page.close(), panel.close()]);
});

test("a chosen résumé that can't be loaded is never swapped silently: the panel says so", async () => {
  api.state.resumes = { "resume-3": { filename: "wren-broken.pdf", bytes: Buffer.from("%PDF"), details: {} } };
  api.override("/v1/autofill/resumes/resume-3/file", { status: 404, body: { detail: "Not found" } });
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/employment.html"));
  const panel = await panelFor(page);
  const choice = panel.getByTestId("resume-choice");
  await expect(choice).toBeVisible({ timeout: 8000 });
  await choice.getByRole("button", { name: "Change" }).click();
  await choice.getByLabel("Résumé for this application").selectOption("resume-3");
  await expect(panel.getByTestId("resume-choice-failed")).toContainText("Couldn't load wren-broken.pdf");
  await Promise.all([page.close(), panel.close()]);
});
