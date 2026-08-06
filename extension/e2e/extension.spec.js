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
