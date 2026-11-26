// Bugs & ideas from Job Catcher (spec 032) in a real Chromium, against the
// fake server: the owner's "Report a problem here" (the page without its
// query, the version, a picture of the visible page), nobody else sees it,
// and Job Catcher's own save failures are sent once, never "already saved".
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { ROOT, launchExtension } from "./support/launch.js";

let api;
let lab;
let ext;
const VERSION = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")).version;

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
  api.state.isOwner = false;
  api.state.bugs = [];
  api.state.bugShots = [];
  api.state.caught = [];
  // A fresh hello (it says who the owner is) and no remembered failures.
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.remove(["je_hello_at", "je_is_owner"]);
    await chrome.storage.session.remove("je_caught_sent");
  });
  await ext.seedSignedIn();
});

/**
 * The lab page in its own window, showing, and the panel in another window
 * beside it (as the real side panel is: the page stays the visible tab).
 */
async function pageAndPanel(path) {
  const tab = await ext.context.newPage();
  await tab.goto(lab.url(path));
  const tabId = await ext.tabIdOf(tab);
  const opened = ext.context.waitForEvent("page");
  await ext.worker.evaluate(
    (url) => chrome.windows.create({ url, width: 420, height: 800 }),
    `chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${tabId}`,
  );
  const panel = await opened;
  await panel.waitForLoadState();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  return { tab, tabId, panel, errors };
}

test("the owner reports a problem with a picture of the page", async () => {
  api.state.isOwner = true;
  const { tab, panel, errors } = await pageAndPanel("/lab/posting.html?ref=mail&token=abc123#apply");
  await expect(panel.getByRole("heading", { name: "Save this job" })).toBeVisible();

  await panel.getByRole("button", { name: "Report a problem here" }).click();
  const form = panel.getByRole("form", { name: "Report a problem" });
  await expect(form.getByRole("button", { name: "Send" })).toBeDisabled();
  await form.getByLabel("What happened?").fill("Résumé didn't attach\nThe drop zone stayed empty.");
  await form.getByLabel("Add a picture of this page").check();
  await form.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("Sent to Bugs & ideas, with a picture of the page.")).toBeVisible({ timeout: 15000 });

  expect(api.state.bugs).toHaveLength(1);
  const bug = api.state.bugs[0];
  expect(bug).toMatchObject({
    type: "bug",
    section: "job_catcher",
    title: "Résumé didn't attach",
    actual: "Résumé didn't attach\nThe drop zone stayed empty.",
    place: "localhost/lab/posting.html",
    source: "owner",
    context: { job_catcher: VERSION, device: "computer" },
  });
  expect(bug.context.browser).toBeTruthy();
  expect(JSON.stringify(bug)).not.toContain("token");
  expect(api.state.bugShots).toEqual([{ id: "bug-1", type: "image/jpeg", bytes: expect.any(Number) }]);
  expect(api.state.bugShots[0].bytes).toBeGreaterThan(0);
  const sent = api.calls("/v1/admin/bugs")[0];
  expect(sent.method).toBe("POST");

  // Again, without a picture: just the report.
  await panel.getByRole("button", { name: "Report a problem here" }).click();
  await form.getByLabel("What happened?").fill("Save button missing");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("Sent to Bugs & ideas.", { exact: true })).toBeVisible({ timeout: 15000 });
  expect(api.state.bugs).toHaveLength(2);
  expect(api.state.bugShots).toHaveLength(1);
  expect(errors).toEqual([]);
  await Promise.all([tab.close(), panel.close()]);
});

test("a report that can't be sent says why, and the panel carries on", async () => {
  api.state.isOwner = true;
  const { tab, panel } = await pageAndPanel("/lab/posting.html");
  await panel.getByRole("button", { name: "Report a problem here" }).click();
  api.override("/v1/admin/bugs", { status: 422, body: { detail: "Give it a title." } });
  await panel.getByLabel("What happened?").fill("Something odd");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Give it a title.");
  // The rest of the panel still works.
  await expect(panel.getByRole("heading", { name: "Save this job" })).toBeVisible();
  await Promise.all([tab.close(), panel.close()]);
});

test("nobody else sees the link, and the background refuses them too", async () => {
  const { tab, tabId, panel } = await pageAndPanel("/lab/posting.html");
  await expect(panel.getByRole("heading", { name: "Save this job" })).toBeVisible();
  await expect.poll(() => api.state.hellos.length).toBeGreaterThan(0);
  await panel.waitForTimeout(500);
  await expect(panel.getByRole("button", { name: "Report a problem here" })).toHaveCount(0);

  const res = await ext.bg({ type: "reportProblem", tabId, what: "Not mine to send", picture: true });
  expect(res).toEqual({ ok: false, error: "Only the app's owner can send reports from here." });
  expect(api.state.bugShots).toEqual([]);
  await Promise.all([tab.close(), panel.close()]);
});

test("Job Catcher sends its own save failure once, never an 'already saved'", async () => {
  const url = `${lab.url("/lab/posting.html")}?utm=mail&email=wren%40example.com`;
  const job = { title: "Help Desk Analyst", company: "Vellacor Robotics", location: "Remote", url };

  api.override("/v1/saved-jobs/manual", { status: 409, body: { detail: "Already saved" } });
  expect((await ext.bg({ type: "saveJob", job })).ok).toBe(false);
  api.override("/v1/saved-jobs/manual", { status: 500, body: { detail: "Internal Server Error" } });
  expect((await ext.bg({ type: "saveJob", job })).error).toBe("Internal Server Error");
  expect((await ext.bg({ type: "saveJob", job })).ok).toBe(false);

  await expect.poll(() => api.state.caught.length).toBe(1);
  expect(api.state.caught[0]).toEqual({
    section: "job_catcher",
    kind: "save_failed",
    place: "localhost/lab/posting.html",
    message: "Internal Server Error",
    context: { job_catcher: VERSION },
  });
  expect(JSON.stringify(api.state.caught)).not.toContain("wren");
});
