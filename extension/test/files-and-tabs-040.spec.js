// Job Catcher's files and tabs (spec 040). Invented data.
// When in doubt, no carry: the usual résumé and no letter.
// - Right after the user presses an Apply that leaves (armed), a tab keeps
//   the saved job onto the company's application (Dayforce, iCIMS…), and a
//   tab it opens inherits it, so the job's own résumé and cover letter are
//   used there. Typed addresses, bookmarks, Back, ads and links in a
//   posting's text never carry or teach a link.
// - A tab LinkedIn's "Apply on company website" opens: the job learns the
//   company's link; during Apply with Claude the tab joins the run's tab
//   group and Claude hears of it, as a hint.
// - "Paste your résumé" gets the résumé's text.
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { ARM_MS, CARRY_MS, TAB_JOB, boardRedirect, carriedJobId, definitePosting, isWebPage, nextEntry, onHub, onJobBoard, postingIds, putEntry, samePosting, siteOf, worthTelling } from "../src/tabJob.js";
import { createTabJobs } from "../src/background/tabJobs.js";
import { applyLabel, isApplyPress, watchApplyPresses } from "../src/autofill/applyClick.js";
import { bestJobMatch } from "../panel/src/lib/context.ts";
import { isResumeText, resolve } from "../src/autofill/resolve.js";

const BOARD = "https://www.linkedin.com/jobs/view/4100000001/";
const DAYFORCE = "https://jobs.dayforcehcm.com/en-US/northwind/CANDIDATEPORTAL/jobs/123";
const T0 = 1_700_000_000_000;
const OPENED = { jobId: "A", at: T0, opened: true, from: "linkedin.com" };
const OWN = { jobId: "A", at: T0 }; // the job's own board page, in this tab

/** Walk a tab through pages, 30 s apart; the entry after each. */
function walk(start, urls, { armed = false } = {}) {
  let e = start;
  return urls.map((u, i) => (e = nextEntry(e, u, null, T0 + (i + 1) * 30_000, { armed: armed && i === 0 })));
}

describe("the Apply press that arms a tab (review 2: 1)", () => {
  it("only an Apply that leaves the board, by its whole label", () => {
    for (const t of ["Apply", "Apply now", "Apply on company website", "Apply on company site", "Apply for this job", "Apply to Platform Engineer on company website", "Apply now ›", "Start application", "I'm interested"]) {
      expect(applyLabel(t)).toBe(true);
    }
    for (const t of ["Easy Apply", "Apply filters", "Applying tips", "Save", "Continue", "Submit application", ""]) {
      expect(applyLabel(t)).toBe(false);
    }
    // LinkedIn's "Share your profile?" Continue opens the company's site.
    expect(applyLabel("Continue", { inShareDialog: true })).toBe(true);
  });

  it("the user's own click on such a control, never a script's", () => {
    const win = new Window({ url: "https://www.linkedin.com/jobs/view/4100000001/" });
    const doc = win.document;
    doc.body.innerHTML = `
      <button id="apply" aria-label="Apply to Platform Engineer on company website"><span>Apply</span></button>
      <button id="easy">Easy Apply</button>
      <a id="desc" href="https://northwind.example/benefits-2024">our benefits</a>
      <div role="dialog"><h2>Share your profile?</h2><button id="cont">Continue</button></div>
      <button id="cont2">Continue</button>`;
    const press = (id, isTrusted = true) => isApplyPress({ isTrusted, target: doc.querySelector(`#${id} span`) || doc.getElementById(id) });
    expect(press("apply")).toBe(true);
    expect(press("cont")).toBe(true);
    expect(press("easy")).toBe(false);
    expect(press("desc")).toBe(false);
    expect(press("cont2")).toBe(false);
    expect(press("apply", false)).toBe(false); // a script's click
    const seen = vi.fn();
    const stop = watchApplyPresses(doc, seen);
    doc.getElementById("apply").click(); // untrusted in tests: never counts
    expect(seen).not.toHaveBeenCalled();
    stop();
  });
});

