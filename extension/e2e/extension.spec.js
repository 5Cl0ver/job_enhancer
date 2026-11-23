// Integration tests: load a test copy of the *built* extension into a real
// Chromium (see support/launch.js) against the fake server (support/fake-api.js)
// and prove the pieces the unit tests can't — that the bundles load, that the
// MAIN-world bridge mirrors page data, that the side panel renders, and that
// Claude Scout copies job pages.
//
// MV3 extensions need a persistent context, launched headed (locally) or under
// xvfb (CI). See README → "Testing".
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { FIXTURES, launchExtension } from "./support/launch.js";

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
  api.state.scoutRun = { run_id: null, any_site: false };
});

test("MAIN-world bridge mirrors window._initialData onto <html data-je-embedded>", async () => {
  const page = await ext.context.newPage();
  const url = lab.url("/fixtures/indeed-initialdata.html");
  await page.goto(url);

  // Inject the bridge into the page's MAIN world (where window._initialData lives).
  await ext.worker.evaluate(async (pageUrl) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["dist/bridge.js"],
      world: "MAIN",
    });
  }, url);

  await page.waitForFunction(
    () => document.documentElement.hasAttribute("data-je-embedded"),
    { timeout: 4000 },
  );
  const attr = await page.getAttribute("html", "data-je-embedded");
  expect(attr).toContain("Senior Backend Engineer");
  await page.close();
});

test("side panel page renders the sign-in view without errors", async () => {
  await ext.worker.evaluate(() => chrome.storage.local.clear());
  const page = await ext.context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${ext.extensionId}/sidepanel.html`);

  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
  await ext.seedSignedIn();
});

test("Claude Scout: a job page opened during a run is sent word for word", async () => {
  // The real LinkedIn URL (so the content script runs), served from the fixture
  // with a longer description, like a full posting.
  const extra = "Own the developer platform end to end and mentor two engineers. ".repeat(3);
  const html = readFileSync(join(FIXTURES, "linkedin-jobview.html"), "utf8").replace(
    "5+ years with cloud infrastructure and Kubernetes.</p>",
    `5+ years with cloud infrastructure and Kubernetes.</p><p class="_18f99264">${extra}</p>`,
  );
  const jobUrl = "https://www.linkedin.com/jobs/view/4012345678/";
  await ext.context.route(jobUrl, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
  api.state.scoutRun = { run_id: "run-1", any_site: false };

  const page = await ext.context.newPage();
  await page.goto(jobUrl);
  await expect.poll(() => api.calls("/v1/scout/captures").length, { timeout: 8000 }).toBe(1);
  const [{ body: sent }] = api.calls("/v1/scout/captures");
  expect(sent.url).toBe(jobUrl);
  expect(sent.title).toBe("Senior Platform Engineer");
  expect(sent.company).toBe("Initech, Inc.");
  expect(sent.description).toContain("Employment Type: Full-Time");
  expect(sent.description).toContain(extra.trim());

  // Sent once: the page keeps polling, but it's done with this job.
  await page.waitForTimeout(4500);
  expect(api.calls("/v1/scout/captures").length).toBe(1);
  await page.close();
});

test("Claude Scout: a company careers page that draws itself late is still copied", async () => {
  // A Workday-style page (spec 012): nothing but a loading shell at first, the
  // posting drawn 3 seconds later, with no title tags or JobPosting data.
  const drawn = readFileSync(join(FIXTURES, "workday-posting.html"), "utf8");
  const body = drawn.slice(drawn.indexOf("<body>") + 6, drawn.indexOf("</body>"));
  const html =
    '<!doctype html><html><head><title>Workday</title></head><body><div id="shell">Loading…</div>' +
    `<template id="later">${body}</template>` +
    "<script>setTimeout(() => { document.body.replaceChildren(" +
    "document.getElementById('later').content.cloneNode(true)); }, 3000);</script>" +
    "</body></html>";
  const jobUrl =
    "https://vellacor.wd1.myworkdayjobs.com/en-US/External/job/Springfield-IL/IT-Systems-Administrator_R-1042";
  await ext.context.route(jobUrl, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
  // A Local companies run Claude has started: pages on any site are copied.
  api.state.scoutRun = { run_id: "run-2", any_site: true };

  const page = await ext.context.newPage();
  await page.goto(jobUrl);
  await expect.poll(() => api.calls("/v1/scout/captures").length, { timeout: 15000 }).toBe(1);
  const [{ body: sent }] = api.calls("/v1/scout/captures");
  expect(sent.url).toBe(jobUrl);
  expect(sent.title).toBe("IT Systems Administrator");
  expect(sent.company).toBe("Vellacor");
  expect(sent.description).toContain("Automate onboarding with PowerShell");
  await page.close();
});
