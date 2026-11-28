// Job Catcher's files and tabs (spec 040). Invented data.
// - A tab keeps the saved job it was on when the job board's Apply leads to
//   the company's site (Dayforce, iCIMS…), and a tab it opens inherits it, so
//   the job's own résumé and cover letter are used there.
// - A tab LinkedIn's "Apply on company website" opens: the job learns the
//   company's link, and during Apply with Claude the tab joins the run's tab
//   group and Claude hears its address.
// - "Paste your résumé" gets the résumé's text.
import { describe, expect, it, vi } from "vitest";
import { CARRY_MS, TAB_JOB, carriedJobId, nextEntry, onHub, onJobBoard, putEntry } from "../src/tabJob.js";
import { createTabJobs } from "../src/background/tabJobs.js";
import { bestJobMatch } from "../panel/src/lib/context.ts";
import { isResumeText, resolve } from "../src/autofill/resolve.js";

const BOARD = "https://www.linkedin.com/jobs/view/4100000001/";
const DAYFORCE = "https://jobs.dayforcehcm.com/en-US/northwind/CANDIDATEPORTAL/jobs/123";
const T0 = 1_700_000_000_000;

describe("where a carried job ends", () => {
  it("job boards, search engines and the app are where the next job is picked", () => {
    expect(onHub(BOARD)).toBe(true);
    expect(onHub("https://www.indeed.com/viewjob?jk=abc")).toBe(true);
    expect(onHub("https://www.google.com/search?q=jobs")).toBe(true);
    expect(onHub("https://job-enhancer-xxj1.vercel.app/jobs")).toBe(true);
    expect(onHub("about:blank")).toBe(true);
    expect(onHub(DAYFORCE)).toBe(false);
    expect(onHub("https://careers.northwind.example/en/jobs/1/apply")).toBe(false);
    expect(onHub("https://careers.google.com/jobs/results/1")).toBe(false);
    expect(onJobBoard(BOARD)).toBe(true);
    expect(onJobBoard(DAYFORCE)).toBe(false);
  });

  it("a page's own job wins; elsewhere the tab keeps its job for 2 hours", () => {
    const own = nextEntry(null, BOARD, "j1", T0);
    expect(own).toEqual({ jobId: "j1", at: T0 });
    const later = nextEntry(own, DAYFORCE, null, T0 + 60_000);
    expect(later).toBe(own);
    expect(carriedJobId(later, DAYFORCE, T0 + 60_000)).toBe("j1");
    expect(carriedJobId(later, DAYFORCE, T0 + CARRY_MS + 1)).toBeNull();
    expect(nextEntry(own, DAYFORCE, null, T0 + CARRY_MS + 1)).toBeNull();
    // Back on a board: forgotten (the next job opened from there is another).
    expect(nextEntry(own, "https://www.linkedin.com/jobs/search/", null, T0)).toBeNull();
    expect(carriedJobId(own, BOARD, T0)).toBeNull();
  });

  it("a tab just opened from the job keeps it through the board's redirect", () => {
    const opened = { jobId: "j1", at: T0, opened: true };
    expect(nextEntry(opened, "https://www.linkedin.com/redir/redirect?url=x", null, T0)).toBe(opened);
    expect(nextEntry(opened, DAYFORCE, null, T0)).toEqual({ jobId: "j1", at: T0 });
  });

  it("keeps a few tabs, newest last", () => {
    let map = {};
    for (let i = 0; i < 60; i++) map = putEntry(map, i, { jobId: `j${i}`, at: T0 });
    expect(Object.keys(map)).toHaveLength(50);
    expect(map[59].jobId).toBe("j59");
    expect(putEntry(map, 59, null)[59]).toBeUndefined();
  });
});

