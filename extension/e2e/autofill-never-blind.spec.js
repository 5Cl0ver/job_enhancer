// Autofill that never goes blind (spec 017): the real Paycom failure of
// 0.32.0 — a MUI v4 pop-up under aria-hidden, where the scanner saw ZERO
// fields — rebuilt in the lab; plus "Read the page again", the copied report
// (never values) and the trouble actions on every failure. Real Chromium, the
// lab's invented pages, the fake server. Invented applicant only.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { ROOT, launchExtension } from "./support/launch.js";

const PAYCOM = "https://www.paycomonline.net/v4/ats/web.php/portal/0000NVF/jobs/ViewJobDetails?job=61770";

let api;
let lab;
let ext;

test.beforeAll(async () => {
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url });
  const html = readFileSync(join(ROOT, "test", "lab", "paycom-modal.html"), "utf8");
  await ext.context.route(PAYCOM, (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

test.beforeEach(() => {
  api.reset();
  api.clearCalls();
  api.state.aiAnswers = {};
});

async function panelFor(page) {
  const tabId = await ext.tabIdOf(page);
  const panel = await ext.context.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${tabId}`);
  return panel;
}
const status = (panel) => panel.getByTestId("fill-status");

test("the Paycom pop-up under aria-hidden: name, email and phone fill; consent is left for you", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAYCOM);
  await page.locator("#apply").click();
  await expect(page.locator("[role=dialog]")).toBeVisible();
  const panel = await panelFor(page);
  await expect(status(panel)).toHaveText(/Form found/, { timeout: 5000 });
  await panel.getByRole("button", { name: "Autofill this page" }).click();
  await expect(status(panel)).toHaveText(/Done/, { timeout: 15000 });
  expect(await page.evaluate(() => window.__formData())).toEqual({
    legalFirstName: "Wren",
    legalLastName: "Calloway",
    emailAddress: PERSON.email,
    confirmEmail: PERSON.email,
    primaryPhone: PERSON.profile.phone,
    smsConsent: "", // never
    privacyAck: false, // never
  });
  // Both choices are listed for the user (they were seen, not missed).
  await expect(panel.getByText(/Do you consent to receiving text/).first()).toBeVisible();
  await expect(panel.getByText(/read and understood the Privacy Policy/).first()).toBeVisible();

  // What Job Catcher saw: every box, in the pop-up, with decisions — and
  // none of the person's answers.
  const tabId = await ext.tabIdOf(page);
  const { report } = await ext.bg({ type: "scanReport", tabId });
  const frame = report.frames.find((f) => f.top);
  expect(frame.kept).toBe(7);
  expect(frame.fields.map((f) => f.label)).toContain("Legal First Name");
  expect(frame.fields.every((f) => f.inModal)).toBe(true);
  const text = JSON.stringify(report);
  for (const secret of ["Wren", "Calloway", PERSON.email, PERSON.profile.phone]) expect(text).not.toContain(secret);
  await Promise.all([page.close(), panel.close()]);
});

test("a form the page writes into a blank frame is found and filled", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/blank-frame.html"));
  const res = await ext.autofill(page);
  expect(res.ok).toBe(true);
  const frame = page.frameLocator("#apply-frame");
  await expect(frame.locator("#fn")).toHaveValue("Wren");
  await expect(frame.locator("#em")).toHaveValue(PERSON.email);
  await expect(frame.locator("#ph")).toHaveValue(PERSON.profile.phone);
  await page.close();
});

test("never stuck: no form → Read the page again and Copy what Job Catcher saw", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/noise.html"));
  const panel = await panelFor(page);
  await expect(panel.getByText(/No form on this page yet/)).toBeVisible({ timeout: 5000 });
  const trouble = panel.getByTestId("trouble");
  await trouble.getByRole("button", { name: "Read the page again" }).click();
  await expect(trouble.getByText(/Read again: /)).toBeVisible({ timeout: 5000 });
  await trouble.getByRole("button", { name: "Copy what Job Catcher saw" }).click();
  await expect(trouble.getByText(/never your answers|What Job Catcher saw/).first()).toBeVisible();
  // The report says why the sign-in box was left out.
  const { report } = await ext.bg({ type: "scanReport", tabId: await ext.tabIdOf(page) });
  expect(report.host).toBe("localhost");
  expect(report.frames[0].dropped.password).toBe(1);
  await Promise.all([page.close(), panel.close()]);
});

test("a page whose reader was lost (an orphaned copy) is read again and filled by one press", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/classic.html"));
  await expect.poll(async () => (await ext.fillState(page))?.form, { timeout: 8000 }).toBe(true);
  // Lose the reader: the copy in the page stops answering.
  const tabId = await ext.tabIdOf(page);
  await ext.worker.evaluate(
    (id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => (globalThis.__jecAutofill = undefined) }),
    tabId,
  );
  await page.evaluate(() => document.documentElement.setAttribute("data-je-autofill", "gone")); // its claim lost
  const res = await ext.bg({ type: "pressAutofill", tabId });
  expect(res.ok).toBe(true);
  await expect(page.locator("#first")).toHaveValue("Wren");
  await page.close();
});

test("spam traps only bots fill stay empty; the real boxes fill", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/honeypot.html"));
  const res = await ext.autofill(page);
  expect(res.ok).toBe(true);
  await expect(page.locator("#fn")).toHaveValue("Wren");
  await expect(page.locator("#em")).toHaveValue(PERSON.email);
  for (const trap of ["#b1", "#website", "#url", "#speck"]) await expect(page.locator(trap)).toHaveValue("");
  await page.close();
});
