// Job Catcher's files and tabs (spec 040). Invented data.
// Never a guess: right after the user's own press on an Apply on a saved
// job's own page, the side panel asks "Applying for <job>?" on the next
// page that names no job; only Yes binds the tab to it (its résumé, cover
// letter, Submit and company link), while the tab stays on that
// application. Every other path ends with no binding.
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { BIND_MS, OPEN_MS, TAB_JOB, askAbout, bindHere, boundJobId, isWebPage, keepBinding, onHub, onJobBoard, otherPosting, postingIds, putEntry, sameApplication, siteOf, worthTelling } from "../src/tabJob.js";
import { createTabJobs } from "../src/background/tabJobs.js";
import { applyLabel, isApplyPress, watchApplyPresses } from "../src/autofill/applyClick.js";
import { bestJobMatch } from "../panel/src/lib/context.ts";
import { isResumeText, resolve } from "../src/autofill/resolve.js";

const LI_A = "https://www.linkedin.com/jobs/view/4100000001/";
const T0 = 1_700_000_000_000;
const PRESS = { jobId: "A", at: T0 };

/** Say Yes on the first page, then walk the rest 30 s apart: the job bound on each. */
function yesThen(urls) {
  let b = bindHere("A", urls[0], T0);
  return [boundJobId(b, urls[0], T0), ...urls.slice(1).map((u, i) => boundJobId((b = keepBinding(b, u, T0 + (i + 1) * 30_000)), u, T0 + (i + 1) * 30_000))];
}

describe("the Apply press: a hint only", () => {
  it("only an Apply by its whole label, never Easy Apply or Apply filters", () => {
    for (const t of ["Apply", "Apply now", "Apply on company website", "Apply on company site", "Apply for this job", "Apply to Platform Engineer on company website", "Apply now ›", "Start application", "I'm interested"]) {
      expect(applyLabel(t)).toBe(true);
    }
    for (const t of ["Easy Apply", "Apply filters", "Applying tips", "Save", "Continue", "Submit application", "Apply Now - Enroll Today", ""]) {
      expect(applyLabel(t)).toBe(false);
    }
    expect(applyLabel("Continue", { inShareDialog: true })).toBe(true);
  });

  it("the user's own click only (never a script's), inside a shadow root too", () => {
    const win = new Window({ url: LI_A });
    const doc = win.document;
    doc.body.innerHTML = `<button id="apply" aria-label="Apply to Platform Engineer on company website"><span>Apply</span></button>
      <button id="easy">Easy Apply</button><a id="desc" href="https://northwind.example/benefits-2024">our benefits</a>
      <div role="dialog"><h2>Share your profile?</h2><button id="cont">Continue</button></div><div id="host"></div>`;
    const shadow = doc.getElementById("host").attachShadow({ mode: "open" });
    shadow.innerHTML = `<button id="sapply"><span id="inner">Apply now</span></button>`;
    const inner = shadow.getElementById("inner");
    const press = (target, isTrusted = true, path) => isApplyPress({ isTrusted, target, composedPath: path ? () => path : undefined });
    expect(press(doc.querySelector("#apply span"))).toBe(true);
    expect(press(doc.getElementById("cont"))).toBe(true);
    expect(press(doc.getElementById("easy"))).toBe(false);
    expect(press(doc.getElementById("desc"))).toBe(false);
    expect(press(doc.querySelector("#apply span"), false)).toBe(false);
    // A shadow root's button: found on the click's path.
    expect(press(doc.getElementById("host"), true, [inner, shadow.getElementById("sapply"), shadow, doc.getElementById("host"), doc.body])).toBe(true);
    const seen = vi.fn();
    const stop = watchApplyPresses(doc, seen);
    doc.getElementById("apply").click(); // untrusted
    expect(seen).not.toHaveBeenCalled();
    stop();
  });
});

describe("when the panel asks", () => {
  const WD = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234";
  it("on the next application page within 45 minutes, never on a saved job's own page, a board, a sign-in or a news site", () => {
    expect(askAbout(PRESS, WD, null, T0 + 1_000)).toBe("A");
    expect(askAbout(PRESS, WD, null, T0 + BIND_MS + 1)).toBeNull();
    expect(askAbout(PRESS, WD, "B", T0)).toBeNull();
    expect(askAbout(PRESS, LI_A, null, T0)).toBeNull();
    expect(askAbout(PRESS, "https://accounts.google.com/o/oauth2", null, T0)).toBeNull();
    expect(askAbout(PRESS, "https://news.example/story", null, T0)).toBeNull();
    expect(askAbout(null, WD, null, T0)).toBeNull();
    expect(OPEN_MS).toBe(20_000);
  });
});