describe("where a carry starts and ends", () => {
  it("job boards, aggregators, search engines and the app are where the next job is picked (8)", () => {
    for (const url of [BOARD, "https://www.indeed.com/viewjob?jk=abc", "https://uk.indeed.com/", "https://www.indeed.co.uk/", "https://www.glassdoor.co.uk/Job/index.htm", "https://www.linkedin.cn/", "https://builtin.com/jobs", "https://www.builtinnyc.com/jobs", "https://www.dice.com/jobs", "https://wellfound.com/jobs", "https://www.welcometothejungle.com/en/jobs", "https://jobright.ai/jobs", "https://app.joinhandshake.com/jobs/1", "https://www.usajobs.gov/job/1", "https://www.simplyhired.com/", "https://www.monster.com/", "https://www.careerbuilder.com/", "https://www.google.com/search?q=jobs", "https://job-enhancer-xxj1.vercel.app/jobs"]) {
      expect(onHub(url)).toBe(true);
    }
    expect(onJobBoard("https://www.glassdoor.co.uk/x")).toBe(true);
    expect(onHub(DAYFORCE)).toBe(false);
    expect(onHub("https://careers.google.com/jobs/results/1")).toBe(false);
  });

  it("an applicant system's site is its tenant or company (5)", () => {
    expect(siteOf("https://acme.wd5.myworkdayjobs.com/x")).toBe("acme.wd5.myworkdayjobs.com");
    expect(siteOf("https://boards.greenhouse.io/acme/jobs/1")).toBe("boards.greenhouse.io/acme");
    expect(siteOf("https://jobs.northwind.co.uk/x")).toBe("northwind.co.uk");
  });

  it("from the job's own page, the next site carries only right after an Apply press (1)", () => {
    expect(nextEntry(OWN, DAYFORCE, null, T0 + 1_000)).toBeNull(); // typed, bookmark, Back
    const e = nextEntry(OWN, DAYFORCE, null, T0 + 1_000, { armed: true });
    expect(e).toMatchObject({ jobId: "A", site: "jobs.dayforcehcm.com", ats: true, posting: ["123"] });
    // Even armed, never onto a site that isn't an application.
    expect(nextEntry(OWN, "https://news.example/story", null, T0, { armed: true })).toBeNull();
  });

  it("the reviewer's same-tab cases: typed careers, a bookmarked aggregator, Back", () => {
    expect(walk(OWN, ["https://careers.globex.example/jobs/search", "https://careers.globex.example/jobs/98765/data-engineer"]).every((e) => e === null)).toBe(true);
    expect(walk(OWN, ["https://builtin.com/jobs/remote", "https://builtin.com/job/data-engineer/4455667"]).every((e) => e === null)).toBe(true);
  });

  it("every page on the site restarts the 45 minutes (7)", () => {
    let e = nextEntry(OWN, DAYFORCE, null, T0, { armed: true });
    e = nextEntry(e, `${DAYFORCE}/step2`, null, T0 + CARRY_MS - 1_000);
    expect(e?.at).toBe(T0 + CARRY_MS - 1_000);
    expect(nextEntry(e, `${DAYFORCE}/step3`, null, T0 + 2 * CARRY_MS - 2_000)).not.toBeNull();
    expect(nextEntry(e, `${DAYFORCE}/step3`, null, T0 + 2 * CARRY_MS + 1)).toBeNull();
    expect(CARRY_MS).toBe(45 * 60_000);
    expect(ARM_MS).toBe(20_000);
  });

  it("about:blank and chrome:// pages change nothing (12)", () => {
    const e = nextEntry(OWN, DAYFORCE, null, T0, { armed: true });
    expect(isWebPage("about:blank")).toBe(false);
    expect(nextEntry(e, "about:blank", null, T0)).toBe(e);
    expect(nextEntry(e, "chrome://newtab/", null, T0)).toBe(e);
  });

  it("keeps a few tabs, newest last", () => {
    let map = {};
    for (let i = 0; i < 60; i++) map = putEntry(map, i, { jobId: `j${i}`, at: T0 });
    expect(Object.keys(map)).toHaveLength(50);
    expect(putEntry(map, 59, null)[59]).toBeUndefined();
  });
});

