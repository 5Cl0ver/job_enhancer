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
  api.state.jobs = [];
  api.state.jobsVersion++;
  api.state.history = null;
  api.state.promoted = true; // promotion has its own test
  api.state.bundleVersion++;
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.remove(["je_autofill", "je_chosen_resume", "je_saved_cache", "je_not_this", "je_page_job"]);
    const all = await chrome.storage.session.get(null);
    await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith("je_resume_choice:")));
  });
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
  api.state.promoted = false;
  api.state.bundleVersion++;
  await new Promise((r) => setTimeout(r, 300));
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill"]));
  await ext.bg({ type: "refreshAutofillCopy" });
  await expect.poll(() => api.state.answers.map((x) => `${x.question_key}=${x.answer}`), { timeout: 8000 }).toEqual(["@preferred_name=Ren"]);
  const b = await ext.context.newPage();
  await b.goto(lab.url("/lab/names-b.html"));
  expect((await ext.autofill(b)).ok).toBe(true);
  await expect(b.locator("#nick")).toHaveValue("Ren");
  await expect(b.locator("#first")).toHaveValue(PERSON.profile.first_name);
  // Once per ACCOUNT: recorded on the account, so deleting the answer in the
  // app sticks, even on another computer (a fresh copy).
  await expect.poll(() => api.state.promoted).toBe(true);
  api.state.answers = [];
  api.state.bundleVersion++;
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_autofill"]));
  await ext.bg({ type: "refreshAutofillCopy" });
  await new Promise((r) => setTimeout(r, 500));
  expect(api.state.answers).toEqual([]);
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


test("pointing at a name box never saves it by itself; only Always use this does", async () => {
  const a = await ext.context.newPage();
  await a.goto(lab.url("/lab/names-a.html"));
  await a.locator("#legal").fill("Renata");
  const panel = await panelFor(a);
  await ext.bg({ type: "startPick", tabId: await ext.tabIdOf(a) });
  await expect(panel.getByTestId("pointing")).toBeVisible({ timeout: 5000 });
  await clickBox(a, a.locator("#legal"));
  const ask = panel.getByTestId("what-goes-here");
  await expect(ask.getByLabel("The answer")).toHaveValue("Renata", { timeout: 5000 });
  await a.waitForTimeout(500);
  expect(api.state.answers).toEqual([]); // nothing saved by pointing alone
  await expect(ask.getByText(/Saved “/)).toHaveCount(0);
  await Promise.all([a.close(), panel.close()]);
});

const DATA_RESUME = () => ({
  filename: "wren-data.pdf",
  bytes: Buffer.from("%PDF-1.4\n% invented data résumé\n"),
  details: { work: [{ title: "Data Analyst", company: "Tidewell Labs", location: "Harborview, OR", start_month: 3, start_year: 2023, end_month: null, end_year: null, current: true, description: "" }] },
});

test("with the panel closed, a press uses the linked job's own résumé", async () => {
  api.state.history = { work: [{ title: "Help Desk Analyst", company: "Quillstone", start_month: 6, start_year: 2020, end_month: 2, end_year: 2023, current: false }], education: [] };
  api.state.resumes = { "resume-2": DATA_RESUME() };
  const url = lab.url("/lab/employment.html");
  api.state.jobs = [{ id: "j1", job_listing_id: "l1", title: "Application", company: "Opal Ridge Labs", location: "", url, applied_at: null, resume_id: "resume-2" }];
  api.state.jobsVersion++;
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(url);
  expect((await ext.autofill(page)).ok).toBe(true); // no panel open
  const f = await page.evaluate(() => window.__formData());
  expect(f["e1-company"]).toBe("Tidewell Labs");
  expect(api.calls("/v1/autofill/resumes/resume-2/file").length).toBeGreaterThan(0);
  await page.close();
});

