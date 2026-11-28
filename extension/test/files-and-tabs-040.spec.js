// Job Catcher's files and tabs (spec 040). Invented data.
// - A tab keeps the saved job it was on when the job board's Apply leads to
//   the company's site (Dayforce, iCIMS…), and a tab it opens inherits it, so
//   the job's own résumé and cover letter are used there.
// - A tab LinkedIn's "Apply on company website" opens: the job learns the
//   company's link, and during Apply with Claude the tab joins the run's tab
//   group and Claude hears its address.
// - "Paste your résumé" gets the résumé's text.
import { describe, expect, it, vi } from "vitest";
import { CARRY_MS, TAB_JOB, boardRedirect, carriedJobId, definitePosting, nextEntry, onHub, onJobBoard, putEntry, siteOf, worthTelling } from "../src/tabJob.js";
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
    expect(onHub("chrome://newtab/")).toBe(true);
    expect(onHub(DAYFORCE)).toBe(false);
    expect(onHub("https://careers.northwind.example/en/jobs/1/apply")).toBe(false);
    expect(onHub("https://careers.google.com/jobs/results/1")).toBe(false);
    expect(onJobBoard(BOARD)).toBe(true);
    expect(onJobBoard(DAYFORCE)).toBe(false);
    expect(siteOf("https://jobs.northwind.co.uk/x")).toBe("northwind.co.uk");
    expect(siteOf(DAYFORCE)).toBe("dayforcehcm.com");
  });

  it("a page's own job wins; elsewhere the tab keeps it for 45 minutes", () => {
    const own = nextEntry(null, BOARD, "j1", T0);
    expect(own).toEqual({ jobId: "j1", at: T0 });
    const later = nextEntry(own, DAYFORCE, null, T0 + 60_000);
    expect(later).toMatchObject({ jobId: "j1", at: T0, site: "dayforcehcm.com", ats: true });
    expect(carriedJobId(later, DAYFORCE, T0 + 60_000)).toBe("j1");
    expect(CARRY_MS).toBe(45 * 60_000);
    expect(carriedJobId(later, DAYFORCE, T0 + CARRY_MS + 1)).toBeNull();
    expect(nextEntry(later, DAYFORCE, null, T0 + CARRY_MS + 1)).toBeNull();
    // Back on a board: forgotten (the next job opened from there is another).
    expect(nextEntry(later, "https://www.linkedin.com/jobs/search/", null, T0)).toBeNull();
    expect(carriedJobId(later, BOARD, T0)).toBeNull();
  });

  it("keeps a few tabs, newest last", () => {
    let map = {};
    for (let i = 0; i < 60; i++) map = putEntry(map, i, { jobId: `j${i}`, at: T0 });
    expect(Object.keys(map)).toHaveLength(50);
    expect(map[59].jobId).toBe("j59");
    expect(putEntry(map, 59, null)[59]).toBeUndefined();
  });
});