describe("a new tab keeps its job only through its own board's redirect", () => {
  it("LinkedIn's and Indeed's redirects keep it, their query ids aside (10)", () => {
    for (const url of ["https://www.linkedin.com/redir/redirect?url=x", "https://www.linkedin.com/safety/go?url=x", "https://www.linkedin.com/jobs/view/externalApply/4100000001?url=x"]) {
      expect(nextEntry(OPENED, url, null, T0)).toBe(OPENED);
    }
    const indeed = { ...OPENED, from: "indeed.com" };
    expect(boardRedirect("indeed.com", "https://www.indeed.com/applystart?jk=a123c3d4e5f6a7b8")).toBe(true);
    expect(nextEntry(indeed, "https://www.indeed.com/rc/clk?jk=a123c3d4", null, T0)).toBe(indeed);
  });

  it("another posting, another board, a search or a new tab page ends it", () => {
    for (const url of ["https://www.linkedin.com/jobs/view/4000000002", "https://www.linkedin.com/feed/", "https://www.indeed.com/rc/clk?jk=abc", "https://www.google.com/search?q=northwind"]) {
      expect(nextEntry(OPENED, url, null, T0 + 5_000)).toBeNull();
    }
  });

  it("B's posting, then B's application, is never A's", () => {
    const [b, app] = walk(OPENED, ["https://www.linkedin.com/jobs/view/4000000002", "https://companyb.wd5.myworkdayjobs.com/en-US/ext/job/Remote/Dev_R-99/apply"]);
    expect(b).toBeNull();
    expect(app).toBeNull();
  });

  it("LinkedIn → Workday: sign-in, account, steps, reload and the home page keep it", () => {
    const steps = walk(OPENED, [
      "https://www.linkedin.com/redir/redirect?url=x",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/login?redirect=%2Fjob%2FIT-Analyst_JR-1234%2Fapply",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/createAccount",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=1",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply/autofillWithResume",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/userHome",
    ]);
    expect(steps.every((e) => e?.jobId === "A")).toBe(true);
    expect(steps.at(-1).site).toBe("acme.wd5.myworkdayjobs.com");
  });
});

describe("one posting's steps keep the carry; another posting ends it (3)", () => {
  const steps = {
    iCIMS: ["https://careers-acme.icims.com/jobs/12345/it-analyst/job?mode=job&iis=LinkedIn", "https://careers-acme.icims.com/jobs/12345/it-analyst/login?back=intro", "https://careers-acme.icims.com/jobs/12345/it-analyst/candidate?mode=apply"],
    Taleo: ["https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345&lang=en", "https://acme.taleo.net/careersection/2/jobapply.ftl?job=12345&lang=en", "https://acme.taleo.net/careersection/2/flow.jsf?lang=en"],
    Paylocity: ["https://recruiting.paylocity.com/Recruiting/Jobs/Details/12345", "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/12345"],
    UKG: ["https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=aaaabbbb-1111-2222-3333-444455556666", "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/Apply/OpportunityApply?opportunityId=aaaabbbb-1111-2222-3333-444455556666"],
    Dayforce: [DAYFORCE, `${DAYFORCE}/step2`],
  };
  for (const [name, urls] of Object.entries(steps)) {
    it(`${name}: every step carries the job`, () => {
      const out = walk(OPENED, urls);
      expect(out.map((e) => e?.jobId)).toEqual(urls.map(() => "A"));
    });
  }

  it("another posting on the same site, a #route included, ends it", () => {
    expect(walk(OPENED, [DAYFORCE, "https://jobs.dayforcehcm.com/en-US/northwind/CANDIDATEPORTAL/jobs/456"])[1]).toBeNull();
    expect(walk(OPENED, ["https://careers.acme.example/#/jobs/123", "https://careers.acme.example/#/jobs/456"])[1]).toBeNull();
    const ukgOther = steps.UKG[1].replace("aaaabbbb-1111", "ccccdddd-1111");
    expect(walk(OPENED, [steps.UKG[0], ukgOther])[1]).toBeNull();
  });

  it("ids, not paths, decide (Indeed's jk is an id)", () => {
    expect(postingIds("https://acme.wd5.myworkdayjobs.com/x/job/Portland/IT-Analyst_JR-1234/apply")).toEqual(["jr1234"]);
    expect(postingIds("https://www.indeed.com/viewjob?jk=a1b2c3d4e5f6a7b8")).toContain("a1b2c3d4e5f6a7b8");
    expect(postingIds("https://acme.taleo.net/careersection/2/flow.jsf?lang=en&ts=1700000000")).toEqual([]);
    expect(samePosting(["12345"], [])).toBe(true);
    expect(samePosting(["12345"], ["12345", "job=12345"])).toBe(true);
    expect(samePosting(["12345"], ["678"])).toBe(false);
    expect(definitePosting(DAYFORCE)).toBe(true);
    expect(definitePosting("https://careers.fabrikam.example/login")).toBe(false);
  });
});