describe("good path: Yes, then every step keeps the job", () => {
  const paths = {
    Workday: [
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/login?redirect=%2Fen-US%2FExternal%2Fjob%2FPortland-OR%2FIT-Analyst_JR-1234%2Fapply",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=1",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply/applyManually",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/userHome",
    ],
    iCIMS: [
      "https://careers-acme.icims.com/jobs/12345/it-analyst/job?mode=job&iis=LinkedIn&mobile=false&width=1200&jan1offset=-300",
      "https://careers-acme.icims.com/jobs/12345/it-analyst/candidate?mode=apply&iis=LinkedIn",
      "https://careers-acme.icims.com/jobs/candidate?from=login&eem=abc&code=123",
      "https://careers-acme.icims.com/jobs/12345/it-analyst/candidate?mode=submit_apply",
    ],
    Taleo: [
      "https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=2400123&tz=GMT-05%3A00",
      "https://acme.taleo.net/careersection/ex/jobapply.ftl?job=2400123&lang=en",
      "https://acme.taleo.net/careersection/ex/flow.jsf?lang=en",
    ],
    Paylocity: ["https://recruiting.paylocity.com/Recruiting/Jobs/Details/2345678", "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/2345678"],
    UKG: [
      "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=aaaabbbb-1111-2222-3333-444455556666",
      "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/Apply/OpportunityApply?opportunityId=aaaabbbb-1111-2222-3333-444455556666",
      "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/Account/SignIn?ReturnUrl=x",
    ],
    Dayforce: [
      "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345",
      "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345/apply",
      "https://candidate.dayforcehcm.com/CandidatePortal/en-US/acme/Account/Login",
      "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345/apply?step=2",
    ],
    Greenhouse: ["https://boards.greenhouse.io/acme/jobs/4455667?gh_src=li", "https://boards.greenhouse.io/acme/jobs/4455667#app", "https://boards.greenhouse.io/acme/jobs/4455667/confirmation"],
    Lever: [
      "https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666?lever-source=LinkedIn",
      "https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666/apply",
      "https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666/thanks",
    ],
  };
  for (const [name, urls] of Object.entries(paths)) {
    it(`${name}: every step keeps A`, () => {
      expect(askAbout(PRESS, urls[0], null, T0)).toBe("A");
      expect(yesThen(urls)).toEqual(urls.map((u) => (/accounts\.google/.test(u) ? null : "A")));
    });
  }

  it("each page on it restarts the 45 minutes; about:blank changes nothing", () => {
    const url = paths.Workday[0];
    let b = bindHere("A", url, T0);
    b = keepBinding(b, `${url}/apply`, T0 + BIND_MS - 1_000);
    expect(b?.at).toBe(T0 + BIND_MS - 1_000);
    expect(keepBinding(b, `${url}/apply`, T0 + 2 * BIND_MS)).toBeNull();
    expect(keepBinding(b, "about:blank", T0 + BIND_MS)).toBe(b);
    expect(isWebPage("chrome://newtab/")).toBe(false);
  });
});