describe("review 1: a new tab keeps its job only through its own board's redirect", () => {
  const opened = { jobId: "A", at: T0, opened: true, from: "linkedin.com" };

  it("the board's own redirects on the way out keep it", () => {
    for (const url of [
      "https://www.linkedin.com/redir/redirect?url=x",
      "https://www.linkedin.com/safety/go?url=x",
      "https://www.linkedin.com/jobs/view/externalApply/4100000001?url=x",
    ]) {
      expect(nextEntry(opened, url, null, T0)).toBe(opened);
      expect(boardRedirect("linkedin.com", url)).toBe(true);
    }
    const indeed = { ...opened, from: "indeed.com" };
    expect(nextEntry(indeed, "https://www.indeed.com/applystart?jk=abc", null, T0)).toBe(indeed);
    expect(nextEntry(indeed, "https://www.indeed.com/rc/clk?jk=abc", null, T0)).toBe(indeed);
  });

  it("another posting, another board, a search or a new tab page ends it", () => {
    for (const url of [
      "https://www.linkedin.com/jobs/view/4000000002", // a similar job B
      "https://www.linkedin.com/feed/",
      "https://www.indeed.com/rc/clk?jk=abc", // not its own board
      "https://www.google.com/search?q=northwind",
      "chrome://newtab/",
    ]) {
      expect(nextEntry(opened, url, null, T0 + 5_000)).toBeNull();
    }
  });

  it("the reviewer's probe: B's posting, then B's application, is never A's", () => {
    let e = nextEntry(opened, "https://www.linkedin.com/jobs/view/4000000002", null, T0 + 5_000);
    e = nextEntry(e, "https://companyb.wd5.myworkdayjobs.com/en-US/ext/job/Remote/Dev_R-99/apply", null, T0 + 20_000);
    expect(e).toBeNull();
    expect(carriedJobId(e, "https://companyb.wd5.myworkdayjobs.com/x", T0 + 30_000)).toBeNull();
  });

  it("its first page off the board settles it there", () => {
    const e = nextEntry(opened, DAYFORCE, null, T0);
    expect(e).toEqual({ jobId: "A", at: T0, site: "dayforcehcm.com", ats: true, posting: definitePosting(DAYFORCE) });
    expect(e.opened).toBeUndefined();
    // Settled: a board page now ends it, redirect or not.
    expect(nextEntry(e, "https://www.linkedin.com/redir/redirect?url=x", null, T0)).toBeNull();
  });
});

describe("review 2: never another posting", () => {
  it("a different posting in the tab ends the carry", () => {
    const e = nextEntry({ jobId: "A", at: T0 }, DAYFORCE, null, T0);
    expect(nextEntry(e, `${DAYFORCE}/apply`, null, T0)).toMatchObject({ jobId: "A" });
    expect(nextEntry(e, "https://jobs.dayforcehcm.com/en-US/northwind/CANDIDATEPORTAL/jobs/456", null, T0)).toBeNull();
  });

  const A = { id: "A", job_listing_id: "l1", title: "Platform Engineer", company: "Northwind Labs", location: "", url: "https://northwind.wd5.myworkdayjobs.com/ext/job/Remote/Platform-Engineer_R-1001", applied: false };

  it("bestJobMatch never carries a job onto another posting of the job's own system", () => {
    const other = { url: "https://northwind.wd5.myworkdayjobs.com/ext/job/Remote/Data-Analyst_R-2002/apply", title: "Apply" };
    expect(bestJobMatch(other, [A], [], undefined, "A")).toBeNull();
    const same = { url: `${A.url}/apply`, title: "Apply" };
    expect(bestJobMatch(same, [A], [], undefined, null)?.id).toBe("A");
    const sameSystemNoPosting = { url: "https://northwind.wd5.myworkdayjobs.com/ext/login", title: "Sign in" };
    expect(bestJobMatch(sameSystemNoPosting, [A], [], undefined, "A")?.id).toBe("A");
  });

  it("a Submit is tracked for the page's own job only (no carry), e.g. its company_url", () => {
    const B = { ...A, id: "B", url: BOARD, company_url: DAYFORCE };
    // What markApplied asks: no carried job, so an unrelated application is no job…
    expect(bestJobMatch({ url: "https://other.icims.com/jobs/555/job", title: "Apply" }, [B])).toBeNull();
    // …and the job's own company application is that job.
    expect(bestJobMatch({ url: DAYFORCE, title: "Candidate Info" }, [B])?.id).toBe("B");
  });
});

