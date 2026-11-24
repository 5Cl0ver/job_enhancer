// The redesigned side panel (spec 015, Story 7): every action the old panel
// had, in each context, against the fake server — plus both themes and the
// app's contrast. The panel is opened as a page next to a real tab (?tab=).
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeApi } from "./support/fake-api.js";
import { startLabServer } from "./support/lab-server.js";
import { FIXTURES, ROOT, launchExtension } from "./support/launch.js";

let api;
let lab;
let ext;

const APPLY_URL = "https://careers.vellacor.example/apply/42";
const MYJOBS_URL = "https://myjobs.indeed.com/applied";

const JOBS = () => [
  {
    id: "s1",
    job_listing_id: "l1",
    title: "Help Desk Analyst",
    company: "Vellacor Robotics",
    location: "Springfield, IL",
    url: "https://vellacor.example/jobs/3",
    applied_at: null,
  },
  {
    id: "s2",
    job_listing_id: "l2",
    title: "IT Support Specialist",
    company: "Quillstone",
    location: "Remote",
    url: "https://quillstone.example/jobs/7",
    applied_at: "2026-11-20T10:00:00Z",
  },
];

test.beforeAll(async () => {
  api = await startFakeApi();
  lab = await startLabServer();
  ext = await launchExtension({ apiUrl: api.url });
  const apply = readFileSync(join(ROOT, "test", "lab", "classic.html"), "utf8").replace(
    /<title>[^<]*<\/title>/,
    "<title>Apply: Help Desk Analyst at Vellacor Robotics</title>",
  );
  await ext.context.route(APPLY_URL, (r) => r.fulfill({ status: 200, contentType: "text/html", body: apply }));
  const myJobs = readFileSync(join(FIXTURES, "indeed-myjobs.html"), "utf8");
  await ext.context.route(MYJOBS_URL, (r) => r.fulfill({ status: 200, contentType: "text/html", body: myJobs }));
  await ext.context.route("https://claude.ai/**", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<title>Claude</title><p>Claude</p>" }),
  );
});

test.afterAll(async () => {
  await ext?.close();
  await lab?.close();
  await api?.close();
});

test.beforeEach(async () => {
  api.reset();
  api.clearCalls();
  api.state.jobs = JOBS();
  api.state.jobsVersion++;
  api.state.claudeProjectUrl = "";
  await ext.worker.evaluate(() => chrome.storage.local.remove(["je_staged_resume", "je_claude_url", "je_not_this"]));
  await ext.seedSignedIn();
});

/** Open a tab at `url`, then the panel beside it. */
async function panelFor(url, { scheme = "light" } = {}) {
  const tab = await ext.context.newPage();
  await tab.goto(url);
  const tabId = await ext.worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
  const panel = await ext.context.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.setViewportSize({ width: 380, height: 760 });
  await panel.emulateMedia({ colorScheme: scheme });
  await panel.goto(`chrome-extension://${ext.extensionId}/dist/panel/index.html?tab=${tabId}`);
  return { tab, panel, errors };
}

/** The view on screen (the others stay mounted, hidden). */
const shown = (panel) => panel.locator("main > div:not([hidden])");

const nav = (panel, name) => panel.getByRole("navigation").getByRole("button", { name }).click();

test("sign in, then sign out from Settings", async () => {
  await ext.worker.evaluate(() => chrome.storage.local.clear());
  const { tab, panel, errors } = await panelFor(lab.url("/lab/posting.html"));
  await expect(panel.getByRole("heading", { name: "Sign in to Job Catcher" })).toBeVisible();
  await panel.getByRole("button", { name: "or sign in with a password" }).click();
  await panel.getByLabel("Email").fill("wren@example.com");
  await panel.getByLabel("Password").fill("not-a-real-password");
  await panel.getByRole("button", { name: "Sign in" }).click();
  await expect(panel.getByRole("heading", { name: "Save this job" })).toBeVisible();
  expect(api.calls("/auth/v1/token")).toHaveLength(1);

  await nav(panel, "Settings");
  await expect(panel.getByText("wren@example.com")).toBeVisible();
  await panel.getByRole("button", { name: "Sign out" }).click();
  await expect(panel.getByRole("heading", { name: "Sign in to Job Catcher" })).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all([tab.close(), panel.close()]);
});

