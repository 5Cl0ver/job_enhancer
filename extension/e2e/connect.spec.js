import { readFileSync } from "node:fs";
// One-press "Connect to Job Enhancer" (spec 019) against the fake server:
// the panel starts, the app's /connect page gets the proof from THIS Job
// Catcher and approves, the panel is signed in with its own pass — and a page
// that isn't the app, or a different code, never gets the proof.
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
  ext = await launchExtension({ apiUrl: api.url, signedIn: false });
  api.state.extensionId = ext.extensionId;
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

test.beforeEach(async () => {
  api.reset();
  api.clearCalls();
  api.state.connect = null;
  api.state.connectSeconds = 300;
  api.state.connectAutoApprove = true;
  api.state.latest = null;
  api.state.hellos = [];
  await ext.worker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
});

async function openPanel() {
  const panel = await ext.context.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.setViewportSize({ width: 380, height: 760 });
  await panel.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html`);
  return { panel, errors };
}

test("Job Catcher's id is the pinned one, the same on every computer", () => {
  expect(ext.extensionId).toBe("jihebibpgbfpmponcpphjbgnppodffed");
});

test("connect with one press: approve in the app, the panel is signed in with its own pass", async () => {
  const { panel, errors } = await openPanel();
  await expect(panel.getByRole("heading", { name: "Sign in to Job Catcher" })).toBeVisible();
  const approval = ext.context.waitForEvent("page", { predicate: (p) => p.url().includes("/connect?code=") });
  await panel.getByRole("button", { name: "Connect to Job Enhancer" }).click();
  await expect(panel.getByLabel("Code K7QM-3XPD")).toBeVisible();

  const page = await approval;
  // The proof the page approved with is the one whose hash Job Catcher sent.
  await expect(page.locator("#out")).toHaveText("approved");

  await expect(panel.getByRole("navigation")).toBeVisible({ timeout: 10_000 });
  expect(api.state.connect.status).toBe("used"); // handed over once
  const stored = await ext.worker.evaluate(() => chrome.storage.local.get(["je_token", "je_refresh", "je_email"]));
  expect(stored.je_token).toMatch(/^jcx_/);
  expect(stored.je_refresh).toBeUndefined();
  expect(stored.je_email).toBe("wren@example.com");
  // Nothing secret left behind in session storage once connected.
  const session = await ext.worker.evaluate(() => chrome.storage.session.get("je_connect"));
  expect(session.je_connect).toBeUndefined();

  // It says which version it is.
  await expect.poll(() => api.state.hellos.length).toBeGreaterThan(0);
  const { version } = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  expect(api.state.hellos[0].version).toBe(version);

  // Signing out revokes the pass on the server first.
  await panel.getByRole("navigation").getByRole("button", { name: "Settings" }).click();
  await panel.getByRole("button", { name: "Sign out" }).click();
  await expect(panel.getByRole("heading", { name: "Sign in to Job Catcher" })).toBeVisible();
  const revoke = api.calls("/v1/extension/tokens/current");
  expect(revoke).toHaveLength(1);
  expect(revoke[0].method).toBe("DELETE");
  expect(errors).toEqual([]);
  await Promise.all([page.close(), panel.close()]);
});

test("only the app's page, asking for our own code, gets the proof", async () => {
  api.state.connectAutoApprove = false;
  const { panel } = await openPanel();
  const approval = ext.context.waitForEvent("page", { predicate: (p) => p.url().includes("/connect?code=") });
  await panel.getByRole("button", { name: "Connect to Job Enhancer" }).click();
  const page = await approval;
  await expect(page.locator("#out")).toHaveText("has-proof");

  // Another code (a link someone else's Job Catcher made): no proof.
  const other = await ext.context.newPage();
  await other.goto(`${api.url}/connect?code=ZZZZ-ZZZZ`);
  await expect(other.locator("#out")).toHaveText("no-proof");

  // Another site can't even ask.
  const site = await ext.context.newPage();
  await site.goto(lab.url("/lab/posting.html"));
  const reach = await site.evaluate(
    (id) =>
      new Promise((resolve) => {
        const rt = window.chrome && window.chrome.runtime;
        if (!rt || !rt.sendMessage) return resolve("unreachable");
        try {
          rt.sendMessage(id, { type: "connectProof", code: "K7QM-3XPD" }, (r) => resolve(r && r.proof ? "proof" : "nothing"));
        } catch {
          resolve("unreachable");
        }
      }),
    ext.extensionId,
  );
  expect(reach).not.toBe("proof");

  // Approving without the proof is refused by the server too.
  const refused = await other.evaluate(async (code) => {
    const r = await fetch("/v1/extension/connect/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, proof: "x".repeat(43) }),
    });
    return r.status;
  }, "K7QM-3XPD");
  expect(refused).toBe(404);
  await Promise.all([page.close(), other.close(), site.close(), panel.close()]);
});

test("cancel, and a Connect that times out", async () => {
  api.state.connectAutoApprove = false;
  const { panel } = await openPanel();
  await panel.getByRole("button", { name: "Connect to Job Enhancer" }).click();
  await expect(panel.getByTestId("connect-waiting")).toBeVisible();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByRole("button", { name: "Connect to Job Enhancer" })).toBeVisible();
  expect(api.state.connect.status).toBe("cancelled");

  api.state.connectSeconds = 2;
  await panel.getByRole("button", { name: "Connect to Job Enhancer" }).click();
  await expect(panel.getByText("That took too long. Try again.")).toBeVisible({ timeout: 10_000 });
  for (const p of ext.context.pages()) if (p.url().includes("/connect?code=")) await p.close();
  await panel.close();
});

test("an older Job Catcher shows Update available with how to update", async () => {
  api.state.latest = "9.9.9";
  await ext.seedSignedIn();
  const { panel } = await openPanel();
  await expect(panel.getByTestId("update-banner")).toContainText("Update available (9.9.9)");
  const opened = ext.context.waitForEvent("page");
  await panel.getByRole("button", { name: "How to update" }).click();
  const page = await opened;
  expect(page.url()).toBe(`${api.url}/job-catcher#update`);
  await Promise.all([page.close(), panel.close()]);
});

