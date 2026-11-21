// Integration tests: load the *built* extension into a real Chromium and prove
// the pieces the unit tests can't — that the bundles load, that the MAIN-world
// bridge mirrors page data, and that the side panel renders without a JS error.
//
// MV3 extensions need a persistent context, launched headed (locally) or under
// xvfb (CI). See README → "Testing".
import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // extension/
const fixtures = join(root, "test", "fixtures");

let server;
let baseUrl;
let context;
let worker;
let extensionId;

test.beforeAll(async () => {
  // background.js does importScripts("config.js"); make sure one exists in CI.
  const cfg = join(root, "config.js");
  if (!existsSync(cfg)) copyFileSync(join(root, "config.example.js"), cfg);

  // Serve fixtures over http so host_permissions (http://*/*) allow scripting.
  server = createServer((req, res) => {
    const name = (req.url || "/").split("?")[0].replace(/^\//, "") || "index.html";
    const file = join(fixtures, name);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;

  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });

  worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((r) => server?.close(r));
});

test("MAIN-world bridge mirrors window._initialData onto <html data-je-embedded>", async () => {
  const page = await context.newPage();
  const url = `${baseUrl}/indeed-initialdata.html`;
  await page.goto(url);

  // Inject the bridge into the page's MAIN world (where window._initialData lives).
  await worker.evaluate(async (pageUrl) => {
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
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

test("Claude Scout: a job page opened during a run is sent word for word", async () => {
  // The real LinkedIn URL (so the content script runs), served from the fixture
  // with a longer description, like a full posting.
  const extra = "Own the developer platform end to end and mentor two engineers. ".repeat(3);
  const html = readFileSync(join(fixtures, "linkedin-jobview.html"), "utf8").replace(
    "5+ years with cloud infrastructure and Kubernetes.</p>",
    `5+ years with cloud infrastructure and Kubernetes.</p><p class="_18f99264">${extra}</p>`,
  );
  const jobUrl = "https://www.linkedin.com/jobs/view/4012345678/";
  await context.route(jobUrl, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );

  // Signed in, a Scout run open, and the app's answers stubbed in the worker.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      je_token: "test-token",
      je_expires: Math.floor(Date.now() / 1000) + 3600,
    });
    globalThis.__sent = [];
    globalThis.fetch = async (url, opts = {}) => {
      const path = new URL(url).pathname;
      if (path === "/v1/scout/captures") globalThis.__sent.push(JSON.parse(opts.body));
      const body =
        path === "/v1/scout/runs/active"
          ? { run_id: "run-1" }
          : path === "/v1/scout/captures"
            ? { stored: true }
            : { saved: false };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  });

  const page = await context.newPage();
  await page.goto(jobUrl);
  await expect
    .poll(() => worker.evaluate(() => globalThis.__sent.length), { timeout: 8000 })
    .toBe(1);
  const [sent] = await worker.evaluate(() => globalThis.__sent);
  expect(sent.url).toBe(jobUrl);
  expect(sent.title).toBe("Senior Platform Engineer");
  expect(sent.company).toBe("Initech, Inc.");
  expect(sent.description).toContain("Employment Type: Full-Time");
  expect(sent.description).toContain(extra.trim());

  // Sent once: the page keeps polling, but it's done with this job.
  await page.waitForTimeout(4500);
  expect(await worker.evaluate(() => globalThis.__sent.length)).toBe(1);
  await page.close();
});

test("Claude Scout: a company careers page that draws itself late is still copied", async () => {
  // A Workday-style page (spec 012): nothing but a loading shell at first, the
  // posting drawn 3 seconds later, with no title tags or JobPosting data.
  const drawn = readFileSync(join(fixtures, "workday-posting.html"), "utf8");
  const body = drawn.slice(drawn.indexOf("<body>") + 6, drawn.indexOf("</body>"));
  const html =
    '<!doctype html><html><head><title>Workday</title></head><body><div id="shell">Loading…</div>' +
    `<template id="later">${body}</template>` +
    "<script>setTimeout(() => { document.body.replaceChildren(" +
    "document.getElementById('later').content.cloneNode(true)); }, 3000);</script>" +
    "</body></html>";
  const jobUrl =
    "https://vellacor.wd1.myworkdayjobs.com/en-US/External/job/Springfield-IL/IT-Systems-Administrator_R-1042";
  await context.route(jobUrl, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );

  // A Local companies run Claude has started: pages on any site are copied.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      je_token: "test-token",
      je_expires: Math.floor(Date.now() / 1000) + 3600,
    });
    globalThis.__sent = [];
    globalThis.fetch = async (url, opts = {}) => {
      const path = new URL(url).pathname;
      if (path === "/v1/scout/captures") globalThis.__sent.push(JSON.parse(opts.body));
      const body =
        path === "/v1/scout/runs/active"
          ? { run_id: "run-2", any_site: true }
          : path === "/v1/scout/captures"
            ? { stored: true }
            : { saved: false };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  });

  const page = await context.newPage();
  await page.goto(jobUrl);
  await expect
    .poll(() => worker.evaluate(() => globalThis.__sent.length), { timeout: 15000 })
    .toBe(1);
  const [sent] = await worker.evaluate(() => globalThis.__sent);
  expect(sent.url).toBe(jobUrl);
  expect(sent.title).toBe("IT Systems Administrator");
  expect(sent.company).toBe("Vellacor");
  expect(sent.description).toContain("Automate onboarding with PowerShell");
  await page.close();
});