describe("review 4: the carry stays on the application's site", () => {
  const own = { jobId: "A", at: T0 };

  it("a typed address or a bookmark on another site ends it", () => {
    const e = nextEntry(own, DAYFORCE, null, T0);
    expect(nextEntry(e, "https://other.icims.com/jobs/555/job", null, T0 + 60_000)).toBeNull();
    expect(nextEntry(e, "https://news.example/story", null, T0 + 60_000)).toBeNull();
    // Straight from the job's page to a site that's no application: no carry.
    expect(nextEntry(own, "https://news.example/story", null, T0 + 60_000)).toBeNull();
    // The reviewer's probe: an unrelated application an hour later.
    expect(nextEntry(own, "https://other.icims.com/jobs/555/job", null, T0 + 3600e3)).toBeNull();
  });

  it("a sign-in on the way, and the company's site handing over to its applicant system once, keep it", () => {
    let e = nextEntry(own, "https://careers.northwind.example/jobs/platform-engineer-1001", null, T0);
    expect(e).toMatchObject({ site: "northwind.example", ats: false });
    expect(nextEntry(e, "https://northwind.okta.com/login", null, T0)).toBe(e);
    e = nextEntry(e, "https://northwind.wd5.myworkdayjobs.com/ext/job/Remote/Platform-Engineer_R-1001/apply", null, T0);
    expect(e).toMatchObject({ jobId: "A", site: "myworkdayjobs.com", ats: true });
    // From the applicant system on to yet another: no.
    expect(nextEntry(e, DAYFORCE, null, T0)).toBeNull();
  });
});

describe("review 3: what Claude hears of a new tab", () => {
  it("only an application, never a sign-in, a file picker or a page of the same site", () => {
    expect(worthTelling(BOARD, DAYFORCE)).toBe(true);
    expect(worthTelling("https://careers.northwind.example/apply/1", DAYFORCE)).toBe(true);
    for (const url of [
      "https://accounts.google.com/o/oauth2/v2/auth",
      "https://www.dropbox.com/chooser",
      "https://drive.google.com/picker",
      "https://login.microsoftonline.com/common/oauth2",
      "https://careers.northwind.example/privacy", // the same site's privacy page
      "https://ads.example.net/click?id=1",
      "https://www.linkedin.com/jobs/view/4000000002",
      "about:blank",
    ]) {
      expect(worthTelling("https://careers.northwind.example/apply/1", url)).toBe(false);
    }
    // From a board, still never a sign-in or a picker.
    expect(worthTelling(BOARD, "https://accounts.google.com/signin")).toBe(false);
  });
});

describe("review 5: a company link counts only when it names one posting", () => {
  const generic = { id: "G", job_listing_id: "l9", title: "Office Manager", company: "Fabrikam", location: "", url: "https://www.indeed.com/viewjob?jk=zz9", applied: false, company_url: "https://careers.fabrikam.example/login" };

  it("a learned careers home page or sign-in never steals another page", () => {
    expect(definitePosting("https://careers.fabrikam.example/login")).toBeNull();
    expect(bestJobMatch({ url: "https://careers.fabrikam.example/login", title: "Sign in" }, [generic])).toBeNull();
    expect(definitePosting(DAYFORCE)).toBeTruthy();
    expect(definitePosting("https://careers.fabrikam.example/jobs/office-manager")).toBeNull();
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
    expect(run.landed).toHaveBeenCalledWith(expect.objectContaining({ id: 9, url: DAYFORCE }), 7);
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
  async function setup({ hosts = ["linkedin.com"], runTabs = [7], tabs = {} } = {}) {
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
      tabs: { group: vi.fn(async () => 3), get: async (id) => tabs[id] || null },
    };
    const api = async (path, init) => {
      calls.push([path, init]);
      if (path === "/v1/apply/active") return { ok: true, json: async () => ({ run_id: "r1", hosts, requests: [] }) };
      return { ok: true, json: async () => ({}) };
    };
    const run = createApplyRun({ api, press: async () => ({ ok: true }), fillSession: async () => ({ frames: {} }), chrome: c });
    return { run, c, calls, session };
  }

  it("a tab of the run opens it: grouped and told only once it lands, and the run's tabs stay as they were", async () => {
    const opener = { id: 7, url: BOARD, groupId: 3 };
    const { run, c, calls, session } = await setup({ tabs: { 7: opener } });
    expect(await run.tabOpened({ id: 9, groupId: -1, url: "about:blank" }, opener)).toBe(true);
    expect(c.tabs.group).not.toHaveBeenCalled();
    await run.tabLanded({ id: 9, groupId: -1, url: DAYFORCE }, 7);
    expect(c.tabs.group).toHaveBeenCalledWith({ groupId: 3, tabIds: 9 });
    const event = calls.find(([p]) => p === "/v1/apply/runs/r1/event");
    expect(JSON.parse(event[1].body)).toEqual({ kind: "new_tab", url: DAYFORCE });
    // Never pushes the run's own tabs out of its short list.
    expect(session["je_apply_tabs:r1"]).toEqual([7]);
  });

  it("a tab in the same group as a tab of the run counts", async () => {
    const { run } = await setup({ tabs: { 7: { id: 7, url: DAYFORCE, groupId: 3 } } });
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: BOARD, groupId: 3 })).toBe(true);
  });

  it("never a tab from another page: the user's own LinkedIn group, an ungrouped tab, any page", async () => {
    const { run } = await setup({ runTabs: [7], tabs: { 7: { id: 7, url: DAYFORCE, groupId: 3 } } });
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: BOARD, groupId: 5 })).toBe(false);
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: BOARD, groupId: -1 })).toBe(false);
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: "https://news.example/", groupId: -1 })).toBe(false);
  });
});