describe("the company's site hands over to its applicant system (4)", () => {
  const posting = "https://careers.acme.example/job/12345/it-analyst";
  const workday = "https://acme.wd5.myworkdayjobs.com/External/job/Portland/IT-Analyst_JR-1234/apply";

  it("straight from the posting's page, after an Apply press there", () => {
    const e = nextEntry(OPENED, posting, null, T0);
    expect(nextEntry(e, workday, null, T0 + 30_000, { armed: true })).toMatchObject({ jobId: "A", site: "acme.wd5.myworkdayjobs.com" });
    // With a sign-in on the way.
    const after = nextEntry(nextEntry(e, workday, null, T0 + 30_000, { armed: true }), "https://acme.okta.com/login", null, T0 + 60_000);
    expect(nextEntry(after, `${workday}/applyManually`, null, T0 + 90_000)?.jobId).toBe("A");
  });

  it("never without a press, after more than 2 minutes, or from another page of the site", () => {
    const e = nextEntry(OPENED, posting, null, T0);
    expect(nextEntry(e, workday, null, T0 + 30_000)).toBeNull();
    expect(nextEntry(e, workday, null, T0 + 3 * 60_000, { armed: true })).toBeNull();
    const list = nextEntry(e, "https://careers.acme.example/search-results?keywords=", null, T0 + 30_000);
    expect(nextEntry(list, "https://acme.wd5.myworkdayjobs.com/External/job/Austin/Sales-Rep_JR-9999/apply", null, T0 + 60_000, { armed: true })).toBeNull();
  });

  it("never with no posting held, never from one applicant system to another", () => {
    const landing = nextEntry(OPENED, "https://boards.greenhouse.io/acme", null, T0);
    expect(nextEntry(landing, "https://boards.greenhouse.io/globex/jobs/7777777", null, T0 + 1_000, { armed: true })).toBeNull();
    const wd = nextEntry(OPENED, workday, null, T0);
    expect(nextEntry(wd, DAYFORCE, null, T0 + 1_000, { armed: true })).toBeNull();
    const noPosting = nextEntry(OPENED, "https://careers.acme.example/jobs", null, T0);
    expect(nextEntry(noPosting, workday, null, T0 + 1_000, { armed: true })).toBeNull();
  });
});

describe("bestJobMatch with a carried job", () => {
  const A = { id: "A", job_listing_id: "l1", title: "IT Analyst", company: "Acme", location: "", url: "https://www.linkedin.com/jobs/view/4100000001/", applied: false, company_url: "https://acme.wd5.myworkdayjobs.com/External/job/Portland/IT-Analyst_JR-1234" };
  const B = { id: "B", job_listing_id: "l2", title: "Sales Rep", company: "Acme", location: "", url: "https://www.linkedin.com/jobs/view/4100000002/", applied: false };

  it("never onto another posting of the job's own system (2)", () => {
    expect(bestJobMatch({ url: "https://acme.wd5.myworkdayjobs.com/External/job/Austin/Sales-Rep_JR-9999/apply", title: "Workday" }, [A, B], [], undefined, "A")).toBeNull();
    expect(bestJobMatch({ url: "https://acme.wd5.myworkdayjobs.com/External/userHome", title: "Workday" }, [A, B], [], undefined, "A")?.id).toBe("A");
  });

  it("the company's application, a later step included, is the job's page (no carry needed)", () => {
    expect(bestJobMatch({ url: `${A.company_url}/apply/applyManually`, title: "Workday" }, [A, B])?.id).toBe("A");
  });

  it("a company link naming no posting never counts (5)", () => {
    const G = { ...B, id: "G", company_url: "https://careers.fabrikam.example/login" };
    expect(bestJobMatch({ url: "https://careers.fabrikam.example/login", title: "Sign in" }, [G])).toBeNull();
  });

  it("a Submit is tracked for the page's own job only (no carry)", () => {
    expect(bestJobMatch({ url: "https://other.icims.com/jobs/555/job", title: "Apply" }, [A, B])).toBeNull();
  });
});