test("a résumé chosen on one page doesn't follow you to another page in the same tab", async () => {
  api.state.history = { work: [{ title: "Help Desk Analyst", company: "Quillstone", start_month: 6, start_year: 2020, end_month: 2, end_year: 2023, current: false }], education: [] };
  api.state.resumes = { "resume-2": DATA_RESUME() };
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/employment.html"));
  await ext.bg({ type: "chooseResume", tabId: await ext.tabIdOf(page), resumeId: "resume-2", filename: "wren-data.pdf" });
  await page.goto(lab.url("/lab/employment.html?step=2"));
  expect((await ext.autofill(page)).ok).toBe(true);
  expect((await page.evaluate(() => window.__formData()))["e1-company"]).toBe("Quillstone");
  await page.close();
});

test("choosing your usual résumé for a job sticks, over the job's own", async () => {
  api.state.history = { work: [{ title: "Help Desk Analyst", company: "Quillstone", start_month: 6, start_year: 2020, end_month: 2, end_year: 2023, current: false }], education: [] };
  api.state.resumes = { "resume-2": DATA_RESUME() };
  const url = lab.url("/lab/employment.html");
  api.state.jobs = [{ id: "j1", job_listing_id: "l1", title: "Application", company: "Opal Ridge Labs", location: "", url, applied_at: null, resume_id: "resume-2" }];
  api.state.jobsVersion++;
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(url);
  await ext.bg({ type: "chooseResume", tabId: await ext.tabIdOf(page), resumeId: null, filename: "" });
  expect(api.state.jobResumes.j1).toBe("usual");
  expect((await ext.autofill(page)).ok).toBe(true);
  expect((await page.evaluate(() => window.__formData()))["e1-company"]).toBe("Quillstone");
  await page.close();
});

test("a chosen résumé that was never read is read on the spot; its sections never come from another résumé", async () => {
  api.state.history = { work: [{ title: "Help Desk Analyst", company: "Quillstone", start_month: 6, start_year: 2020, end_month: 2, end_year: 2023, current: false }], education: [] };
  const r = DATA_RESUME();
  api.state.resumes = { "resume-2": { ...r, unread: true, readsAs: r.details, details: {} } };
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/employment.html"));
  await ext.bg({ type: "chooseResume", tabId: await ext.tabIdOf(page), resumeId: "resume-2", filename: "wren-data.pdf" });
  expect((await ext.autofill(page)).ok).toBe(true);
  expect(api.calls("/v1/autofill/resumes/resume-2/read").length).toBeGreaterThan(0);
  expect((await page.evaluate(() => window.__formData()))["e1-company"]).toBe("Tidewell Labs");
  await page.close();
});


test("a typed salary is kept for this site only, never as an answer for every site", async () => {
  const a = await ext.context.newPage();
  await a.goto(lab.url("/lab/names-a.html"));
  expect((await ext.autofill(a)).ok).toBe(true);
  await a.locator("#salary").fill("95000");
  await a.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => api.state.answers.find((x) => x.answer === "95000")?.question_key, { timeout: 8000 }).toMatch(/\|desired salary$/);
  expect(api.state.answers.some((x) => x.question_key === "@desired_salary")).toBe(false);
  await a.close();
});

test("a job's résumé changed in the app wins over an earlier pick in the panel", async () => {
  api.state.history = { work: [{ title: "Help Desk Analyst", company: "Quillstone", start_month: 6, start_year: 2020, end_month: 2, end_year: 2023, current: false }], education: [] };
  api.state.resumes = { "resume-2": DATA_RESUME() };
  const url = lab.url("/lab/employment.html");
  api.state.jobs = [{ id: "j1", job_listing_id: "l1", title: "Application", company: "Opal Ridge Labs", location: "", url, applied_at: null, resume_id: null }];
  api.state.jobsVersion++;
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(url);
  await ext.bg({ type: "chooseResume", tabId: await ext.tabIdOf(page), resumeId: "resume-2", filename: "wren-data.pdf" });
  expect(api.state.jobResumes.j1).toBe("resume-2"); // written through to the job
  // Then, in the app, the job goes back to the usual résumé.
  api.state.jobs[0].resume_id = null;
  api.state.jobs[0].resume_usual = true;
  api.state.jobsVersion++;
  await ext.bg({ type: "listSaved", version: null });
  expect((await ext.autofill(page)).ok).toBe(true);
  expect((await page.evaluate(() => window.__formData()))["e1-company"]).toBe("Quillstone");
  await page.close();
});
