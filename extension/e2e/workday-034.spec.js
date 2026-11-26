// Spec 034: Job Catcher on Workday, in real Chromium. The Workday lab copies
// (test/lab/workday-*.html) served at an invented Workday address: Create
// Account fills the email only; "previously employed" from the job history;
// only real agreements are the user's; Add to profile; the job page read by
// itself; an unsaved application saved and marked applied on Submit, once.
// Nothing is ever submitted by Job Catcher. Invented company and applicant.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { ROOT, launchExtension } from "./support/launch.js";

const JOB = "https://northwind.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Applications-Developer-II_JR-1001";
const PAGES = {
  signup: `${JOB}/apply/applyManually`,
  info: `${JOB}/apply/useMyLastApplication`,
  questions: `${JOB}/apply/autofillWithResume`,
  job: JOB,
  review: `${JOB}/apply/review`,
};
const FILES = { signup: "workday-signup.html", info: "workday-info.html", questions: "workday-questions.html", job: "workday-job.html", review: "workday-review.html" };
const HISTORY = { work: [{ title: "Support Engineer", company: "Tidewell Labs", location: "Portland, OR", start_month: 1, start_year: 2022, end_month: null, end_year: null, current: true, description: "Kept the lab running." }], education: [] };

let api;
let lab;
let ext;

test.beforeAll(async () => {
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url });
  for (const [k, url] of Object.entries(PAGES)) {
    const html = readFileSync(join(ROOT, "test", "lab", FILES[k]), "utf8");
    await ext.context.route(url, (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
  }
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
  api.state.jobs = [];
  api.state.saved = [];
  api.state.jobsVersion++;
  api.state.profile = { ...PERSON.profile, postal_code: null };
  api.state.bundleVersion++;
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.remove(["je_autofill", "je_saved_cache", "je_not_this", "je_page_job"]);
    await chrome.storage.sync.set({ je_super: false }); // press-only: each step is checked as pressed
  });
});

const form = (page) => page.evaluate(() => window.__formData());

async function panelFor(page) {
  const p = await ext.context.newPage();
  await p.setViewportSize({ width: 380, height: 900 });
  await p.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${await ext.tabIdOf(page)}`);
  return p;
}

/** What the panel lists for the user on a tab: label → why. */
async function needs(page) {
  const s = await ext.bg({ type: "getFillSession", tabId: await ext.tabIdOf(page) });
  return Object.fromEntries(Object.values(s.frames || {}).flatMap((f) => (f.need_you || []).map((n) => [n.label, n.reason])));
}

test("Create Account: the email is filled, passwords and the agreement never are, and the panel says what's next", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAGES.signup);
  const panel = await panelFor(page);
  await expect(panel.getByTestId("signup-note")).toContainText("Job Catcher fills your email", { timeout: 10000 });
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect(page.locator("#email")).toHaveValue(PERSON.email);
  await expect(page.locator("#password")).toHaveValue("");
  await expect(page.locator("#verifyPassword")).toHaveValue("");
  await expect(page.locator("#agree")).not.toBeChecked();
  await expect(panel.getByTestId("signup-note")).toContainText(
    "Create your account: email filled. Pick a password (Chrome can suggest one), tick the agreement, then Create Account.",
  );
  expect(await needs(page)).toEqual({ "Yes, I have read and consent to the Terms and Conditions": "consent" });
  await Promise.all([page.close(), panel.close()]);
});

test("a job board's sign-in page (not an application system) is still not a form", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/workday-signup.html"));
  await page.waitForTimeout(1500);
  expect((await ext.fillState(page))?.form ?? false).toBe(false);
  await page.close();
});

test("previously employed: No from a job history without the company; Address and Add to profile", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAGES.info);
  const panel = await panelFor(page);
  await panel.getByRole("button", { name: "Autofill this page" }).click();
  await expect.poll(async () => (await form(page)).candidateIsPreviousWorker, { timeout: 10000 }).toBe("No");
  await expect(page.locator("#addressSection_addressLine1")).toHaveValue(PERSON.profile.address_line1);
  expect((await needs(page))["Postal Code"]).toBe("no_data");

  // "Not in your profile yet" → Add to profile → saved and filled.
  const row = panel.getByRole("listitem").filter({ hasText: "Postal Code" });
  await expect(row.getByText("Not in your profile yet")).toBeVisible();
  await row.getByRole("button", { name: "Add to profile" }).click();
  await row.getByRole("textbox").fill("97201");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#addressSection_postalCode")).toHaveValue("97201");
  expect(api.state.profile.postal_code).toBe("97201");
  await expect(panel.getByRole("listitem").filter({ hasText: "Postal Code" }).getByText("Not in your profile yet")).toHaveCount(0);
  await Promise.all([page.close(), panel.close()]);
});

test("previously employed: Yes when the company is in the job history (names compared loosely)", async () => {
  api.state.history = { ...HISTORY, work: [...HISTORY.work, { title: "Intern", company: "Northwind Labs Inc.", current: false }] };
  api.state.bundleVersion++;
  const page = await ext.context.newPage();
  await page.goto(PAGES.info);
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect.poll(async () => (await form(page)).candidateIsPreviousWorker, { timeout: 10000 }).toBe("Yes");
  await page.close();
});

test("Application Questions: only the agreement and the required unknown boxes are the user's; a remembered tick is ticked", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAGES.questions);
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect.poll(() => needs(page), { timeout: 10000 }).toEqual({
    "I am at least 18 years of age": "unknown",
    "Which shifts can you work?": "unknown",
    "I certify that the information I have provided is true and complete.": "consent",
  });
  for (const id of ["secondary", "board", "age", "attest"]) await expect(page.locator(`#${id}`)).not.toBeChecked();

  // Ticked "secondary employment" on this site: the next application here
  // ticks it. "Board of directors" was ticked on another site: only offered.
  api.state.answers = [
    { question_key: "northwind.wd5.myworkdayjobs.com|i currently have secondary employment", answer: "Yes" },
    { question_key: "i serve on a board of directors", answer: "Yes" },
  ];
  api.state.bundleVersion++;
  await ext.worker.evaluate(() => chrome.storage.local.remove("je_autofill"));
  const next = await ext.context.newPage();
  await next.goto(PAGES.questions);
  const panel = await panelFor(next);
  expect((await ext.autofill(next)).ok).toBe(true);
  await expect(next.locator("#secondary")).toBeChecked();
  await expect(next.locator("#board")).not.toBeChecked();
  await expect(next.locator("#attest")).not.toBeChecked();
  const board = panel.getByRole("listitem").filter({ hasText: "I serve on a board of directors" });
  await board.getByRole("button", { name: "Use saved answer" }).click(); // the user's tap
  await expect(next.locator("#board")).toBeChecked();
  await expect(next.locator("#attest")).not.toBeChecked();
  await Promise.all([page.close(), next.close(), panel.close()]);
});

