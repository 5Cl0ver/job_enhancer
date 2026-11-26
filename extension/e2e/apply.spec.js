// Apply with Claude (spec 022) in a real Chromium: once Claude has marked a
// page of the application done, Job Catcher takes photos of the long page
// screen by screen, locks final Submits on the application's site until the
// user's OK, and reports a Submit once allowed, but only from the
// application's own tab (another application on the same site never ends it).
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

  // The user's other application on the same site.
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

  // The user's OK. Their other application on the site goes through and
  // ends nothing; the application's own press is reported, once.
  api.state.applyRun = { ...api.state.applyRun, guard: false };
  await other.bringToFront();
  await other.waitForTimeout(3500);
  await other.click("#go");
  await expect.poll(() => other.textContent("#sent")).toBe("1");
  await other.waitForTimeout(500);
  expect(events("submit_pressed")).toHaveLength(0);

  await page.bringToFront();
  await page.waitForTimeout(3500); // the page's next tick hears it
  await page.click("#go");
  await expect.poll(() => page.textContent("#sent")).toBe("1");
  await expect.poll(() => events("submit_pressed").length).toBe(1);
  // The thank-you page: Job Catcher tells the app it really went (spec 023).
  await expect.poll(() => events("confirmation_seen").length, { timeout: 10000 }).toBe(1);
  expect(events("confirmation_seen")[0].body.words).toBe("Thank you for applying");

  // Show me the screen: one photo of the tab as it is, never scrolled.
  const before = await page.evaluate(() => Math.round(window.scrollY));
  api.state.photoTypes = [];
  api.state.applyRun = { ...api.state.applyRun, requests: [{ id: "k1", kind: "peek", url, page_n: 0 }] };
  await expect.poll(() => api.calls("/v1/apply/requests/k1/result").length, { timeout: 15000 }).toBe(1);
  api.state.applyRun = { ...api.state.applyRun, requests: [] };
  expect(api.calls("/v1/apply/requests/k1/photo")).toHaveLength(1);
  expect(api.state.photoTypes).toEqual(["image/jpeg"]);
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(before);
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

test("best judgment (spec 026): the run's résumé on a Workday-like page, photos from a tab behind, the live view", async () => {
  test.setTimeout(180000);
  const url = lab.url("/lab/apply-workday.html");
  const host = new URL(url).hostname;
  api.state.resumes = { "resume-run": { filename: "Wren_Tidewell.pdf", bytes: Buffer.from("%PDF-1.4\n% made for this job\n") } };
  api.state.applyRun = { run_id: "r1", status: "filling", guard: true, hosts: [host], resume_id: "resume-run", live: true, requests: [] };

  const page = await ext.context.newPage();
  await page.goto(url);
  // The user is on another tab: Claude's tab is behind it.
  const mine = await ext.context.newPage();
  await mine.goto(lab.url("/lab/apply-long.html?mine"));
  await mine.bringToFront();
  await mine.waitForTimeout(3500);

  // Fill: the run's own résumé goes into the hidden "Select files" box.
  api.state.applyRun = { ...api.state.applyRun, requests: [{ id: "f1", kind: "fill", url, page_n: 1 }] };
  // Job Catcher trusts the last "nothing open" for up to 60 s (the earlier tests).
  await expect.poll(() => api.calls("/v1/apply/requests/f1/result").length, { timeout: 90000 }).toBe(1);
  api.state.applyRun = { ...api.state.applyRun, requests: [] };
  const [{ body: filled }] = api.calls("/v1/apply/requests/f1/result");
  expect(filled.ok).toBe(true);
  expect(filled.resume).toBe("attached");
  expect(await page.textContent("#got")).toBe("Wren_Tidewell.pdf");
  expect(await page.inputValue("#fn")).toBe("Wren");

  // The live view: the page's boxes, Job Catcher's marked.
  await expect.poll(() => api.calls("/v1/apply/runs/r1/live").length, { timeout: 15000 }).toBeGreaterThan(0);
  const live = api.calls("/v1/apply/runs/r1/live").at(-1).body;
  expect(live.url).toBe(url);
  expect(live.boxes).toEqual(expect.arrayContaining([{ q: "First name", a: "Wren", by: "job_catcher" }]));

  // Photos: Claude's tab is shown for them, then the user's tab comes back.
  api.state.applyRun = { ...api.state.applyRun, requests: [{ id: "p1", kind: "photo", url, page_n: 1 }] };
  await expect.poll(() => api.calls("/v1/apply/requests/p1/result").length, { timeout: 30000 }).toBe(1);
  api.state.applyRun = { ...api.state.applyRun, requests: [] };
  expect(api.calls("/v1/apply/requests/p1/result")[0].body.ok).toBe(true);
  expect(api.calls("/v1/apply/requests/p1/photo").length).toBeGreaterThan(0);
  await expect.poll(() => mine.evaluate(() => document.visibilityState)).toBe("visible");

  // Nothing new on the page: nothing sent again.
  const sent = api.calls("/v1/apply/runs/r1/live").length;
  await mine.waitForTimeout(4000);
  expect(api.calls("/v1/apply/runs/r1/live").length).toBe(sent);
  await page.close();
  await mine.close();
});