describe("tabs: the learn and the run's hint wait for the real Apply", () => {
  const jobOf = { [BOARD]: { id: "j1" } };
  const ownMatch = async (tab) => jobOf[tab.url] || null;
  const make = (now = () => T0) => {
    const c = fakeChrome({ 7: { id: 7, url: BOARD, groupId: 3 } });
    const learnLink = vi.fn(async () => {});
    const run = { opened: vi.fn(async () => true), landed: vi.fn(async () => {}) };
    return { tj: createTabJobs({ ownMatch, learnLink, run, chrome: c, now }), learnLink, run };
  };

  it("a middle-clicked similar job B on the board in between: nothing learned, nothing told", async () => {
    const { tj, learnLink, run } = make();
    await tj.opened({ id: 9, openerTabId: 7 });
    await tj.loaded({ id: 9, url: "https://www.linkedin.com/jobs/view/4000000002" });
    await tj.loaded({ id: 9, url: "https://companyb.wd5.myworkdayjobs.com/en-US/ext/job/Remote/Dev_R-99/apply" });
    expect(learnLink).not.toHaveBeenCalled();
    expect(run.landed).not.toHaveBeenCalled();
    expect(await tj.carried({ id: 9, url: "https://companyb.wd5.myworkdayjobs.com/x" })).toBeNull();
  });

  it("a search in between: the same", async () => {
    const { tj, learnLink } = make();
    await tj.opened({ id: 9, openerTabId: 7 });
    await tj.loaded({ id: 9, url: "https://www.google.com/search?q=other+job" });
    await tj.loaded({ id: 9, url: DAYFORCE });
    expect(learnLink).not.toHaveBeenCalled();
  });

  it("a sign-in popup is never the application", async () => {
    const { tj, learnLink, run } = make();
    await tj.opened({ id: 9, openerTabId: 7 });
    await tj.loaded({ id: 9, url: "https://accounts.google.com/o/oauth2/v2/auth?client=12345" });
    expect(learnLink).not.toHaveBeenCalled();
    expect(run.landed).not.toHaveBeenCalled();
  });

  it("a careers home page with no one posting is never learned (but Claude may still hear of it)", async () => {
    const { tj, learnLink, run } = make();
    await tj.opened({ id: 9, openerTabId: 7 });
    await tj.loaded({ id: 9, url: "https://careers.northwind.example/jobs" });
    expect(learnLink).not.toHaveBeenCalled();
    expect(run.landed).toHaveBeenCalledTimes(1);
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
