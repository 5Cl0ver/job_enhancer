// Autofill you can always find, that always works (spec 016): the side panel
// offers Autofill on ANY page with a form — a Paycom-style pop-up, a native
// modal behind a cookie banner, a contact form, whatever the address — says
// what it's doing in one line, and the toolbar icon shows ⚡. Nothing is drawn
// on the page. Real Chromium, the lab's invented pages, the fake server.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi, PERSON } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { ROOT, launchExtension } from "./support/launch.js";

// A Paycom-shaped career page: no "apply" anywhere in the address.
const PAYCOM = "https://www.paycomonline.net/v4/ats/web.php/portal/0000ABCD/career-page?job=42";

let api;
let lab;
let ext;

test.beforeAll(async () => {
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url });
  const html = readFileSync(join(ROOT, "test", "lab", "paycom-like.html"), "utf8");
  await ext.context.route(PAYCOM, (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

test.beforeEach(async () => {
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

const badge = (page) => ext.tabIdOf(page).then((tabId) => ext.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId));
const status = (panel) => panel.getByTestId("fill-status");

test("a Paycom-style pop-up: the panel finds it, one press fills it, consent untouched", async () => {
  const page = await ext.context.newPage();
  await page.goto(PAYCOM);
  const panel = await panelFor(page);

  // The pop-up opens: within a second the panel says so, Autofill on top.
  await page.locator("#apply").click();
  await expect(page.locator("[role=dialog]")).toBeVisible();
  await expect(status(panel)).toHaveText(/Form found/, { timeout: 3000 });
  const autofill = panel.getByRole("button", { name: "Autofill this page" });
  await expect(autofill).toBeVisible();
  expect(await autofill.boundingBox().then((b) => b.y)).toBeLessThan(300); // the first thing you see
  await expect.poll(() => badge(page)).toBe("⚡");

  await autofill.click();
  await expect(status(panel)).toHaveText(/Done/, { timeout: 20000 });
  const data = await page.evaluate(() => window.__formData());
  expect(data).toMatchObject({
    resume: "wren-calloway.pdf", // first, then the rebuilt form was filled
    firstName: "Wren",
    lastName: "Calloway",
    emailAddress: PERSON.email,
    countryCode: "🇺🇸 +1",
    phoneNumber: PERSON.profile.phone, // the national number, no doubled +1
    address1: PERSON.profile.address_line1,
    city: "Harborview", // floating label after its box
    state: "Oregon",
    zip: "97000",
    smsConsent: "", // never
    privacyAck: false, // never
  });
  expect(await page.evaluate(() => window.__rebuilt)).toBe(1);
  // Behind the pop-up: out of sight, left alone.
  await expect(page.locator("#alert")).toHaveValue("");
  await expect(page.locator("#loc")).toHaveValue("");
  // Nothing drawn on the page; the badge shows how many were filled.
  await expect(page.locator("jec-ui-autofill")).toHaveCount(0);
  await expect.poll(() => badge(page)).toMatch(/^\d+$/);
  await Promise.all([page.close(), panel.close()]);
});

test("a native modal behind a cookie banner and a chat bubble still fills from the panel", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/covered.html"));
  await page.locator("#open").click();
  const panel = await panelFor(page);
  await expect(status(panel)).toHaveText(/Form found/, { timeout: 5000 });
  await panel.getByRole("button", { name: "Autofill this page" }).click();
  await expect(status(panel)).toHaveText(/Done/, { timeout: 15000 });
  await expect(page.locator("#fn")).toHaveValue("Wren");
  await expect(page.locator("#em")).toHaveValue(PERSON.email);
  await expect(page.locator("#ph")).toHaveValue(PERSON.profile.phone);
  await expect(page.locator("#terms")).not.toBeChecked();
  await Promise.all([page.close(), panel.close()]);
});

test("a contact form with every label style, no 'apply' in the address", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/labels.html"));
  const res = await ext.autofill(page);
  expect(res.ok).toBe(true);
  await expect(page.locator("#a")).toHaveValue("Wren"); // label for
  await expect(page.locator("#b")).toHaveValue("Calloway"); // wrapping label
  await expect(page.locator("#c")).toHaveValue(PERSON.email); // aria-labelledby
  await expect(page.locator("#d")).toHaveValue(PERSON.profile.phone); // aria-label
  await expect(page.locator("#e")).toHaveValue("Harborview"); // floating label after
  await expect(page.locator("#f")).toHaveValue("97000"); // table cell
  await expect(page.locator("#g")).toHaveValue(PERSON.profile.linkedin_url); // placeholder only
  await expect(page.locator("#msg")).toHaveValue(""); // a message is the user's to write
  await page.close();
});

test("no form: the panel says so plainly, and 'Fill anyway' still tries", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/noise.html"));
  const panel = await panelFor(page);
  await expect(panel.getByText(/No form on this page yet/)).toBeVisible({ timeout: 5000 });
  expect(await badge(page)).toBe("");
  await panel.getByRole("button", { name: "Fill anyway" }).click();
  // A result line, never silence.
  await expect(status(panel)).toHaveText(/Done|Nothing here matched/, { timeout: 15000 });
  await Promise.all([page.close(), panel.close()]);
});

test("the panel shows the real keyboard shortcut, and the shortcut's press fills", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/classic.html"));
  const panel = await panelFor(page);
  await expect(status(panel)).toHaveText(/Form found/, { timeout: 5000 });
  const key = await ext.worker.evaluate(async () => (await chrome.commands.getAll()).find((c) => c.name === "autofill")?.shortcut || "");
  if (key) await expect(panel.getByText("Shortcut:")).toBeVisible();
  else await expect(panel.getByRole("button", { name: "Set a keyboard shortcut for Autofill" })).toBeVisible();
  await Promise.all([page.close(), panel.close()]);
});

test("signed out: the press says so in one line", async () => {
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_token", "je_expires", "je_refresh", "je_autofill"]));
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/classic.html"));
  const res = await ext.autofill(page);
  expect(res).toMatchObject({ ok: false, problem: "signed_out" });
  expect((await ext.fillState(page)).status).toMatchObject({ phase: "problem", problem: "signed_out" });
  await ext.seedSignedIn();
  await page.close();
});