test("save a posting: read it, check the details, save to My Jobs", async () => {
  const { tab, panel, errors } = await panelFor(lab.url("/lab/posting.html"));
  await panel.getByRole("button", { name: "Save this job" }).click();
  await expect(panel.getByLabel("Job title")).toHaveValue("Field Service Technician");
  await expect(panel.getByLabel("Company")).toHaveValue("Tidewell Labs");
  await expect(panel.getByLabel("Pay from")).toHaveValue("52000");
  await expect(panel.getByLabel("Description")).toHaveValue(/repair lab equipment/);
  await panel.getByLabel("Location").fill("Harborview, OR (on-site)");
  await panel.getByRole("button", { name: "Save to My Jobs" }).click();
  await expect(panel.getByText("Saved: Field Service Technician at Tidewell Labs")).toBeVisible();
  const [{ body }] = api.calls("/v1/saved-jobs/manual");
  expect(body).toMatchObject({
    title: "Field Service Technician",
    company: "Tidewell Labs",
    location: "Harborview, OR (on-site)",
    salary_min: 52000,
    salary_max: 64000,
    origin: "extension",
  });
  await nav(panel, "My jobs");
  await expect(shown(panel).getByText("Field Service Technician")).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all([tab.close(), panel.close()]);
});

test("saving a job you already have warns first", async () => {
  api.state.jobs.push({
    id: "s3",
    job_listing_id: "l3",
    title: "Field Service Technician",
    company: "Tidewell Labs",
    location: "Harborview, OR",
    url: "",
    applied_at: null,
  });
  api.state.jobsVersion++;
  const { tab, panel } = await panelFor(lab.url("/lab/posting.html"));
  await panel.getByRole("button", { name: "Save this job" }).click();
  await expect(panel.getByText(/You already saved/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save a second copy" })).toBeVisible();
  await panel.getByRole("button", { name: "Cancel" }).click();
  expect(api.calls("/v1/saved-jobs/manual")).toHaveLength(0);
  await Promise.all([tab.close(), panel.close()]);
});

test("My jobs: search, mark applied, and a failed load offers Retry", async () => {
  api.override("GET /v1/saved-jobs/summary", { status: 500, body: { detail: "boom" } });
  const { tab, panel } = await panelFor(lab.url("/lab/posting.html"));
  await nav(panel, "My jobs");
  await expect(panel.getByRole("alert")).toBeVisible();
  api.reset();
  await panel.getByRole("button", { name: "Retry" }).click();
  await expect(shown(panel).getByText("Help Desk Analyst")).toBeVisible();
  await expect(panel.getByText("Applied", { exact: true })).toBeVisible();

  await panel.getByLabel("Search my jobs").fill("quill");
  await expect(shown(panel).getByText("Help Desk Analyst")).toHaveCount(0);
  await panel.getByLabel("Search my jobs").fill("");

  const row = panel.getByRole("listitem").filter({ hasText: "Help Desk Analyst" });
  await row.getByRole("button", { name: "Mark Help Desk Analyst applied" }).click();
  await expect(row.getByText("Applied", { exact: true })).toBeVisible();
  expect(api.calls("/v1/saved-jobs/mark-applied")[0].body).toEqual({
    title: "Help Desk Analyst",
    company: "Vellacor Robotics",
    saved_job_id: "s1", // that exact job, no guessing by name
  });
  await Promise.all([tab.close(), panel.close()]);
});

test("applying: the panel knows the job, fills the page, and marks it applied", async () => {
  const { tab, panel, errors } = await panelFor(APPLY_URL);
  await expect(panel.getByText("Applying on Vellacor")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Help Desk Analyst" })).toBeVisible();
  await panel.getByRole("button", { name: "Autofill this page" }).click();
  await expect(tab.locator("#first")).toHaveValue("Wren", { timeout: 10000 });
  await expect(panel.getByText("nothing was submitted", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: /mark applied/ }).click();
  await expect(panel.getByText("Tracked as applied")).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all([tab.close(), panel.close()]);
});

test("Greenhouse: another company's look-alike job is never linked; save this one, open it in the app", async () => {
  const GH = "https://job-boards.greenhouse.io/opalinepay/jobs/7002";
  const page = readFileSync(join(ROOT, "test", "lab", "classic.html"), "utf8").replace(
    /<title>[^<]*<\/title>/,
    "<title>Job Application for Software Engineer II, Fullstack (Ads Platform) at Opaline Pay</title>",
  );
  await ext.context.route(GH, (r) => r.fulfill({ status: 200, contentType: "text/html", body: page }));
  // Two saved Greenhouse jobs at other companies — one a near look-alike title.
  api.state.jobs = [
    { id: "g1", job_listing_id: "gl1", title: "Software Engineer I", company: "Brightfold", location: "Remote", url: "https://job-boards.greenhouse.io/brightfold/jobs/4001", applied_at: null },
    { id: "g2", job_listing_id: "gl2", title: "Software Engineer", company: "Kestrel Analytics", location: "Remote", url: "https://boards.greenhouse.io/kestrel/jobs/5003", applied_at: null },
  ];
  api.state.jobsVersion++;
  const { tab, panel, errors } = await panelFor(GH);
  await expect(panel.getByText("Applying on Greenhouse")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Application in progress" })).toBeVisible();
  await expect(shown(panel).getByText("Software Engineer I", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /mark applied/ })).toHaveCount(0);

  // Saving is always there.
  await panel.getByRole("button", { name: "Not saved yet? Save this job" }).click();
  await panel.getByRole("button", { name: "Save this job" }).click();
  await panel.getByLabel("Job title").fill("Software Engineer II, Fullstack (Ads Platform)");
  await panel.getByLabel("Company").fill("Opaline Pay");
  await panel.getByRole("button", { name: "Save to My Jobs" }).click();
  await expect(panel.getByText("Saved: Software Engineer II, Fullstack (Ads Platform) at Opaline Pay")).toBeVisible();
  expect(api.calls("/v1/saved-jobs/manual")[0].body.url).toBe(GH);

  // Now the page is that saved job: its title, Open in app, still a Save link.
  await expect(panel.getByRole("heading", { name: "Software Engineer II, Fullstack (Ads Platform)" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save this job" })).toBeVisible();
  const opened = ext.context.waitForEvent("page");
  await panel.getByRole("button", { name: "Open in app" }).click();
  const appTab = await opened;
  await expect.poll(() => appTab.url()).toBe(`${api.url}/jobs/listing-3`);
  await appTab.close();

  // Not this job: the link goes, and stays gone for this page.
  await panel.getByRole("button", { name: "Not this job" }).click();
  await expect(panel.getByRole("heading", { name: "Application in progress" })).toBeVisible();
  await panel.reload();
  await expect(panel.getByRole("heading", { name: "Application in progress" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Not saved yet? Save this job" })).toBeVisible();
  const kept = await ext.worker.evaluate(() => chrome.storage.local.get("je_not_this"));
  expect(kept.je_not_this["greenhouse:7002"]).toEqual(["saved-3"]);
  expect(errors).toEqual([]);
  await Promise.all([tab.close(), panel.close()]);
});

test("Indeed My jobs: read the applications, choose, sync", async () => {
  const { tab, panel } = await panelFor(MYJOBS_URL);
  await panel.getByRole("button", { name: "Read my Indeed applications" }).click();
  const boxes = panel.getByRole("checkbox");
  await expect(boxes).toHaveCount(3);
  await boxes.first().uncheck();
  await panel.getByRole("button", { name: "Sync 2" }).click();
  await expect(panel.getByText("0 updated · 2 added")).toBeVisible();
  expect(api.state.syncs).toHaveLength(2);
  await Promise.all([tab.close(), panel.close()]);
});

test("Write with the free AI: a cover letter, then a tailored résumé for the next Autofill", async () => {
  const { tab, panel, errors } = await panelFor(lab.url("/lab/posting.html"));
  await nav(panel, "Write");
  await panel.getByLabel("Job", { exact: true }).selectOption({ label: "Help Desk Analyst · Vellacor Robotics" });
  await panel.getByRole("button", { name: "Write my cover letter" }).click();
  await expect(panel.getByLabel("Your cover letter")).toHaveValue(/Dear Hiring Team/);
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();
  const download = panel.waitForEvent("download");
  await panel.getByRole("button", { name: "PDF" }).click();
  expect((await download).suggestedFilename()).toBe("Wren_Calloway_Cover_Letter.pdf");

  await panel.getByRole("radio", { name: "Tailored résumé" }).click();
  await panel.getByRole("button", { name: "Write my résumé" }).click();
  await expect(panel.getByText("Wren_Calloway_Resume.pdf")).toBeVisible();
  const staged = await ext.worker.evaluate(() => chrome.storage.local.get("je_staged_resume"));
  expect(staged.je_staged_resume.filename).toBe("Wren_Calloway_Resume.pdf");
  await panel.getByRole("button", { name: "Use my usual résumé instead" }).click();
  await expect(panel.getByText("Wren_Calloway_Resume.pdf")).toHaveCount(0);
  expect(errors).toEqual([]);
  await Promise.all([tab.close(), panel.close()]);
});

test("Write with my Claude: the prompt is copied, Claude opens, the answer is saved", async () => {
  const { tab, panel } = await panelFor(lab.url("/lab/posting.html"));
  await nav(panel, "Write");
  await panel.getByRole("radio", { name: "My Claude" }).click();
  const claudeTab = ext.context.waitForEvent("page");
  await panel.getByRole("button", { name: "Draft my cover letter with Claude" }).click();
  await claudeTab;
  await expect(panel.getByText(/Prompt copied/)).toBeVisible();
  await panel.getByLabel("Claude's answer").fill("Dear Hiring Team, written by my own Claude.");
  await panel.getByRole("button", { name: "Save and make PDF" }).click();
  await expect(panel.getByLabel("Your cover letter")).toHaveValue(/my own Claude/);
  expect(api.calls("/v1/ai/documents/manual")[0].body).toMatchObject({
    document_type: "cover_letter",
    content: "Dear Hiring Team, written by my own Claude.",
  });
  await Promise.all([tab.close(), panel.close()]);
});

test("Settings: the Claude Project link is saved to the account", async () => {
  const { tab, panel } = await panelFor(lab.url("/lab/posting.html"));
  await nav(panel, "Settings");
  await panel.getByLabel("Claude Project link").fill("https://claude.ai/project/wren-jobs");
  await expect.poll(() => api.state.claudeProjectUrl, { timeout: 4000 }).toBe("https://claude.ai/project/wren-jobs");
  await Promise.all([tab.close(), panel.close()]);
});

test("nothing to do on a browser page says what Job Catcher is for", async () => {
  const { tab, panel } = await panelFor("about:blank");
  await expect(panel.getByRole("heading", { name: "Open a job or an application" })).toBeVisible();
  await Promise.all([tab.close(), panel.close()]);
});

for (const scheme of ["light", "dark"]) {
  test(`every view meets WCAG AA contrast in ${scheme} mode`, async () => {
    const { tab, panel, errors } = await panelFor(APPLY_URL, { scheme });
    await expect(panel.getByRole("button", { name: "Autofill this page" })).toBeVisible();
    const check = async (where) => {
      const { violations } = await new AxeBuilder({ page: panel }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(violations.map((v) => `${where}: ${v.id} — ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    };
    await check("This page");
    for (const view of ["My jobs", "Write", "Settings"]) {
      await nav(panel, view);
      await panel.waitForTimeout(300);
      await check(view);
    }
    expect(errors).toEqual([]);
    await Promise.all([tab.close(), panel.close()]);
  });
}

test("work in progress survives switching views", async () => {
  const { tab, panel } = await panelFor(lab.url("/lab/posting.html"));
  await nav(panel, "Write");
  await panel.getByRole("button", { name: "Write my cover letter" }).click();
  await expect(panel.getByLabel("Your cover letter")).toHaveValue(/Dear Hiring Team/);
  await nav(panel, "This page");
  await nav(panel, "My jobs");
  await nav(panel, "Write");
  await expect(panel.getByLabel("Your cover letter")).toHaveValue(/Dear Hiring Team/);
  expect(api.calls("/v1/ai/generate")).toHaveLength(1); // nothing written twice
  await Promise.all([tab.close(), panel.close()]);
});

test("Write picks the job you're applying to", async () => {
  const { tab, panel } = await panelFor(APPLY_URL);
  await nav(panel, "Write");
  await expect(panel.getByLabel("Job", { exact: true })).toHaveValue("l1"); // Help Desk Analyst
  await Promise.all([tab.close(), panel.close()]);
});

test("a failed lookup never overwrites the account's Claude link with an old one", async () => {
  api.state.claudeProjectUrl = "https://claude.ai/project/new-one";
  await ext.worker.evaluate(() => chrome.storage.local.set({ je_claude_url: "https://claude.ai/project/old-one" }));
  api.override("GET /v1/users/me", { status: 503, body: { detail: "waking up" } });
  const { tab, panel } = await panelFor(lab.url("/lab/posting.html"));
  await nav(panel, "Settings");
  await expect(panel.getByLabel("Claude Project link")).toHaveValue("https://claude.ai/project/old-one");
  await panel.waitForTimeout(1500);
  expect(api.state.claudeProjectUrl).toBe("https://claude.ai/project/new-one");
  expect(api.calls("/v1/users/me").filter((c) => c.method === "PATCH")).toHaveLength(0);
  expect(api.calls("/v1/users/me/claude-project")).toHaveLength(0);
  await Promise.all([tab.close(), panel.close()]);
});
