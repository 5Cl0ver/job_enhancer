// Spec 037 in real Chromium: Workday takes the résumé from its box, empties
// the box and lists the file in its card. Job Catcher attaches it ONCE and
// says "attached" (never "failed", never a second copy: not on a second
// press, not on a Keep filling step, not as an extra drop when the list is
// slow). A "Resume/Cover Letter" box gets the résumé and the run's cover
// letter, each once. Against the fake server and the lab's invented
// application. Invented applicant only.
import { test, expect } from "@playwright/test";
import { startFakeApi } from "./support/fake-api.js";
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

test.beforeEach(() => {
  api.reset();
  api.clearCalls();
  api.state.resumes = { "resume-run": { filename: "Sam_Rivera_Northwind.pdf", bytes: Buffer.from("%PDF-1.4\n% made for this job\n") } };
  api.state.coverLetters = { "cl-1": { filename: "Sam Rivera - Cover letter.pdf", text: "Northwind Labs fits what I do." } };
});

/** Open the run on this page and let Claude ask for a fill; its result. */
async function fillOnce(id, url) {
  api.state.applyRun = { ...api.state.applyRun, requests: [{ id, kind: "fill", url, page_n: 2 }] };
  await expect.poll(() => api.calls(`/v1/apply/requests/${id}/result`).length, { timeout: 90000 }).toBe(1);
  api.state.applyRun = { ...api.state.applyRun, requests: [] };
  return api.calls(`/v1/apply/requests/${id}/result`)[0].body;
}

async function openRun(url, more = {}) {
  const host = new URL(url).hostname;
  api.state.applyRun = { run_id: "r1", status: "filling", guard: true, hosts: [host], resume_id: "resume-run", live: false, requests: [], ...more };
  const page = await ext.context.newPage();
  await page.goto(url);
  await page.bringToFront();
  return page;
}

test("Workday empties its box after taking the résumé: one upload, attached, even with two presses and a Keep filling step", async () => {
  test.setTimeout(240000);
  const url = lab.url("/lab/apply-workday-steps.html?step=2&change&clear");
  const page = await openRun(url);
  const one = await fillOnce("w1", url);
  expect(one.resume).toBe("attached");
  expect(await page.evaluate(() => window.__uploads())).toEqual(["Sam_Rivera_Northwind.pdf"]);

  // A second press: the card already lists it, so nothing again.
  const two = await fillOnce("w2", url);
  expect(two.resume).toBe("attached");

  // Keep filling (on since the press): a box added to the step fills by
  // itself, and never uploads the résumé again.
  await page.evaluate(() => {
    document.getElementById("step").insertAdjacentHTML("beforeend", '<label for="city">City</label><input id="city">');
  });
  await expect(page.locator("#city")).toHaveValue("Harborview", { timeout: 15000 }); // the step filled by itself
  await page.waitForTimeout(9000); // longer than any wait for the card
  expect(await page.evaluate(() => window.__uploads())).toEqual(["Sam_Rivera_Northwind.pdf"]);
  expect(await page.locator("[data-automation-id=file-upload-successful]").count()).toBe(1);
  // Never told the owner the résumé failed.
  expect(api.state.caught.filter((c) => c.kind === "resume_failed")).toEqual([]);
  await page.close();
});

test("a card that lists the file only after 6 s: still one upload, no extra drop", async () => {
  test.setTimeout(180000);
  const url = lab.url("/lab/apply-workday-steps.html?step=2&change&clear&late=6000");
  const page = await openRun(url);
  const res = await fillOnce("l1", url);
  expect(res.resume).toBe("attached");
  await page.waitForTimeout(9000);
  expect(await page.evaluate(() => window.__uploads())).toEqual(["Sam_Rivera_Northwind.pdf"]);
  await page.close();
});

test("a 'Resume/Cover Letter' box: the résumé and the run's cover letter, each once", async () => {
  test.setTimeout(240000);
  const url = lab.url("/lab/apply-workday-steps.html?step=2&change&clear&shared");
  const page = await openRun(url, { cover_letter_id: "cl-1" });
  const one = await fillOnce("s1", url);
  expect(one.resume).toBe("attached");
  expect(one.cover_letter).toBe("attached");
  expect(await page.evaluate(() => window.__uploads())).toEqual(["Sam_Rivera_Northwind.pdf", "Sam Rivera - Cover letter.pdf"]);
  // Filled again: still the two.
  const two = await fillOnce("s2", url);
  expect(two.resume).toBe("attached");
  expect(two.cover_letter).toBe("attached");
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__uploads())).toHaveLength(2);
  await page.close();
});

test("a 'Resume/Cover Letter' box with no letter for the job: the résumé only", async () => {
  test.setTimeout(180000);
  const url = lab.url("/lab/apply-workday-steps.html?step=2&change&clear&shared");
  const page = await openRun(url);
  const res = await fillOnce("n1", url);
  expect(res.resume).toBe("attached");
  expect(await page.evaluate(() => window.__uploads())).toEqual(["Sam_Rivera_Northwind.pdf"]);
  await page.close();
});

test("Workday Skills: only the site's own entries, other names and 'Windows 10/11' found, slow results waited for, the rest listed", async () => {
  test.setTimeout(180000);
  api.state.answers = [];
  api.state.taught = [];
  api.state.history = { work: [], education: [], certifications: [], websites: [], skills: ["Microsoft 365", "O365", "AD", "Windows 10/11", "Intune", "Cobol"] };
  api.state.bundleVersion++;
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.remove(["je_autofill"]);
    await chrome.storage.sync.set({ je_super: false }); // one press
  });
  const page = await ext.context.newPage();
  // A server-side search (results 1.8 s later) that picks a lone result by itself.
  await page.goto(lab.url("/lab/workday-sections.html?slowSkills=1800&autopick"));
  const res = await ext.autofill(page);
  expect(res.ok).toBe(true);
  const chips = page.locator('[data-automation-id="formField-skills"] [data-automation-id="selectedItem"]');
  // Never "Microsoft 365 Copilot for Sales" for "Microsoft 365".
  await expect(chips).toHaveText(["Office 365", "Active Directory", "Windows 10", "Windows 11", "Intune"]);
  expect(res.ms).toBeLessThan(60000);
  const tabId = await ext.tabIdOf(page);
  const s = await ext.bg({ type: "getFillSession", tabId });
  const need = Object.values(s.frames).flatMap((f) => (f.need_you || []).map((n) => n.label));
  expect(need).toContain("Skills not added: Microsoft 365, Cobol");
  await page.close();
});
