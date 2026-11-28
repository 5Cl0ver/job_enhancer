// "Applying for <job>?" (spec 040), in real Chromium: only the user's own
// press on an Apply in a saved job's page (never a frame in it, never a
// page script's click) makes the side panel ask on the next page; only Yes
// binds the tab to the job and teaches it the company's link. Invented data.
import { test, expect } from "@playwright/test";
import { startFakeApi } from "./support/fake-api.js";
import { launchExtension } from "./support/launch.js";

let api;
let ext;

const LI_A = "https://www.linkedin.com/jobs/view/4100000001/";
const REDIR = "https://www.linkedin.com/redir/redirect?url=x";
const WD_A = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234";
const AD_LAND = "https://www.uni-online.example/careers/apply-now?id=12345";
const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const PAGES = {
  [LI_A]: html(
    "IT Analyst | Acme | LinkedIn",
    `<h1>IT Analyst</h1><p>Acme</p>
     <button id="apply" aria-label="Apply to IT Analyst on company website" onclick="window.open('${REDIR}')">Apply</button>
     <a id="synth" href="${WD_A}">go</a>
     <iframe id="ad" src="https://ads.adnet.example/ad.html" width="300" height="100"></iframe>`,
  ),
  [REDIR]: html("redirect", `<script>location.replace(${JSON.stringify(WD_A)})</script>`),
  "https://ads.adnet.example/ad.html": html("ad", `<a id="adlink" href="${AD_LAND}" target="_blank">Apply now</a>`),
  [AD_LAND]: html("Enroll", `<form><input name="first_name" autocomplete="given-name"></form>`),
  // Pages that don't name the job (a title and company match would link it by themselves).
  [WD_A]: html("Workday", `<form><input name="first" autocomplete="given-name"></form>`),
  [`${WD_A}/apply`]: html("Workday", `<form><input name="first" autocomplete="given-name"></form>`),
};
const JOB = { id: "A", job_listing_id: "L1", title: "IT Analyst", company: "Acme", location: "", url: LI_A, applied_at: null, resume_id: null, cover_letter_id: null, company_url: null };

test.beforeAll(async () => {
  api = await startFakeApi();
  ext = await launchExtension({ apiUrl: api.url });
  await ext.context.route(/^https:\/\/(www\.linkedin\.com|acme\.wd5\.myworkdayjobs\.com|ads\.adnet\.example|www\.uni-online\.example)\//, (route) => {
    const u = route.request().url();
    route.fulfill({ status: 200, contentType: "text/html", body: PAGES[u] || html("x", `<p>${u}</p>`) });
  });
});

test.afterAll(async () => {
  await ext?.close();
  await api?.close();
});

test.beforeEach(async () => {
  api.reset();
  api.clearCalls();
  api.state.jobs = [JOB];
  api.state.jobsVersion++;
  await ext.seedSignedIn();
  await ext.worker.evaluate(async (jobs) => {
    await chrome.storage.session.set({ je_tab_press: {}, je_tab_job: {}, je_new_tabs: {} });
    await chrome.storage.local.set({ je_saved_cache: { version: "seed", jobs, at: Date.now() } });
  }, [JOB]);
});

const tabIdOf = (url) => ext.worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);

