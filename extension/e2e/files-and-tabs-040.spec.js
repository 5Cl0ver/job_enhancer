// The job an Apply press suggests (spec 040), in real Chromium: only the
// user's own press on an Apply in a saved job's page (never a frame in it,
// never a page script's click) makes the panel suggest that job on the
// next pages. Its résumé and cover letter are used only when the user
// presses "Fill with <job>'s résumé and cover letter", for that one fill;
// "Is this the application for <job>?" Yes only saves the job's link.
// Invented data.
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
// A page that doesn't name the job (a title and company match would link it by itself).
const FORM = `<form>
  <label for="first">First name</label><input id="first" name="first" autocomplete="given-name">
  <label for="resume">Resume</label><input type="file" id="resume" name="resume">
  <label for="cl">Cover letter</label><input type="file" id="cl" name="cover_letter">
</form>`;
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
  [AD_LAND]: html("Enroll", FORM),
  [WD_A]: html("Workday", FORM),
  [`${WD_A}/apply`]: html("Workday", FORM),
};
const JOB = { id: "A", job_listing_id: "L1", title: "IT Analyst", company: "Acme", location: "", url: LI_A, applied_at: null, resume_id: "r-tailored", cover_letter_id: "cl-1", company_url: null };

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
  api.state.resumes = { "r-tailored": { filename: "Sam_Rivera_IT_Analyst.pdf", bytes: Buffer.from("%PDF-1.4 invented tailored resume"), details: {} } };
  api.state.coverLetters = { "cl-1": { filename: "Sam Rivera - Cover letter.pdf", text: "Hi Jordan, the IT Analyst role fits what I do." } };
  await ext.seedSignedIn();
  await ext.worker.evaluate(async (jobs) => {
    await chrome.storage.session.set({ je_tab_press: {}, je_tab_pick: {}, je_new_tabs: {} });
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

async function pressApply() {
  const page = await ext.context.newPage();
  await page.goto(LI_A);
  await page.waitForTimeout(800); // Job Catcher's page script is in
  const [np] = await Promise.all([ext.context.waitForEvent("page"), page.click("#apply")]);
  await np.waitForURL(WD_A);
  return { page, np };
}

const fillWith = (panel) => panel.getByRole("button", { name: "Fill with IT Analyst at Acme's résumé and cover letter" });
const landing = (panel) => panel.getByRole("group", { name: /Is this the application for/ });
const fileName = (np, id) => np.locator(`#${id}`).evaluate((el) => el.files?.[0]?.name || "");

test("the board's Apply: the panel suggests the job; only its labelled Fill uses its résumé and letter, for that fill", async () => {
  const { page, np } = await pressApply();
  const { panel } = await panelBeside(WD_A);
  await expect(panel.getByText("From your Apply on")).toContainText("IT Analyst at Acme");
  await expect(fillWith(panel)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Use my usual résumé" })).toBeVisible();
  // Nothing of the job's is used until the user asks for it.
  expect(api.calls("/v1/autofill/resumes/r-tailored/file")).toEqual([]);
  await fillWith(panel).click();
  await expect.poll(() => fileName(np, "resume"), { timeout: 10000 }).toBe("Sam_Rivera_IT_Analyst.pdf");
  await expect.poll(() => fileName(np, "cl")).toBe("Sam Rivera - Cover letter.pdf");
  expect(api.calls("/v1/autofill/cover-letters/cl-1").length).toBeGreaterThan(0);
  // The next page: the suggestion again, nothing used until pressed again.
  api.clearCalls();
  await np.goto(`${WD_A}/apply`);
  await panel.reload();
  await expect(fillWith(panel)).toBeVisible();
  await panel.getByRole("button", { name: "Use my usual résumé" }).click();
  await expect(np.locator("#first")).toHaveValue("Wren", { timeout: 10000 }); // the usual fill ran
  expect(api.calls("/v1/autofill/resumes/r-tailored/file")).toEqual([]);
  expect(api.calls("/v1/autofill/cover-letters/cl-1")).toEqual([]);
  await Promise.all([page.close(), np.close(), panel.close()]);
});

test("'Is this the application for…?' Yes saves the job's link, once; nothing else", async () => {
  const { page, np } = await pressApply();
  const { panel } = await panelBeside(WD_A);
  await expect(landing(panel)).toContainText("Is this the application for IT Analyst?");
  await landing(panel).getByRole("button", { name: "Yes" }).click();
  await expect(landing(panel)).toHaveCount(0);
  await expect.poll(() => api.calls("/v1/saved-jobs/A/company-link").map((c) => c.body?.url)).toEqual([WD_A]);
  expect(api.calls("/v1/autofill/resumes/r-tailored/file")).toEqual([]);
  await np.goto(`${WD_A}/apply`);
  await panel.reload();
  await expect(fillWith(panel)).toBeVisible();
  await expect(landing(panel)).toHaveCount(0); // asked once
  await Promise.all([page.close(), np.close(), panel.close()]);
});

test("a web page can't read or answer the suggestion, or pick the job", async () => {
  const { page, np } = await pressApply();
  const tabId = await tabIdOf(WD_A);
  const replies = await ext.worker.evaluate(async (id) => {
    const [t] = await chrome.tabs.query({ url: "https://acme.wd5.myworkdayjobs.com/*" });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: async (tab) => [
        await chrome.runtime.sendMessage({ type: "getJobSuggestion", tabId: tab }),
        await chrome.runtime.sendMessage({ type: "answerLanding", tabId: tab, yes: true, page: "x" }),
      ],
      args: [id],
    });
    return result;
  }, tabId);
  expect(replies).toEqual([{ ok: false }, { ok: false }]);
  expect(api.calls("/v1/saved-jobs/A/company-link")).toEqual([]);
  await Promise.all([page.close(), np.close()]);
});

test("a press inside an ad's frame, or a page script's click, never suggests the job", async () => {
  const page = await ext.context.newPage();
  await page.goto(LI_A);
  await page.waitForTimeout(800);
  const [ad] = await Promise.all([ext.context.waitForEvent("page"), page.frameLocator("#ad").locator("#adlink").click()]);
  await ad.waitForLoadState("load");
  const { panel } = await panelBeside(AD_LAND);
  await panel.waitForTimeout(800);
  await expect(fillWith(panel)).toHaveCount(0);
  await expect(panel.getByText("From your Apply on")).toHaveCount(0);

  await page.evaluate(() => {
    const a = document.getElementById("synth");
    a.setAttribute("aria-label", "Apply now");
    a.click();
  });
  await page.waitForURL(WD_A);
  const beside = await panelBeside(WD_A);
  await beside.panel.waitForTimeout(800);
  await expect(fillWith(beside.panel)).toHaveCount(0);
  expect(await ext.worker.evaluate(async () => (await chrome.storage.session.get("je_tab_press")).je_tab_press || {})).toEqual({});
  await Promise.all([page.close(), ad.close(), panel.close(), beside.panel.close()]);
});