describe("bestJobMatch with a carried job and the company's link", () => {
  const JOBS = [
    { id: "j1", job_listing_id: "l1", title: "Platform Engineer", company: "Northwind Labs", location: "", url: BOARD, applied: false },
    { id: "j2", job_listing_id: "l2", title: "Data Analyst", company: "Contoso", location: "", url: "https://www.indeed.com/viewjob?jk=abc123", applied: false, company_url: "https://boards.greenhouse.io/contoso/jobs/5551234" },
  ];
  const page = { url: DAYFORCE, title: "Candidate Info" };

  it("a page that names no job is the carried one", () => {
    expect(bestJobMatch(page, JOBS)).toBeNull();
    expect(bestJobMatch(page, JOBS, [], undefined, "j1")?.id).toBe("j1");
  });

  it("never one the user said isn't this page, and never over the page's own job", () => {
    expect(bestJobMatch(page, JOBS, ["j1"], undefined, "j1")).toBeNull();
    const own = { url: "https://boards.greenhouse.io/contoso/jobs/5551234", title: "Apply" };
    expect(bestJobMatch(own, JOBS, [], undefined, "j1")?.id).toBe("j2");
  });

  it("the company's own application is the job's page too", () => {
    expect(bestJobMatch({ url: "https://boards.greenhouse.io/contoso/jobs/5551234#app", title: "" }, JOBS)?.id).toBe("j2");
  });
});

/** A fake chrome with session storage and tabs. */
function fakeChrome(tabs = {}) {
  const store = {};
  return {
    store,
    storage: {
      session: {
        get: async (k) => (k in store ? { [k]: store[k] } : {}),
        set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o))),
      },
    },
    tabs: { get: async (id) => tabs[id] || null },
  };
}

describe("tabs and the jobs they apply for", () => {
  const jobOf = { [BOARD]: { id: "j1" } };
  const ownMatch = async (tab) => jobOf[tab.url] || null;

  it("the board's Apply in the same tab: the company's page carries the job", async () => {
    const c = fakeChrome();
    const tj = createTabJobs({ ownMatch, chrome: c, now: () => T0 });
    await tj.loaded({ id: 7, url: BOARD });
    await tj.loaded({ id: 7, url: DAYFORCE });
    expect(await tj.carried({ id: 7, url: DAYFORCE })).toBe("j1");
    expect(c.store[TAB_JOB][7].jobId).toBe("j1");
    await tj.closed(7);
    expect(c.store[TAB_JOB][7]).toBeUndefined();
  });

  it("a new tab from the board: carries the job, learns the company link once, and tells the run", async () => {
    const c = fakeChrome({ 7: { id: 7, url: BOARD, groupId: 3 } });
    const learnLink = vi.fn(async () => {});
    const run = { opened: vi.fn(async () => true), landed: vi.fn(async () => {}) };
    const tj = createTabJobs({ ownMatch, learnLink, run, chrome: c, now: () => T0 });
    const tab = { id: 9, openerTabId: 7, url: "about:blank" };
    // Its first page can load before the opening is noted: one at a time.
    const opening = tj.opened(tab);
    const redirect = tj.loaded({ id: 9, url: "https://www.linkedin.com/redir/redirect?url=x" });
    const landed = tj.loaded({ id: 9, url: DAYFORCE });
    await Promise.all([opening, redirect, landed]);
    expect(run.opened).toHaveBeenCalledWith(tab, expect.objectContaining({ id: 7 }));
    expect(learnLink).toHaveBeenCalledTimes(1);
    expect(learnLink).toHaveBeenCalledWith("j1", DAYFORCE);
    expect(run.landed).toHaveBeenCalledWith(expect.objectContaining({ id: 9, url: DAYFORCE }));
    expect(await tj.carried({ id: 9, url: DAYFORCE })).toBe("j1");
    // The next page in it is just the application going on.
    await tj.loaded({ id: 9, url: `${DAYFORCE}/step2` });
    expect(learnLink).toHaveBeenCalledTimes(1);
    expect(run.landed).toHaveBeenCalledTimes(1);
  });

  it("a tab from a page that's no saved job, with no run: nothing", async () => {
    const c = fakeChrome({ 4: { id: 4, url: "https://news.example/story" } });
    const learnLink = vi.fn();
    const tj = createTabJobs({ ownMatch, learnLink, chrome: c, now: () => T0 });
    await tj.opened({ id: 5, openerTabId: 4 });
    await tj.loaded({ id: 5, url: DAYFORCE });
    expect(learnLink).not.toHaveBeenCalled();
    expect(await tj.carried({ id: 5, url: DAYFORCE })).toBeNull();
  });

  it("a new tab that only lands after a minute is no Apply", async () => {
    let now = T0;
    const c = fakeChrome({ 7: { id: 7, url: BOARD } });
    const learnLink = vi.fn();
    const tj = createTabJobs({ ownMatch, learnLink, chrome: c, now: () => now });
    await tj.opened({ id: 9, openerTabId: 7 });
    now += 61_000;
    await tj.loaded({ id: 9, url: DAYFORCE });
    expect(learnLink).not.toHaveBeenCalled();
  });
});

