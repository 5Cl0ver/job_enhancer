// Updates never strand open tabs (spec 015, Story 6). Before this, an update
// left every open tab with an orphaned copy of the content scripts until the
// user reloaded the extension AND refreshed each tab — which is why a Claude
// Scout run copied none of its jobs.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi } from "./support/fake-api.js";
import { FIXTURES, launchExtension } from "./support/launch.js";

let api;
let ext;

const JOB_URL = "https://www.linkedin.com/jobs/view/4099990001/";

test.beforeAll(async () => {
  api = await startFakeApi();
  ext = await launchExtension({ apiUrl: api.url });
  const extra = "Run the help desk queue and automate laptop setup for new staff. ".repeat(3);
  const html = readFileSync(join(FIXTURES, "linkedin-jobview.html"), "utf8").replace(
    "5+ years with cloud infrastructure and Kubernetes.</p>",
    `5+ years with cloud infrastructure and Kubernetes.</p><p class="_18f99264">${extra}</p>`,
  );
  await ext.context.route(JOB_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
});

test.afterAll(async () => {
  await ext?.close();
  await api?.close();
});

test("after an update, a tab that was already open is copied by a Scout run without a refresh", async () => {
  const page = await ext.context.newPage();
  await page.goto(JOB_URL);
  await expect(page.locator("[data-je-save]")).toHaveCount(1, { timeout: 8000 });

  // The extension updates while the tab stays open; a run starts after.
  api.state.scoutRun = { run_id: "run-after-update", any_site: false };
  const updatedAt = Date.now();
  await ext.reload();
  await ext.seedSignedIn();

  await expect
    .poll(() => api.calls("/v1/scout/captures").filter((c) => c.at > updatedAt).length, {
      timeout: 20000,
    })
    .toBeGreaterThan(0);

  // One working Save button — the stranded copy's dead "Refresh page" button
  // never takes it over.
  await page.waitForTimeout(3000);
  await expect(page.locator("[data-je-save]")).toHaveCount(1);
  await expect(page.locator("[data-je-save]")).not.toContainText(/refresh/i);
  await page.close();
});
