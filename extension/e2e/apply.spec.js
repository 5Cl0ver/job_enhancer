// Apply with Claude (spec 022) in a real Chromium: once Claude has marked a
// page of the application done, Job Catcher takes photos of the long page
// screen by screen, locks that tab's final Submit until the user's OK, and
// reports a Submit once allowed. Another tab on the same site is never locked.
// Against the fake server (support/fake-api.js) and the lab's invented page.
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
  api.state.applyRun = { run_id: null };
  api.state.photoTypes = [];
});

const events = (kind) => api.calls("/v1/apply/runs/r1/event").filter((c) => c.body?.kind === kind);

test("an open application: photos cover the page, Submit waits for the OK, then goes through", async () => {
  const url = lab.url("/lab/apply-long.html");
  const host = new URL(url).hostname;
  api.state.applyRun = { run_id: "r1", status: "filling", guard: true, hosts: [host], requests: [] };

  // The user's other tab on the same site: never locked.
  const other = await ext.context.newPage();
  await other.goto(`${url}?another-job`);

  const page = await ext.context.newPage();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(url);
  await page.bringToFront();
  await page.waitForTimeout(3500); // the background hears the run

  // Claude says the page is done: Job Catcher photographs it, top to bottom.
  await page.evaluate(() => window.scrollTo(0, 300));
  api.state.applyRun = { ...api.state.applyRun, requests: [{ id: "q1", kind: "photo", url, page_n: 1 }] };
  await expect.poll(() => api.calls("/v1/apply/requests/q1/result").length, { timeout: 30000 }).toBe(1);
  api.state.applyRun = { ...api.state.applyRun, status: "review", requests: [] };
  expect(api.calls("/v1/apply/requests/q1/claim")).toHaveLength(1);
  const shots = api.calls("/v1/apply/requests/q1/photo");
  expect(shots.length).toBeGreaterThanOrEqual(3); // a 2,500 px page in a 700 px window
  expect(shots.length).toBeLessThanOrEqual(8);
  expect(api.state.photoTypes.every((t) => t === "image/jpeg")).toBe(true);
  const [{ body: result }] = api.calls("/v1/apply/requests/q1/result");
  expect(result.ok).toBe(true);
  expect(result.answers).toEqual(
    expect.arrayContaining([
      { q: "First name", a: "Wren" },
      { q: "Why do you want to work at Tidewell Labs?", a: "I like networks." },
    ]),
  );
  // The scroll is put back where it was.
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(300);

  // Locked: the page never hears the press, and the run log does.
  await expect.poll(async () => {
    await page.click("#go");
    return events("blocked_submit").length;
  }, { timeout: 15000 }).toBeGreaterThan(0);
  expect(await page.textContent("#sent")).toBe("0");

  // The other tab on the same site goes through, and reports nothing.
  await other.bringToFront();
  await other.waitForTimeout(3500);
  await other.click("#go");
  await expect.poll(() => other.textContent("#sent")).toBe("1");

  // The user's OK: the press goes through and is reported once.
  await page.bringToFront();
  api.state.applyRun = { ...api.state.applyRun, guard: false };
  await page.waitForTimeout(3500); // the page's next tick hears it
  await page.click("#go");
  await expect.poll(() => page.textContent("#sent")).toBe("1");
  await expect.poll(() => events("submit_pressed").length).toBe(1);
  await page.close();
  await other.close();
});

test("no application open: Submit is never touched and nothing is reported", async () => {
  const page = await ext.context.newPage();
  await page.goto(lab.url("/lab/apply-long.html"));
  await page.waitForTimeout(3500);
  await page.click("#go");
  await expect.poll(() => page.textContent("#sent")).toBe("1");
  expect(api.calls("/v1/apply/runs/r1/event")).toHaveLength(0);
  await page.close();
});