describe("Apply with Claude: a tab opened from the application's tab", () => {
  async function setup({ hosts = ["linkedin.com"], runTabs = [7] } = {}) {
    const { createApplyRun } = await import("../src/background/applyRun.js");
    const calls = [];
    const session = { "je_apply_tabs:r1": runTabs };
    const c = {
      storage: {
        session: {
          get: async (k) => (k in session ? { [k]: session[k] } : {}),
          set: async (o) => Object.assign(session, o),
        },
        local: { get: async () => ({ je_token: "t" }) },
      },
      tabs: { group: vi.fn(async () => 3) },
    };
    const api = async (path, init) => {
      calls.push([path, init]);
      if (path === "/v1/apply/active") return { ok: true, json: async () => ({ run_id: "r1", hosts, requests: [] }) };
      return { ok: true, json: async () => ({}) };
    };
    const run = createApplyRun({ api, press: async () => ({ ok: true }), fillSession: async () => ({ frames: {} }), chrome: c });
    return { run, c, calls, session };
  }

  it("joins the run's tab group at once, and Claude hears where it landed", async () => {
    const { run, c, calls, session } = await setup();
    const opener = { id: 7, url: BOARD, groupId: 3 };
    expect(await run.tabOpened({ id: 9, groupId: -1, url: "about:blank" }, opener)).toBe(true);
    expect(c.tabs.group).toHaveBeenCalledWith({ groupId: 3, tabIds: 9 });
    expect(session["je_apply_tabs:r1"]).toContain(9);
    await run.tabLanded({ id: 9, url: DAYFORCE });
    const event = calls.find(([p]) => p === "/v1/apply/runs/r1/event");
    expect(JSON.parse(event[1].body)).toEqual({ kind: "new_tab", url: DAYFORCE });
  });

  it("never a tab from another page: not the run's tab, not in a group", async () => {
    const { run, c, calls } = await setup({ runTabs: [] });
    const elsewhere = { id: 8, url: "https://news.example/", groupId: -1 };
    expect(await run.tabOpened({ id: 9, groupId: -1 }, elsewhere)).toBe(false);
    const onBoardUngrouped = { id: 8, url: BOARD, groupId: -1 };
    expect(await run.tabOpened({ id: 9, groupId: -1 }, onBoardUngrouped)).toBe(false);
    expect(c.tabs.group).not.toHaveBeenCalled();
    await run.tabLanded({ id: 9, url: DAYFORCE });
    expect(calls.some(([p]) => p.endsWith("/event"))).toBe(false);
  });
});

describe('"Paste your résumé"', () => {
  const box = (question, extra = {}) => ({ kind: "textarea", question, hints: {}, ...extra });

  it("is only a box that plainly says so", () => {
    for (const q of ["Resume", "Résumé", "Paste your resume", "Resume text", "CV (paste here)", "Resume:"]) {
      expect(isResumeText(box(q))).toBe(true);
    }
    for (const q of ["Resume / Cover letter", "Why should we look at your resume?", "Cover letter", "Résumé (optional, not required)", "Resume headline"]) {
      expect(isResumeText(box(q))).toBe(false);
    }
    expect(isResumeText({ kind: "file", question: "Resume", hints: {} })).toBe(false);
  });

  it("gets the résumé's text, never cut off", () => {
    const copy = { values: {}, answers: [], resumeText: "Sam Rivera\nPlatform engineer." };
    expect(resolve(box("Paste your resume"), copy)).toMatchObject({ values: ["Sam Rivera\nPlatform engineer."], key: "resume_text" });
    expect(resolve(box("Paste your resume", { hints: { maxLength: 10 } }), copy)).toMatchObject({ skip: "too_long" });
    expect(resolve(box("Paste your resume"), { ...copy, resumeText: "" }).key).not.toBe("resume_text");
  });
});