test("one poller: waiting for approval asks the server at most every 2 seconds", async () => {
  api.state.connectAutoApprove = false;
  const { panel } = await openPanel();
  await panel.getByRole("button", { name: "Connect to Job Enhancer" }).click();
  await expect(panel.getByTestId("connect-waiting")).toBeVisible();
  api.clearCalls();
  await panel.waitForTimeout(6000);
  const polls = api.calls("/v1/extension/connect/poll").length;
  expect(polls).toBeGreaterThanOrEqual(2);
  expect(polls).toBeLessThanOrEqual(4); // 6 s at one every 2 s, never doubled by the panel
  await panel.getByRole("button", { name: "Cancel" }).click();
  for (const p of ext.context.pages()) if (p.url().includes("/connect?code=")) await p.close();
  await panel.close();
});

test("sign-out that can't reach the server revokes the pass later", async () => {
  await ext.worker.evaluate(() =>
    chrome.storage.local.set({
      je_token: `jcx_${"q".repeat(43)}`,
      je_expires: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
      je_email: "wren@example.com",
    }),
  );
  api.override("DELETE /v1/extension/tokens/current", { status: 500, body: { detail: "down" } });
  const { panel } = await openPanel();
  await panel.getByRole("navigation").getByRole("button", { name: "Settings" }).click();
  await panel.getByRole("button", { name: "Sign out" }).click();
  await expect(panel.getByRole("heading", { name: "Sign in to Job Catcher" })).toBeVisible({ timeout: 30_000 });
  const pending = await ext.worker.evaluate(() => chrome.storage.local.get("je_pending_revoke"));
  expect(pending.je_pending_revoke).toBe(`jcx_${"q".repeat(43)}`);

  // The server is back: the next start (an update, a browser restart) finishes it.
  api.reset();
  api.clearCalls();
  await ext.reload();
  await expect.poll(() => api.calls("/v1/extension/tokens/current").length).toBeGreaterThan(0);
  await expect
    .poll(async () => (await ext.worker.evaluate(() => chrome.storage.local.get("je_pending_revoke"))).je_pending_revoke)
    .toBeUndefined();
  await panel.close();
});

test("a dead refresh token is forgotten instead of retried forever", async () => {
  await ext.worker.evaluate(() =>
    chrome.storage.local.set({
      je_token: "old-token",
      je_expires: Math.floor(Date.now() / 1000) - 60,
      je_refresh: "revoked-refresh",
      je_email: "wren@example.com",
    }),
  );
  api.override("POST /auth/v1/token", { status: 400, body: { error_description: "Invalid Refresh Token" } });
  const { panel } = await openPanel();
  await expect(panel.getByRole("heading", { name: "Sign in to Job Catcher" })).toBeVisible();
  const left = await ext.worker.evaluate(() => chrome.storage.local.get(["je_token", "je_refresh"]));
  expect(left).toEqual({});
  await panel.close();
});