test("a sign-in on a Workday job page never marks a job applied, and the real Submit still counts", async () => {
  const signIn = `${JOB}/apply/signIn`;
  await ext.context.route(signIn, (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><title>Sign In</title><h2>Sign In</h2><form onsubmit="return false"><label>Email Address<input type="text"></label><label>Password<input type="password"></label><button>Sign In</button><button type="button" data-automation-id="bottom-navigation-next-button">Submit</button></form>',
    }),
  );
  const page = await ext.context.newPage();
  await page.goto(signIn);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.getByRole("button", { name: "Submit" }).click(); // a password showing: not the application's Submit
  await page.waitForTimeout(1500);
  expect(api.calls("/v1/saved-jobs/mark-applied")).toHaveLength(0);
  await page.goto(PAGES.questions); // signed in: the application's own Submit
  await page.locator("#submit").click();
  await expect.poll(() => api.calls("/v1/saved-jobs/mark-applied").length, { timeout: 10000 }).toBe(1);
  await page.close();
  await ext.context.unroute(signIn);
});

test("a Workday job page: the panel shows the job by itself, and Save saves it", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAGES.job);
  const panel = await panelFor(page);
  const card = panel.getByTestId("workday-job");
  await expect(card.getByRole("heading", { name: "Applications Developer II" })).toBeVisible({ timeout: 10000 });
  await expect(card).toContainText("Northwind Labs · Portland, OR");
  await card.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => api.calls("/v1/saved-jobs/manual").length).toBe(1);
  const [{ body }] = api.calls("/v1/saved-jobs/manual");
  expect(body).toMatchObject({ url: JOB, title: "Applications Developer II", company: "Northwind Labs", origin: "extension" });
  expect(body.description).toContain("Build and support the apps");
  // Now it's in My Jobs: the card gives way to the saved job.
  await expect(panel.getByText("In My Jobs")).toBeVisible({ timeout: 10000 });
  await Promise.all([page.close(), panel.close()]);
});

test("an unsaved Workday application: Submit saves it from the page and marks it applied, once", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAGES.questions);
  const panel = await panelFor(page);
  // The panel shows which job the application belongs to, from its address.
  const card = panel.getByTestId("workday-job");
  await expect(card).toContainText("Applications Developer II", { timeout: 10000 });
  await expect(card.getByRole("button", { name: "Save & track" })).toBeVisible();

  await page.locator("#submit").click(); // the user's own Submit (twice: a double click)
  await page.locator("#submit").click();
  await expect.poll(() => api.state.jobs.length, { timeout: 10000 }).toBe(1);
  await page.waitForTimeout(1500);
  const calls = api.calls("/v1/saved-jobs/mark-applied");
  expect(calls.length).toBe(1);
  expect(calls[0].body.create).toEqual({ url: JOB, title: "Applications Developer II", company: "Northwind", location: "Portland, OR" });
  expect(api.state.jobs[0].applied_at).toBeTruthy();
  await expect(panel.getByTestId("tracked-note")).toContainText("Saved and marked applied", { timeout: 10000 });
  await Promise.all([page.close(), panel.close()]);
});

test("Workday's Review step drawn with a click_filter overlay: Back and Save never count, the overlay's Submit does, once", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAGES.review);
  await page.locator("#back").click();
  await page.locator("#save").click();
  await page.waitForTimeout(1000);
  expect(api.calls("/v1/saved-jobs/mark-applied")).toHaveLength(0);
  await page.locator("#filter").click();
  await expect.poll(() => api.calls("/v1/saved-jobs/mark-applied").length, { timeout: 10000 }).toBe(1);
  await page.waitForTimeout(1000);
  expect(api.calls("/v1/saved-jobs/mark-applied")).toHaveLength(1);
  expect(api.calls("/v1/saved-jobs/mark-applied")[0].body.create).toMatchObject({ url: JOB, title: "Applications Developer II" });
  await page.close();
});