describe("reviewer scenarios: another posting or company drops the binding", () => {
  it("shared digit runs never make postings the same: 2026 interns, a zip, a store number, a slug's year", () => {
    const A = postingIds("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Software-Engineer-Intern---Summer-2026_R-123");
    const B = postingIds("https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Data-Science-Intern---Summer-2026_R-456/apply");
    expect(otherPosting(A, B)).toBe(true);
    expect(otherPosting(postingIds("https://acme.wd5.myworkdayjobs.com/External/job/Portland-OR-97201/IT-Analyst_R-1234"), postingIds("https://acme.wd5.myworkdayjobs.com/External/job/Portland-OR-97201/Sales_R-5678"))).toBe(true);
    expect(otherPosting(postingIds("https://acme.wd1.myworkdayjobs.com/Retail/job/Store-0423-Austin-TX/Sales-Associate_R-111"), postingIds("https://acme.wd1.myworkdayjobs.com/Retail/job/Store-0423-Austin-TX/Shift-Lead_R-222"))).toBe(true);
    expect(otherPosting(postingIds("https://careers.acme.com/job/12345/analyst-2026"), postingIds("https://careers.acme.com/job/67890/engineer-2026"))).toBe(true);
    expect(postingIds("https://acme.wd5.myworkdayjobs.com/External/job/Portland-OR-97201/IT-Analyst_R-1234")).toEqual({ strong: ["r1234"], weak: [] });
  });

  it("strong ids: SuccessFactors career_job_req_id, Indeed's vjk like jk, UKG's opportunityId", () => {
    expect(postingIds("https://career4.successfactors.com/career?company=acmeP&career_job_req_id=12345").strong).toEqual(["career_job_req_id=12345"]);
    expect(postingIds("https://www.indeed.com/viewjob?vjk=a1b2c3").strong).toEqual(["jk=a1b2c3"]);
    const ukg = (opp) => postingIds(`https://recruiting.ultipro.com/ACM1/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=${opp}`);
    expect(otherPosting(ukg("aaaabbbb-1111-2222-3333-444455556666"), ukg("cccccccc-1111-2222-3333-444455556666"))).toBe(true);
  });

  it("each scenario ends with no binding", () => {
    const wdA = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Software-Engineer-Intern---Summer-2026_R-123";
    for (const [first, next] of [
      [wdA, "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Data-Science-Intern---Summer-2026_R-456"],
      ["https://wd5.myworkdaysite.com/recruiting/acme/External", "https://wd5.myworkdaysite.com/recruiting/globex/External/job/Remote/Dev_R-9/apply"],
      ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL", "https://jobs.dayforcehcm.com/en-US/globex/CANDIDATEPORTAL/jobs/555"],
      ["https://career4.successfactors.com/career?company=acmeP&career_job_req_id=12345", "https://career4.successfactors.com/career?company=globexP&career_job_req_id=67890"],
      ["https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/", "https://recruiting.ultipro.com/GLX2000GLOBX/JobBoard/9f1e2d3c-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=dd"],
      ["https://myjobs.adp.com/acme/cx/job-details?reqId=111", "https://myjobs.adp.com/globex/cx/job-details?reqId=222"],
      ["https://recruiting.paylocity.com/Recruiting/Jobs/Details/2345678", "https://recruiting.paylocity.com/Recruiting/Jobs/Details/99999"],
      // A company posting, then a "Similar jobs" link to another job's Workday.
      ["https://careers.acme.com/job/12345/it-analyst", "https://acme.wd5.myworkdayjobs.com/External/job/Austin/Sales-Rep_JR-9999/apply"],
      // Yes on a landing page that names no posting: no posting is taken on.
      ["https://acme.wd5.myworkdayjobs.com/en-US/External", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Sales_JR-9999/apply"],
      ["https://boards.greenhouse.io/acme", "https://boards.greenhouse.io/globex/jobs/7777777"],
      ["https://careers.acme.com/#/jobs/123", "https://careers.acme.com/#/jobs/456"],
      // Back to a board, a search, a typed address on another site.
      [wdA, "https://www.linkedin.com/jobs/view/4000000002"],
      [wdA, "https://www.google.com/search?q=jobs"],
      [wdA, "https://careers-globex.icims.com/jobs/555/x/job"],
      // Workday posting → its search → another posting.
      [wdA, "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Sales_JR-9999"],
    ]) {
      expect([first, next, yesThen([first, next])[1]]).toEqual([first, next, null]);
    }
  });

  it("shared hosts are told apart by company", () => {
    for (const [a, b] of [
      ["https://wd5.myworkdaysite.com/recruiting/acme/External", "https://wd5.myworkdaysite.com/recruiting/globex/External/job/X_R-9"],
      ["https://recruiting.paylocity.com/Recruiting/Jobs/All/aaaa1111-1111-2222-3333-444455556666", "https://recruiting.paylocity.com/Recruiting/Jobs/Details/99999"],
      ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL", "https://jobs.dayforcehcm.com/en-US/globex/CANDIDATEPORTAL/jobs/555"],
      ["https://recruiting.ultipro.com/ACM1000ACME/JobBoard/x/", "https://recruiting.ultipro.com/GLX2000GLOBX/JobBoard/y/"],
      ["https://career4.successfactors.com/career?company=acmeP", "https://career4.successfactors.com/career?company=globexP"],
      ["https://myjobs.adp.com/acme/cx", "https://myjobs.adp.com/globex/cx"],
      ["https://acme.wd5.myworkdayjobs.com/External", "https://globex.wd5.myworkdayjobs.com/External/job/X_R-9"],
    ]) {
      expect(siteOf(a)).not.toBe(siteOf(b));
    }
    expect(siteOf("https://candidate.dayforcehcm.com/CandidatePortal/en-US/acme/Account/Login")).toBe(siteOf("https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/1"));
  });

  it("job boards, aggregators, search engines and the app", () => {
    for (const url of [LI_A, "https://uk.indeed.com/", "https://www.indeed.co.uk/", "https://www.glassdoor.co.uk/Job/index.htm", "https://www.linkedin.cn/", "https://builtin.com/jobs", "https://www.dice.com/jobs", "https://wellfound.com/jobs", "https://www.usajobs.gov/job/1", "https://www.google.com/search?q=jobs", "https://job-enhancer-xxj1.vercel.app/jobs"]) {
      expect(onHub(url)).toBe(true);
    }
    expect(onJobBoard("https://www.glassdoor.co.uk/x")).toBe(true);
    expect(onHub("https://careers.google.com/jobs/results/1")).toBe(false);
  });

  it("keeps a few tabs, newest last", () => {
    let map = {};
    for (let i = 0; i < 60; i++) map = putEntry(map, i, { jobId: `j${i}`, at: T0 });
    expect(Object.keys(map)).toHaveLength(50);
    expect(putEntry(map, 59, null)[59]).toBeUndefined();
  });
});

describe("the company's application in the matcher: strong ids only", () => {
  const wdA = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Software-Engineer-Intern---Summer-2026_R-123";
  const A = { id: "A", job_listing_id: "1", title: "Software Engineer Intern", company: "Acme", location: "", url: LI_A, applied: false, company_url: wdA };
  const B = { id: "B", job_listing_id: "2", title: "Data Science Intern", company: "Globex", location: "", url: "https://www.linkedin.com/jobs/view/4100000002/", applied: false };

  it("another 2026 intern posting, another careers job, another UKG opportunity or its board home: not A", () => {
    expect(bestJobMatch({ url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Data-Science-Intern---Summer-2026_R-456/apply", title: "Workday" }, [A, B])).toBeNull();
    const A3 = { ...A, company_url: "https://careers.acme.com/job/12345/analyst-2026" };
    expect(bestJobMatch({ url: "https://careers.acme.com/job/67890/engineer-2026", title: "x" }, [A3])).toBeNull();
    // Plain digits never name a company application for sure, even the same.
    expect(sameApplication(A3.company_url, "https://careers.acme.com/job/12345/analyst-2026/apply")).toBe(false);
    const A4 = { ...A, company_url: "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=aaaabbbb-1111-2222-3333-444455556666" };
    expect(bestJobMatch({ url: A4.company_url.replace("aaaabbbb", "cccccccc"), title: "x" }, [A4])).toBeNull();
    expect(bestJobMatch({ url: "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/", title: "x" }, [A4])).toBeNull();
  });

  it("the same posting's later step is A", () => {
    expect(bestJobMatch({ url: `${wdA}/apply/applyManually`, title: "Workday" }, [A, B])?.id).toBe("A");
  });

  it("the bound job, never onto another posting of its own system", () => {
    expect(bestJobMatch({ url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Other_R-999/apply", title: "Workday" }, [A, B], [], undefined, "A")).toBeNull();
    expect(bestJobMatch({ url: "https://acme.wd5.myworkdayjobs.com/en-US/External/userHome", title: "Workday" }, [A, B], [], undefined, "A")?.id).toBe("A");
  });
});

describe("what Claude hears of a new tab", () => {
  it("only an application, never a sign-in, a file picker or the same site's page", () => {
    const DF = "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345";
    expect(worthTelling(LI_A, DF)).toBe(true);
    for (const url of ["https://accounts.google.com/o/oauth2/v2/auth", "https://www.dropbox.com/chooser", "https://careers.northwind.example/privacy", "https://ads.example.net/click?id=1", "about:blank"]) {
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

describe("the background: press, question, Yes", () => {
  const WD = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234";
  const jobOf = { [LI_A]: { id: "A" } };
  const ownMatch = async (tab) => jobOf[tab.url] || null;
  const make = ({ now = () => T0 } = {}) => {
    const c = fakeChrome({ 1: { id: 1, url: LI_A, groupId: -1 } });
    const learnLink = vi.fn(async () => {});
    const run = { opened: vi.fn(async () => false), landed: vi.fn(async () => {}) };
    return { c, learnLink, run, tj: createTabJobs({ ownMatch, learnLink, run, chrome: c, now }) };
  };
  const tab = (id, url) => ({ id, url });

  it("good path: a press in A's listing, a new tab lands on Workday, Yes binds it and teaches the link", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.opened({ id: 2, openerTabId: 1 });
    await tj.loaded(tab(2, WD));
    expect(await tj.carried(tab(2, WD))).toBeNull(); // nothing until Yes
    expect(await tj.question(tab(2, WD))).toBe("A");
    expect(await tj.answer(tab(2, WD), true)).toBe("A");
    expect(learnLink).toHaveBeenCalledWith("A", WD);
    expect(await tj.question(tab(2, WD))).toBeNull();
    for (const step of [`${WD}/apply`, `${WD}/apply/applyManually`]) {
      await tj.loaded(tab(2, step));
      expect(await tj.carried(tab(2, step))).toBe("A");
    }
  });

  it("No: no binding, nothing learned, and no question again without a new press", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    expect(await tj.answer(tab(1, WD), false)).toBeNull();
    expect(await tj.carried(tab(1, WD))).toBeNull();
    expect(await tj.question(tab(1, WD))).toBeNull();
    expect(learnLink).not.toHaveBeenCalled();
  });

  it("a press in a frame (an ad), or on a page that is no saved job, is no press", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_A), 3);
    await tj.loaded(tab(1, WD));
    expect(await tj.question(tab(1, WD))).toBeNull();
    await tj.pressed(tab(5, "https://news.example/"), 0);
    await tj.loaded(tab(5, WD));
    expect(await tj.question(tab(5, WD))).toBeNull();
  });

  it("one press, one new tab: the next tab opened from it gets nothing", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_A), 0);
    await tj.opened({ id: 2, openerTabId: 1 });
    now += 8_000;
    await tj.opened({ id: 3, openerTabId: 1 }); // a link in A's description, ctrl-clicked
    const other = "https://careers.acme.com/jobs/98765/senior-it-analyst";
    expect(await tj.question(tab(3, other))).toBeNull();
    expect(await tj.question(tab(2, WD))).toBe("A");
  });

  it("a new tab long after the press gets nothing", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_A), 0);
    now += OPEN_MS + 1;
    await tj.opened({ id: 2, openerTabId: 1 });
    expect(await tj.question(tab(2, WD))).toBeNull();
  });

  it("leaving the application drops the binding, and the question stays away", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    await tj.answer(tab(1, WD), true);
    const other = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Sales_JR-9999/apply";
    await tj.loaded(tab(1, other));
    expect(await tj.carried(tab(1, other))).toBeNull();
    expect(await tj.question(tab(1, other))).toBeNull();
    await tj.loaded(tab(1, WD)); // even back on A's
    expect(await tj.carried(tab(1, WD))).toBeNull();
  });

  it("Yes on a page that names no posting for sure binds, but teaches no link", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_A), 0);
    const df = "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345";
    await tj.loaded(tab(1, df));
    await tj.answer(tab(1, df), true);
    expect(await tj.carried(tab(1, df))).toBe("A");
    expect(learnLink).not.toHaveBeenCalled();
  });

  it("closing the tab forgets it", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    await tj.answer(tab(1, WD), true);
    await tj.closed(1);
    expect(await tj.carried(tab(1, WD))).toBeNull();
    expect(TAB_JOB).toBe("je_tab_job");
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
    return { run, c, session, event };
  }
  const DF = "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345";

  it("a tab of the run opens it: grouped and told once it lands; the run's tabs stay as they were", async () => {
    const opener = { id: 7, url: LI_A, groupId: 3 };
    const { run, c, session, event } = await setup({ tabs: { 7: opener } });
    expect(await run.tabOpened({ id: 9, groupId: -1 }, opener)).toBe(true);
    expect(c.tabs.group).not.toHaveBeenCalled();
    await run.tabLanded({ id: 9, groupId: -1, url: DF }, 7);
    expect(c.tabs.group).toHaveBeenCalledWith({ groupId: 3, tabIds: 9 });
    expect(event()).toEqual({ kind: "new_tab", url: DF, grouped: true });
    expect(session["je_apply_tabs:r1"]).toEqual([7]);
  });

  it("says when it couldn't be grouped", async () => {
    const opener = { id: 7, url: LI_A, groupId: 3 };
    const { run, event } = await setup({ tabs: { 7: opener }, group: async () => Promise.reject(new Error("no")) });
    await run.tabLanded({ id: 9, groupId: -1, url: DF }, 7);
    expect(event().grouped).toBe(false);
  });

  it("never the user's own LinkedIn group, an ungrouped tab or any page", async () => {
    const { run } = await setup({ tabs: { 7: { id: 7, url: DF, groupId: 3 } } });
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: LI_A, groupId: 5 })).toBe(false);
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: LI_A, groupId: -1 })).toBe(false);
    expect(await run.tabOpened({ id: 9, groupId: -1 }, { id: 8, url: LI_A, groupId: 3 })).toBe(true);
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
