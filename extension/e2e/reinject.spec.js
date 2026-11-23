// Updates never strand open tabs (spec 015, Story 6). Before this, an update
// left every open tab with an orphaned copy of the content scripts until the
// user reloaded the extension AND refreshed each tab — which is why a Claude
// Scout run copied none of its jobs.
//
// This is a REAL upgrade: the extension exactly as users have it today (0.27,
// built from git) runs in open tabs, then the current build replaces it and
// the extension is reloaded, the way an update happens.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { FIXTURES, buildLegacy, launchExtension } from "./support/launch.js";

// The last commit with Job Catcher 0.27 — what's installed before this change.
const BEFORE = "0689b3e";

const JOB_URL = "https://www.linkedin.com/jobs/view/4099990001/";
const MYJOBS_URL = "https://myjobs.indeed.com/applied";
const LEGACY = "#je-save-btn, #je-autofill-btn, #je-sync-btn, #je-remember-btn";

let api;
let lab;
let ext;

test.beforeAll(async () => {
  test.setTimeout(120_000); // the first run builds 0.27 from git
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url, from: buildLegacy(BEFORE) });
  const extra = "Run the help desk queue and automate laptop setup for new staff. ".repeat(3);
  const job = readFileSync(join(FIXTURES, "linkedin-jobview.html"), "utf8").replace(
    "5+ years with cloud infrastructure and Kubernetes.</p>",
    `5+ years with cloud infrastructure and Kubernetes.</p><p class="_18f99264">${extra}</p>`,
  );
  await ext.context.route(JOB_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: job }),
  );
  const myJobs = readFileSync(join(FIXTURES, "indeed-myjobs.html"), "utf8");
  await ext.context.route(MYJOBS_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: myJobs }),
  );
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

/** Make the page change every 300ms (wakes every copy's observers). */
async function keepRedrawing(page) {
  await page.evaluate(() => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    setInterval(() => (el.textContent = String(Date.now())), 300);
  });
}

test("an update takes over open tabs: old buttons gone for good, Scout still copies", async () => {
  test.setTimeout(90_000);
  // Today's extension, with three kinds of page open.
  const jobTab = await ext.context.newPage();
  await jobTab.goto(JOB_URL);
  await expect(jobTab.locator("#je-save-btn")).toHaveCount(1, { timeout: 8000 });
  const formTab = await ext.context.newPage();
  await formTab.goto(lab.url("/lab/classic.html"));
  await expect(formTab.locator("#je-autofill-btn")).toHaveCount(1, { timeout: 8000 });
  // (0.27's own My jobs button never drew: it read its id before defining it.)
  const myJobsTab = await ext.context.newPage();
  await myJobsTab.goto(MYJOBS_URL);
  for (const p of [jobTab, myJobsTab]) await keepRedrawing(p);

  // The update. A Scout run starts after it.
  api.state.scoutRun = { run_id: "run-after-update", any_site: false };
  const updatedAt = Date.now();
  await ext.upgrade();

  // The LinkedIn tab is copied for Scout with no refresh.
  await expect
    .poll(() => api.calls("/v1/scout/captures").filter((c) => c.at > updatedAt).length, {
      timeout: 20000,
    })
    .toBeGreaterThan(0);

  // Long after the old copies' last redraw: only the new, working buttons.
  await jobTab.waitForTimeout(7000);
  for (const [tab, current] of [
    [jobTab, "#jec-save"],
    [formTab, "#jec-autofill"],
    [myJobsTab, "#jec-sync"],
  ]) {
    await expect(tab.locator(`:is(${LEGACY}):visible`)).toHaveCount(0);
    await expect(tab.locator(`${current}:visible`)).toHaveCount(1);
    await expect(tab.locator(current)).not.toContainText(/refresh/i);
  }

  // The new autofill button works (a fill, not "↻ Refresh page").
  await formTab.locator("#jec-autofill").click();
  await expect(formTab.locator("#first")).toHaveValue("Wren", { timeout: 10000 });
});
