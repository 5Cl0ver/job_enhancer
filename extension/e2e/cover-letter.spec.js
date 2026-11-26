// Cover letters (spec 031): the job's cover letter goes into the page's
// cover-letter upload box (its PDF) and cover-letter text box (its text), never
// the résumé box; with no letter both are left. Real Chromium, the lab, the
// fake server. Invented applicant only.
import { test, expect } from "@playwright/test";
import { startFakeApi } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { launchExtension } from "./support/launch.js";

let api;
let lab;
let ext;

const LETTER = "The Platform Engineer role at Northwind Labs fits what I do.\n\nThanks for your time,\nWren Calloway";

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
  api.state.coverLetters = { "cl-1": { filename: "Wren Calloway - Cover letter.pdf", text: LETTER } };
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.remove(["je_autofill", "je_saved_cache"]);
  });
});

function linkJob(url, coverLetterId) {
  api.state.jobs = [
    { id: "j1", job_listing_id: "l1", title: "Platform Engineer", company: "Northwind Labs", location: "", url, applied_at: null, resume_id: null, cover_letter_id: coverLetterId },
  ];
  api.state.jobsVersion++;
}

const fileName = (page, sel) => page.locator(sel).evaluate((el) => el.files[0]?.name || "");

test("the job's cover letter goes in the cover-letter boxes, the résumé in its own", async () => {
  const url = lab.url("/lab/cover-letter.html");
  linkJob(url, "cl-1");
  const page = await ext.context.newPage();
  await page.goto(url);
  expect((await ext.autofill(page)).ok).toBe(true);
  expect(await fileName(page, "#resume")).toBe("wren-calloway.pdf");
  expect(await fileName(page, "#letter-file")).toBe("Wren Calloway - Cover letter.pdf");
  await expect(page.locator("#letter-text")).toHaveValue(LETTER);
  await expect(page.locator("#why")).toHaveValue(""); // an essay stays the user's
  await expect(page.locator("#else")).toHaveValue(""); // "(e.g. cover letter)" isn't the letter's box
  expect(api.calls("/v1/autofill/cover-letters/cl-1").length).toBeGreaterThan(0);
  await page.close();
});

test("no cover letter for the job: both boxes are left for you", async () => {
  const url = lab.url("/lab/cover-letter.html");
  linkJob(url, null);
  const page = await ext.context.newPage();
  await page.goto(url);
  expect((await ext.autofill(page)).ok).toBe(true);
  expect(await fileName(page, "#resume")).toBe("wren-calloway.pdf");
  expect(await fileName(page, "#letter-file")).toBe("");
  await expect(page.locator("#letter-text")).toHaveValue("");
  expect(api.calls("/v1/autofill/cover-letters/cl-1")).toHaveLength(0);
  await page.close();
});

test("a lone upload box in a 'Cover Letter' fieldset never gets the résumé", async () => {
  const url = lab.url("/lab/cover-letter-only.html");
  linkJob(url, null);
  const page = await ext.context.newPage();
  await page.goto(url);
  expect((await ext.autofill(page)).ok).toBe(true);
  expect(await fileName(page, "#only-file")).toBe("");
  // With a letter for the job, the letter goes there.
  linkJob(url, "cl-1");
  await ext.worker.evaluate(() => chrome.storage.local.remove("je_saved_cache"));
  expect((await ext.autofill(page)).ok).toBe(true);
  expect(await fileName(page, "#only-file")).toBe("Wren Calloway - Cover letter.pdf");
  await page.close();
});

test("an edited letter is attached as it is now, never an older copy", async () => {
  const url = lab.url("/lab/cover-letter.html");
  linkJob(url, "cl-1");
  const page = await ext.context.newPage();
  await page.goto(url);
  expect((await ext.autofill(page)).ok).toBe(true);
  await expect(page.locator("#letter-text")).toHaveValue(LETTER);
  await page.close();
  api.state.coverLetters["cl-1"].text = "Edited in the app.";
  // A fresh page (a reload can be pressed before its reader is back).
  const again = await ext.context.newPage();
  await again.goto(url);
  expect((await ext.autofill(again)).ok).toBe(true);
  await expect(again.locator("#letter-text")).toHaveValue("Edited in the app.");
  await again.close();
});