async function panelBeside(url) {
  const tabId = await tabIdOf(url);
  const panel = await ext.context.newPage();
  await panel.setViewportSize({ width: 380, height: 760 });
  await panel.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${tabId}`);
  return { panel, tabId };
}

const question = (panel) => panel.getByRole("group", { name: /applying for/i });

test("the board's Apply, then Yes: the tab is bound to the job, its link is learned, every step keeps it", async () => {
  const page = await ext.context.newPage();
  await page.goto(LI_A);
  await page.waitForTimeout(800); // Job Catcher's page script is in
  const [np] = await Promise.all([ext.context.waitForEvent("page"), page.click("#apply")]);
  await np.waitForURL(WD_A);
  const { panel, tabId } = await panelBeside(WD_A);
  await expect(question(panel)).toContainText("Applying for IT Analyst at Acme?");
  await expect(question(panel)).toContainText("Uses this job's résumé and cover letter.");
  await expect(question(panel)).toHaveAttribute("aria-live", "polite");
  await question(panel).getByRole("button", { name: "Yes" }).click();
  await expect(question(panel)).toHaveCount(0);
  const bound = () => ext.worker.evaluate(async (id) => (await chrome.storage.session.get("je_tab_job")).je_tab_job?.[id]?.jobId || null, tabId);
  expect(await bound()).toBe("A");
  await expect.poll(() => api.calls("/v1/saved-jobs/A/company-link").map((c) => c.body?.url)).toEqual([WD_A]);
  await np.goto(`${WD_A}/apply`);
  await expect.poll(bound).toBe("A");
  await Promise.all([page.close(), np.close(), panel.close()]);
});

test("No: nothing is bound or learned, and the panel doesn't ask again", async () => {
  const page = await ext.context.newPage();
  await page.goto(LI_A);
  await page.waitForTimeout(800);
  const [np] = await Promise.all([ext.context.waitForEvent("page"), page.click("#apply")]);
  await np.waitForURL(WD_A);
  const { panel, tabId } = await panelBeside(WD_A);
  await question(panel).getByRole("button", { name: "No" }).click();
  await expect(question(panel)).toHaveCount(0);
  await np.reload();
  await panel.reload();
  await panel.waitForTimeout(800);
  await expect(question(panel)).toHaveCount(0);
  expect(await ext.worker.evaluate(async (id) => (await chrome.storage.session.get("je_tab_job")).je_tab_job?.[id] || null, tabId)).toBeNull();
  expect(api.calls("/v1/saved-jobs/A/company-link")).toEqual([]);
  await Promise.all([page.close(), np.close(), panel.close()]);
});

test("a web page can't ask or answer the question", async () => {
  const page = await ext.context.newPage();
  await page.goto(LI_A);
  await page.waitForTimeout(800);
  const [np] = await Promise.all([ext.context.waitForEvent("page"), page.click("#apply")]);
  await np.waitForURL(WD_A);
  const tabId = await tabIdOf(WD_A);
  // A content script's message (the page's own script can't reach the
  // extension at all; a frame of ours on a page is still a page).
  const fromPage = await ext.worker.evaluate(async (id) => {
    const [t] = await chrome.tabs.query({ url: "https://acme.wd5.myworkdayjobs.com/*" });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: (tab) => chrome.runtime.sendMessage({ type: "answerApplyQuestion", tabId: tab, yes: true, page: "x" }),
      args: [id],
    });
    return result;
  }, tabId);
  expect(fromPage).toEqual({ ok: false });
  expect(await ext.worker.evaluate(async (id) => (await chrome.storage.session.get("je_tab_job")).je_tab_job?.[id] || null, tabId)).toBeNull();
  await Promise.all([page.close(), np.close()]);
});

test("a press inside an ad's frame, or a page script's click, never makes the panel ask", async () => {
  const page = await ext.context.newPage();
  await page.goto(LI_A);
  await page.waitForTimeout(800);
  const [ad] = await Promise.all([ext.context.waitForEvent("page"), page.frameLocator("#ad").locator("#adlink").click()]);
  await ad.waitForLoadState("load");
  const { panel } = await panelBeside(AD_LAND);
  await panel.waitForTimeout(800);
  await expect(question(panel)).toHaveCount(0);

  await page.evaluate(() => {
    const a = document.getElementById("synth");
    a.setAttribute("aria-label", "Apply now");
    a.click();
  });
  await page.waitForURL(WD_A);
  const beside = await panelBeside(WD_A);
  await beside.panel.waitForTimeout(800);
  await expect(question(beside.panel)).toHaveCount(0);
  expect(await ext.worker.evaluate(async () => (await chrome.storage.session.get("je_tab_press")).je_tab_press || {})).toEqual({});
  await Promise.all([page.close(), ad.close(), panel.close(), beside.panel.close()]);
});