describe("what Claude hears of a new tab (3)", () => {
  it("only an application, never a sign-in, a file picker or the same site's page", () => {
    expect(worthTelling(BOARD, DAYFORCE)).toBe(true);
    expect(worthTelling("https://careers.northwind.example/apply/1", DAYFORCE)).toBe(true);
    for (const url of ["https://accounts.google.com/o/oauth2/v2/auth", "https://www.dropbox.com/chooser", "https://drive.google.com/picker", "https://login.microsoftonline.com/common/oauth2", "https://careers.northwind.example/privacy", "https://ads.example.net/click?id=1", "https://www.linkedin.com/jobs/view/4000000002", "about:blank"]) {
      expect(worthTelling("https://careers.northwind.example/apply/1", url)).toBe(false);
    }
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

describe("tabs and the jobs they apply for (background)", () => {
  const jobOf = { [BOARD]: { id: "A" } };
  const ownMatch = async (tab) => jobOf[tab.url] || null;
  const make = ({ now = () => T0, tabs = { 7: { id: 7, url: BOARD, groupId: 3 } } } = {}) => {
    const c = fakeChrome(tabs);
    const learnLink = vi.fn(async () => {});
    const run = { opened: vi.fn(async () => true), landed: vi.fn(async () => {}) };
    return { c, learnLink, run, tj: createTabJobs({ ownMatch, learnLink, run, chrome: c, now }) };
  };

  it("same tab: only after an Apply press does the company's page carry the job", async () => {
    const { tj } = make();
    await tj.loaded({ id: 7, url: BOARD });
    await tj.loaded({ id: 7, url: DAYFORCE });
    expect(await tj.carried({ id: 7, url: DAYFORCE })).toBeNull();
    await tj.loaded({ id: 7, url: BOARD });
    await tj.arm(7);
    await tj.loaded({ id: 7, url: DAYFORCE });
    expect(await tj.carried({ id: 7, url: DAYFORCE })).toBe("A");
    await tj.closed(7);
    expect(await tj.carried({ id: 7, url: DAYFORCE })).toBeNull();
  });

  it("Back to a page of another job never carries (no press)", async () => {
    const { tj } = make();
    await tj.loaded({ id: 3, url: "https://careers.globex.example/jobs/98765/data-engineer" });
    await tj.loaded({ id: 3, url: BOARD });
    await tj.loaded({ id: 3, url: "https://careers.globex.example/jobs/98765/data-engineer" });
    expect(await tj.carried({ id: 3, url: "https://careers.globex.example/jobs/98765/data-engineer/apply" })).toBeNull();
  });

  it("a new tab after the Apply press: carries, learns the company link once, tells the run", async () => {
    const { tj, learnLink, run } = make();
    await tj.arm(7);
    const tab = { id: 9, openerTabId: 7, url: "about:blank" };
    // Its first page can load before the opening is noted: one at a time.
    await Promise.all([tj.opened(tab), tj.loaded({ id: 9, url: "about:blank" }), tj.loaded({ id: 9, url: "https://www.linkedin.com/redir/redirect?url=x" }), tj.loaded({ id: 9, url: DAYFORCE })]);
    expect(learnLink).toHaveBeenCalledTimes(1);
    expect(learnLink).toHaveBeenCalledWith("A", DAYFORCE);
    expect(run.landed).toHaveBeenCalledWith(expect.objectContaining({ id: 9, url: DAYFORCE }), 7);
    expect(await tj.carried({ id: 9, url: DAYFORCE })).toBe("A");
    await tj.loaded({ id: 9, url: `${DAYFORCE}/step2` });
    expect(await tj.carried({ id: 9, url: `${DAYFORCE}/step2` })).toBe("A");
    expect(learnLink).toHaveBeenCalledTimes(1);
  });

  it("a press heard a moment after the tab opened still counts", async () => {
    const { tj, learnLink } = make();
    const opening = tj.opened({ id: 9, openerTabId: 7 });
    setTimeout(() => tj.arm(7), 100);
    await opening;
    await tj.loaded({ id: 9, url: DAYFORCE });
    expect(learnLink).toHaveBeenCalledWith("A", DAYFORCE);
  });

  it("a middle-clicked link in the posting, an ad (no press): no carry, nothing learned", async () => {
    const { tj, learnLink } = make();
    await tj.opened({ id: 9, openerTabId: 7 });
    await tj.loaded({ id: 9, url: "https://www.linkedin.com/redir/redirect?url=x" });
    await tj.loaded({ id: 9, url: "https://careers.acme.example/benefits-2024" });
    expect(learnLink).not.toHaveBeenCalled();
    expect(await tj.carried({ id: 9, url: "https://careers.acme.example/benefits-2024" })).toBeNull();
  });

  it("a similar job B, or a search, in between: nothing learned, nothing carried", async () => {
    for (const between of ["https://www.linkedin.com/jobs/view/4000000002", "https://www.google.com/search?q=other+job"]) {
      const { tj, learnLink, run } = make();
      await tj.arm(7);
      await tj.opened({ id: 9, openerTabId: 7 });
      await tj.loaded({ id: 9, url: between });
      await tj.loaded({ id: 9, url: "https://companyb.wd5.myworkdayjobs.com/en-US/ext/job/Remote/Dev_R-99/apply" });
      expect(learnLink).not.toHaveBeenCalled();
      expect(run.landed).not.toHaveBeenCalled();
      expect(await tj.carried({ id: 9, url: "https://companyb.wd5.myworkdayjobs.com/x" })).toBeNull();
    }
  });

  it("a sign-in popup, or a careers home page with no posting, is never learned", async () => {
    for (const url of ["https://accounts.google.com/o/oauth2/v2/auth?client=12345", "https://careers.northwind.example/jobs"]) {
      const { tj, learnLink } = make();
      await tj.arm(7);
      await tj.opened({ id: 9, openerTabId: 7 });
      await tj.loaded({ id: 9, url });
      expect(learnLink).not.toHaveBeenCalled();
    }
  });

  it("a press more than 20 s old, or a new tab after a minute, is no Apply", async () => {
    let now = T0;
    const { tj, learnLink } = make({ now: () => now });
    await tj.arm(7);
    now += ARM_MS + 1;
    await tj.opened({ id: 9, openerTabId: 7 });
    await tj.loaded({ id: 9, url: DAYFORCE });
    expect(learnLink).not.toHaveBeenCalled();
    await tj.arm(7);
    await tj.opened({ id: 10, openerTabId: 7 });
    now += 61_000;
    await tj.loaded({ id: 10, url: DAYFORCE });
    expect(learnLink).not.toHaveBeenCalled();
  });
});

describe("Apply with Claude: a tab opened from the application's tab", () => {
  async function setup({ hosts = ["linkedin.com"], runTabs = [7], tabs = {}, group = async () => 3 } = {}) {
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
      tabs: { group: vi.fn(group), get: async (id) => tabs[id] || null },
    };
    const api = async (path, init) => {
      calls.push([path, init]);
      if (path === "/v1/apply/active") return { ok: true, json: async () => ({ run_id: "r1", hosts, requests: [] }) };
      return { ok: true, json: async () => ({}) };
    };
    const run = createApplyRun({ api, press: async () => ({ ok: true }), fillSession: async () => ({ frames: {} }), chrome: c });
    const event = () => JSON.parse(calls.find(([p]) => p === "/v1/apply/runs/r1/event")[1].body);
    return { run, c, calls, session, event };
  }

  it("a tab of the run opens it: grouped and told once it lands; the run's tabs stay as they were", async () => {
    const opener = { id: 7, url: BOARD, groupId: 3 };
    const { run, c, session, event } = await setup({ tabs: { 7: opener } });
    expect(await run.tabOpened({ id: 9, groupId: -1 }, opener)).toBe(true);
    expect(c.tabs.group).not.toHaveBeenCalled();
    await run.tabLanded({ id: 9, groupId: -1, url: DAYFORCE }, 7);
    expect(c.tabs.group).toHaveBeenCalledWith({ groupId: 3, tabIds: 9 });
    expect(event()).toEqual({ kind: "new_tab", url: DAYFORCE, grouped: true });
    expect(session["je_apply_tabs:r1"]).toEqual([7]);
  });

  it("says when it couldn't be grouped (11)", async () => {
    const opener = { id: 7, url: BOARD, groupId: 3 };
    const { run, event } = await setup({ tabs: { 7: opener }, group: async () => Promise.reject(new Error("no")) });
    await run.tabLanded({ id: 9, groupId: -1, url: DAYFORCE }, 7);
    expect(event().grouped).toBe(false);
  });

  it("a tab in the same group as a tab of the run counts", async () => {
    const { run } = await setup({ tabs: { 7: { id: 7, url: DAYFORCE, groupId: 3 } } });
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: BOARD, groupId: 3 })).toBe(true);
  });

  it("never the user's own LinkedIn group, an ungrouped tab or any page", async () => {
    const { run } = await setup({ tabs: { 7: { id: 7, url: DAYFORCE, groupId: 3 } } });
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: BOARD, groupId: 5 })).toBe(false);
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: BOARD, groupId: -1 })).toBe(false);
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: "https://news.example/", groupId: -1 })).toBe(false);
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