test("a one-address Workday application (spec 029): only this step's boxes, the phone never in Extension, the résumé dropped beside its zone", async () => {
  test.setTimeout(240000);
  const url = lab.url("/lab/apply-workday-steps.html");
  const host = new URL(url).hostname;
  api.state.resumes = { "resume-run": { filename: "Wren_Tidewell.pdf", bytes: Buffer.from("%PDF-1.4\n% made for this job\n") } };
  api.state.applyRun = { run_id: "r1", status: "filling", guard: true, hosts: [host], resume_id: "resume-run", live: false, requests: [] };
  const page = await ext.context.newPage();
  await page.goto(url);
  await page.bringToFront();

  // Step 1, My Information: the phone in its box, never in Phone Extension.
  api.state.applyRun = { ...api.state.applyRun, requests: [{ id: "s1", kind: "fill", url, page_n: 1 }] };
  await expect.poll(() => api.calls("/v1/apply/requests/s1/result").length, { timeout: 90000 }).toBe(1);
  api.state.applyRun = { ...api.state.applyRun, requests: [] };
  const [{ body: one }] = api.calls("/v1/apply/requests/s1/result");
  expect(one.ok).toBe(true);
  expect(one.filled).toEqual(expect.arrayContaining(["First Name", "Phone Number"]));
  expect(one.filled).not.toContain("Phone Extension");
  expect(await page.inputValue("#phoneNumber--phoneNumber")).not.toBe("");
  expect(await page.inputValue("#phoneNumber--extension")).toBe("");
  expect(one.need).toContain("Prefix");

  // Step 2, My Experience, drawn in place at the same address.
  await page.click("#next");
  await expect(page.locator("#step-name")).toHaveText("My Experience");
  api.state.applyRun = { ...api.state.applyRun, requests: [{ id: "s2", kind: "fill", url, page_n: 2 }] };
  await expect.poll(() => api.calls("/v1/apply/requests/s2/result").length, { timeout: 60000 }).toBe(1);
  api.state.applyRun = { ...api.state.applyRun, requests: [] };
  const [{ body: two }] = api.calls("/v1/apply/requests/s2/result");
  for (const old of ["First Name", "Last Name", "Email", "Phone Number", "Phone Extension", "Prefix"]) {
    expect(two.filled).not.toContain(old);
    expect(two.need).not.toContain(old);
  }
  expect(two.resume).toBe("attached");
  // The zone only takes a dropped file, and it got one.
  await expect.poll(() => page.textContent("#got")).toBe("Wren_Tidewell.pdf");
  await page.close();
});
