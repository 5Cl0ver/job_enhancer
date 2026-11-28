// Job Catcher's files and tabs (spec 040). Invented data.
// Never a guess: after the user's own press on an Apply on saved job J's
// own page, the panel only SUGGESTS J on the pages that follow ("Fill with
// J's résumé and cover letter", one fill of one page at a time); nothing is
// remembered as "this page is J". Once, on the first application page, it
// asks "Is this the application for J?": Yes only teaches J its company
// link, and only from a page naming its posting.
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { OPEN_MS, PICK_MS, SUGGEST_MS, askAbout, fillJobFor, holdFiles, looksLikeApplication, pageOf, isSignIn, isWebPage, onHub, onJobBoard, postingIds, postingLevelId, putEntry, sameApplication, siteOf, suggestFor, worthTelling } from "../src/tabJob.js";
import { createTabJobs } from "../src/background/tabJobs.js";
import { applyLabel, isApplyPress, watchApplyPresses } from "../src/autofill/applyClick.js";
import { bestJobMatch, filesLabel } from "../panel/src/lib/context.ts";

import { isResumeText, resolve } from "../src/autofill/resolve.js";

const LI_A = "https://www.linkedin.com/jobs/view/4100000001/";
const T0 = 1_700_000_000_000;
const PRESS = { jobId: "A", at: T0 };

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


describe("the suggestion: on pages naming no saved job, for 45 minutes", () => {
  const WD = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234";
  it("suggests the pressed job; never on its own page, a board, a sign-in, or after 45 minutes", () => {
    expect(suggestFor(PRESS, WD, null, T0 + 1_000)).toBe("A");
    expect(suggestFor(PRESS, WD, "B", T0)).toBeNull(); // the page is another saved job's
    expect(suggestFor(PRESS, LI_A, null, T0)).toBeNull();
    expect(suggestFor(PRESS, "https://accounts.google.com/o/oauth2", null, T0)).toBeNull();
    expect(suggestFor(PRESS, WD, null, T0 + SUGGEST_MS + 1)).toBeNull();
    expect(suggestFor(null, WD, null, T0)).toBeNull();
    expect(OPEN_MS).toBe(20_000);
  });

  it("once the application's site is known, only there", () => {
    const press = { ...PRESS, landingSite: siteOf(WD) };
    expect(suggestFor(press, `${WD}/apply`, null, T0)).toBe("A");
    for (const u of ["https://othercorp.com/careers/data-analyst/apply", "https://boards.greenhouse.io/zeta/jobs/999999", "https://www.nytimes.com/2026/11/28/news.html", "https://mail.yahoo.com/d/folders/1", "https://globex.wd5.myworkdayjobs.com/en-US/External/job/X_R-9"]) {
      expect([u, suggestFor(press, u, null, T0)]).toEqual([u, null]);
    }
  });

  it("asks about the link only on a page naming its posting", () => {
    expect(askAbout(PRESS, WD, null, T0)).toBe("A");
    for (const u of ["https://acme.com/careers/apply", "https://acme.wd5.myworkdayjobs.com/en-US/External/login", "https://shop.example.com/dp/B0", "https://news.example.com/careers-advice", "https://jooble.org/desc/123", "https://acme.com/", "https://accounts.sap.com/saml2/idp/sso", "https://login.icims.com/", "https://www.linkedin.com/oauth/v2/authorization"]) {
      expect([u, askAbout(PRESS, u, null, T0 + 1)]).toEqual([u, null]);
    }
  });

  it("one press: a pick counts only for the fill its press started, on its page", () => {
    const pick = { jobId: "A", page: pageOf(WD), nonce: "n1", at: T0 };
    expect(fillJobFor(null, pick, WD, "n1", T0 + 1_000)).toBe("A");
    expect(fillJobFor(null, pick, WD, "n2", T0 + 1_000)).toBeNull(); // another press
    expect(fillJobFor(null, pick, WD, null, T0 + 1_000)).toBeNull(); // an automatic fill
    expect(fillJobFor(null, pick, `${WD}/apply`, "n1", T0 + 1_000)).toBeNull(); // another page
    expect(fillJobFor(null, pick, WD, "n1", T0 + PICK_MS + 1)).toBeNull();
    expect(fillJobFor("B", pick, WD, null, T0)).toBe("B"); // the page's own job always
    expect(pageOf(`${WD}#step2`)).toBe(pageOf(WD)); // (the background also drops a pick on any address change)
  });

  it("without a choice for this fill, the résumé and letter boxes are left", () => {
    const pick = { jobId: null, page: pageOf(WD), nonce: "n1", at: T0 };
    expect(holdFiles(true, null, null)).toBe(true); // an automatic fill
    expect(holdFiles(true, pick, "n1")).toBe(false); // "Use my usual résumé" for this press
    expect(holdFiles(true, pick, "n2")).toBe(true);
    expect(holdFiles(false, null, null)).toBe(false); // nothing suggested: as always
  });

  it("the buttons name only what the job has", () => {
    const s = { jobId: "A", title: "IT Analyst", company: "Acme", ask: false, page: "", problem: "" };
    expect(filesLabel({ ...s, hasResume: true, hasLetter: true })).toBe("Use IT Analyst's résumé and letter");
    expect(filesLabel({ ...s, hasResume: true, hasLetter: false })).toBe("Use IT Analyst's résumé");
    expect(filesLabel({ ...s, hasResume: false, hasLetter: true })).toBe("Use IT Analyst's cover letter");
    expect(filesLabel({ ...s, hasResume: false, hasLetter: false })).toBeNull();
  });
});

describe("a posting-level id, the only page a link is learned from", () => {
  it("posting query parts, requisitions and the systems' own posting ids", () => {
    for (const [u, id] of [
      ["https://acme.eightfold.ai/careers?pid=999&domain=acme.com", "pid=999"],
      ["https://careers.acme.com/apply?id=456", "id=456"],
      ["https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345", "token=4012345"],
      ["https://jobs.jobvite.com/acme/job/oAbCdEfG?jvi=oAbCdEfG", "jvi=oabcdefg"],
      ["https://www.indeed.com/viewjob?vjk=a1b2c3", "jk=a1b2c3"],
      ["https://boards.greenhouse.io/acme/jobs/4012345", "4012345"],
      ["https://acme.wd5.myworkdayjobs.com/x/job/Portland/IT-Analyst_JR-1234/apply", "jr1234"],
      ["https://acme.wd5.myworkdayjobs.com/x/job/Portland/IT%20Analyst_JR-1234/apply", "jr1234"],
      ["https://jobs.lever.co/acme/aaaaaaaa-2222-3333-4444-555555555555/apply", "aaaaaaaa-2222-3333-4444-555555555555"],
      ["https://apply.workable.com/acme/j/A1B2C3D4E5/apply/", "a1b2c3d4e5"],
      ["https://jobs.smartrecruiters.com/Acme/743999123456789-engineer", "743999123456789"],
      ["https://careers-acme.icims.com/jobs/12345/it-analyst/job", "12345"],
      ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345", "12345"],
      ["https://recruiting.paylocity.com/Recruiting/Jobs/Details/2345678", "2345678"],
      ["https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/210512345", "210512345"],
      ["https://recruiting.ultipro.com/ACM1/JobBoard/aaaaaaaa-1111-2222-3333-444444444444/OpportunityDetail?opportunityId=bbbbbbbb-1111-2222-3333-444444444444", "opportunityid=bbbbbbbb-1111-2222-3333-444444444444"],
    ]) {
      expect([u, postingLevelId(u)]).toEqual([u, id]);
    }
  });

  it("never a board home, a list, a portal, a company's UUID, a session token, a search's pid or a word id", () => {
    for (const u of [
      "https://boards.greenhouse.io/acme",
      "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL",
      "https://acme.breezy.hr/",
      "https://apply.workable.com/acme/",
      "https://jobs.jobvite.com/acme/jobs",
      "https://acme.applytojob.com/apply",
      "https://jobs.smartrecruiters.com/Acme",
      "https://careers-acme.icims.com/jobs/search?ss=1",
      "https://acme.com/careers",
      "https://recruiting.ultipro.com/ACM1/JobBoard/aaaaaaaa-1111-2222-3333-444444444444/",
      "https://recruiting.paylocity.com/Recruiting/Jobs/All/aaaaaaaa-1111-2222-3333-444444444444",
      "https://careers.acme.example/apply?token=abc123def",
      "https://careers.acme.example/jobs?pid=12345",
      "https://acme.eightfold.ai/careers?query=analyst&pid=999",
      "https://careers.acme.example/apply?id=senior-analyst",
    ]) {
      expect([u, postingLevelId(u)]).toEqual([u, null]);
    }
  });
});

describe("the company's application in the matcher", () => {
  const J = { id: "J", job_listing_id: "1", title: "Software Engineer", company: "Acme", location: "", url: "https://www.linkedin.com/jobs/view/4011111111/", applied: false, company_url: null };
  const K = { id: "K", job_listing_id: "2", title: "Data Analyst", company: "Acme", location: "", url: "https://www.linkedin.com/jobs/view/4022222222/", applied: false, company_url: null };

  it("K's pages are never J (no job is carried onto a page)", () => {
    for (const [url, title] of [
      ["https://acme.eightfold.ai/careers?pid=999&domain=acme.com", "Careers at Acme"],
      ["https://apply.workable.com/acme/j/FGHJKL/apply/", "Product Designer - Acme"],
      ["https://boards.greenhouse.io/acme/jobs/2222222", "Job Application for Product Designer at Acme"],
      ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/54321", "Acme Careers"],
      ["https://careers.acme.com/apply?id=456", "Apply"],
    ]) {
      expect(bestJobMatch({ url, title }, [J])).toBeNull();
      expect(bestJobMatch({ url, title }, [J, K])).toBeNull();
    }
  });

  it("a learned link sharing only the company's UUID, or a number, with K's page is never it", () => {
    const J2 = { ...J, company_url: "https://x.example-ats.com/aaaaaaaa-1111-2222-3333-444444444444/jobs/111" };
    expect(bestJobMatch({ url: "https://x.example-ats.com/aaaaaaaa-1111-2222-3333-444444444444/jobs/222", title: "x" }, [J2])).toBeNull();
    expect(sameApplication("https://acme.wd5.myworkdayjobs.com/x/job/a_R123", "https://acme.wd5.myworkdayjobs.com/x/job/b_R123-1")).toBe(false);
    const board = "aaaaaaaa-1111-2222-3333-444444444444";
    expect(sameApplication(`https://recruiting.ultipro.com/A/JobBoard/${board}/`, `https://recruiting.ultipro.com/A/JobBoard/${board}/OpportunityDetail?opportunityId=bbbbbbbb-2222-3333-4444-555555555555`)).toBe(false);
    // The same posting, a later step: it is.
    const wd = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Software-Engineer_R-123";
    expect(sameApplication(wd, `${wd}/apply/applyManually`)).toBe(true);
    expect(bestJobMatch({ url: `${wd}/apply/applyManually`, title: "Workday" }, [{ ...J, company_url: wd }])?.id).toBe("J");
  });
});

describe("sites, boards and sign-ins", () => {
  it("job boards, aggregators, search engines and the app", () => {
    for (const url of [LI_A, "https://uk.indeed.com/", "https://www.indeed.co.uk/", "https://www.glassdoor.co.uk/Job/index.htm", "https://www.linkedin.cn/", "https://builtin.com/jobs", "https://www.dice.com/jobs", "https://wellfound.com/jobs", "https://www.usajobs.gov/job/1", "https://jooble.org/x", "https://www.google.com/search?q=jobs", "https://job-enhancer-xxj1.vercel.app/jobs"]) {
      expect(onHub(url)).toBe(true);
    }
    expect(onJobBoard("https://www.glassdoor.co.uk/x")).toBe(true);
    expect(onHub("https://careers.google.com/jobs/results/1")).toBe(false);
  });

  it("shared hosts are told apart by company", () => {
    for (const [a, b] of [
      ["https://wd5.myworkdaysite.com/recruiting/acme/External", "https://wd5.myworkdaysite.com/recruiting/globex/External/job/X_R-9"],
      ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL", "https://jobs.dayforcehcm.com/en-US/globex/CANDIDATEPORTAL/jobs/555"],
      ["https://recruiting.ultipro.com/ACM1000ACME/JobBoard/x/", "https://recruiting.ultipro.com/GLX2000GLOBX/JobBoard/y/"],
      ["https://career4.successfactors.com/career?company=acmeP", "https://career4.successfactors.com/career?company=globexP"],
      ["https://myjobs.adp.com/acme/cx", "https://myjobs.adp.com/globex/cx"],
      ["https://jobs.jobvite.com/careers/acme/job/x", "https://jobs.jobvite.com/careers/globex/job/x"],
      ["https://ats.rippling.com/acme/jobs/x", "https://ats.rippling.com/beta/jobs/x"],
      ["https://workforcenow.adp.com/x?cid=1", "https://workforcenow.adp.com/x?cid=2"],
    ]) {
      expect(siteOf(a)).not.toBe(siteOf(b));
    }
  });

  it("sign-ins: LinkedIn's and Indeed's own, Apple, SAP, ADP, iCIMS", () => {
    for (const u of ["https://www.linkedin.com/oauth/v2/authorization?client_id=x", "https://secure.indeed.com/oauth/v2/authorize?x", "https://secure.indeed.com/account/login", "https://appleid.apple.com/auth/authorize", "https://accounts.sap.com/saml2/idp/sso", "https://online.adp.com/signin/v1/", "https://login.icims.com/"]) {
      expect(isSignIn(u)).toBe(true);
    }
    expect(isSignIn(LI_A)).toBe(false);
  });

  it("ids: years, zips and store numbers never name a posting; reposted requisitions differ", () => {
    expect(postingIds("https://acme.wd5.myworkdayjobs.com/External/job/Portland-OR-97201/IT-Analyst_R-1234")).toEqual({ strong: ["r1234"], weak: [] });
    expect(postingIds("https://x.wd5.myworkdayjobs.com/a/job/y_JR12345-1").strong).toEqual(["jr12345-1"]);
    expect(isWebPage("chrome://newtab/")).toBe(false);
  });

  it("keeps a few tabs, newest last", () => {
    let map = {};
    for (let i = 0; i < 60; i++) map = putEntry(map, i, { jobId: `j${i}`, at: T0 });
    expect(Object.keys(map)).toHaveLength(50);
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

const LI_J = "https://www.linkedin.com/jobs/view/4100000111/";
function make({ now = () => T0, saved = { [LI_J]: "J" }, run } = {}) {
  const c = fakeChrome({ 1: { id: 1, url: LI_J, groupId: -1 }, 2: { id: 2, url: "about:blank", groupId: -1 } });
  const learnLink = vi.fn(async () => {});
  const tj = createTabJobs({ ownMatch: async (t) => (saved[t.url] ? { id: saved[t.url] } : null), learnLink, run: run || { opened: async () => false, landed: async () => {} }, chrome: c, now });
  return { c, learnLink, tj };
}
const tab = (id, url) => ({ id, url });

describe("every reviewer scenario: K's page offers at most the choice, never uses J, learns nothing without Yes", () => {
  const flows = {
    "Greenhouse board home, then another posting": ["https://boards.greenhouse.io/acme", "https://boards.greenhouse.io/acme/jobs/2222222"],
    "Dayforce portal, then a posting": ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL", "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/54321"],
    "Breezy root, then a posting": ["https://acme.breezy.hr/", "https://acme.breezy.hr/p/abcdef-data-analyst/apply"],
    "Workable list, then a posting": ["https://apply.workable.com/acme/", "https://apply.workable.com/acme/j/FGHJKL/apply/"],
    "Jobvite list, then a posting": ["https://jobs.jobvite.com/acme/jobs", "https://jobs.jobvite.com/acme/jobs/job/oQxyzAB/apply"],
    "JazzHR /apply, then a posting": ["https://acme.applytojob.com/apply", "https://acme.applytojob.com/apply/XyZabC/Data-Analyst"],
    "SmartRecruiters company, then a posting": ["https://jobs.smartrecruiters.com/Acme", "https://jobs.smartrecruiters.com/Acme/743999888777666-data-analyst"],
    "iCIMS search, then a posting": ["https://careers-acme.icims.com/jobs/search?ss=1", "https://careers-acme.icims.com/jobs/5555/data-analyst/job"],
    "custom careers slugs": ["https://acme.com/careers/software-engineer/apply", "https://acme.com/careers", "https://acme.com/careers/data-analyst/apply"],
    "UKG: another opportunity in the path": ["https://recruiting.ultipro.com/ACM1000ACME/JobBoard/aaaaaaaa-1111-2222-3333-444444444444/OpportunityDetail/bbbbbbbb-1111-2222-3333-444444444444", "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/aaaaaaaa-1111-2222-3333-444444444444/OpportunityDetail/cccccccc-1111-2222-3333-444444444444"],
    "Paylocity: another company's job": ["https://recruiting.paylocity.com/Recruiting/Jobs/Details/1234567", "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/7654321"],
    "a #route SPA, another job": ["https://acme.com/careers/#/jobs/12345", "https://acme.com/careers/#/jobs/12345/apply", "https://acme.com/careers/#/jobs/67890/apply"],
    "Eightfold pid": ["https://acme.eightfold.ai/careers?pid=111", "https://acme.eightfold.ai/careers?pid=999&domain=acme.com"],
    "Workday: another requisition, the 2026 interns": ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Intern---Summer-2026_R-123", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Seattle-WA/Data-Intern---Summer-2026_R-456"],
    "Oracle: another job, a site number shared": ["https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210512345", "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210598765"],
    "another company's tenant": ["https://wd5.myworkdaysite.com/recruiting/acme/External", "https://wd5.myworkdaysite.com/recruiting/globex/External/job/Remote/Dev_R-9/apply"],
    "SuccessFactors: another company": ["https://career4.successfactors.com/career?company=acmeP&career_job_req_id=12345", "https://career4.successfactors.com/career?company=globexP&career_job_req_id=67890"],
    "the suggestion wandering to other sites": ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/X/Eng_R111/apply", "https://othercorp.com/careers/data-analyst/apply", "https://www.nytimes.com/2026/11/28/news.html"],
  };
  for (const [name, urls] of Object.entries(flows)) {
    it(name, async () => {
      let now = T0;
      const { tj, learnLink } = make({ now: () => now });
      await tj.loaded(tab(1, LI_J));
      await tj.pressed(tab(1, LI_J), 0);
      let nonce = null;
      for (const u of urls) {
        now += 30_000;
        await tj.loaded(tab(1, u));
        const s = await tj.suggestion(tab(1, u));
        expect(s === null || s.jobId === "J").toBe(true); // at most the choice, only for J
        expect(await tj.fillJob(tab(1, u), null, null)).toBeNull(); // never used on its own
        if (!nonce && s) {
          nonce = await tj.pick(tab(1, u), "J"); // the user picks it on the first page only
          expect(await tj.fillJob(tab(1, u), null, nonce)).toBe("J");
          await tj.endPick(1, nonce);
          expect(await tj.fillJob(tab(1, u), null, nonce)).toBeNull(); // that press is over
        }
      }
      const last = urls.at(-1);
      expect(await tj.fillJob(tab(1, last), null, nonce)).toBeNull();
      expect(learnLink).not.toHaveBeenCalled();
    });
  }

  it("a pick for another job than the one suggested is refused", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(1, wd));
    expect(await tj.pick(tab(1, wd), "K")).toBeNull();
  });

  it("a press in a frame (an ad), with no frame id, or on a page that is no saved job, is no press", async () => {
    const { tj, c } = make();
    await tj.pressed(tab(1, LI_J), 3);
    await tj.pressed(tab(1, LI_J), undefined);
    await tj.pressed(tab(5, "https://news.example/"), 0);
    expect(c.store.je_tab_press || {}).toEqual({});
  });

  it("an Apply on another job's board posting, another board posting, or another saved job's page replaces or clears it", async () => {
    const saved = { [LI_J]: "J", "https://www.linkedin.com/jobs/view/4100000222/": "L" };
    const wd = "https://beta.wd1.myworkdayjobs.com/en-US/Careers/job/Remote/Designer_R999";
    for (const steps of [
      async (tj) => {
        await tj.loaded(tab(1, "https://www.linkedin.com/jobs/view/4100000333/"));
        await tj.pressed(tab(1, "https://www.linkedin.com/jobs/view/4100000333/"), 0); // K, unsaved
      },
      async (tj) => tj.loaded(tab(1, "https://www.linkedin.com/jobs/view/4100000333/")),
    ]) {
      const { tj } = make({ saved });
      await tj.pressed(tab(1, LI_J), 0);
      await steps(tj);
      await tj.loaded(tab(1, wd));
      expect(await tj.suggestion(tab(1, wd))).toBeNull();
    }
    const { tj } = make({ saved });
    await tj.pressed(tab(1, LI_J), 0);
    await tj.loaded(tab(1, "https://www.linkedin.com/jobs/view/4100000222/"));
    await tj.pressed(tab(1, "https://www.linkedin.com/jobs/view/4100000222/"), 0);
    await tj.loaded(tab(1, wd));
    expect((await tj.suggestion(tab(1, wd)))?.jobId).toBe("L");
  });

  it("the same company's site naming another posting, or a Submit, ends it", async () => {
    const wd = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/X/Eng_R111/apply";
    const { tj } = make();
    await tj.pressed(tab(1, LI_J), 0);
    await tj.loaded(tab(1, wd));
    expect((await tj.suggestion(tab(1, wd)))?.jobId).toBe("J");
    const other = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Y/Sales_R222";
    await tj.loaded(tab(1, other));
    expect(await tj.suggestion(tab(1, other))).toBeNull();
    const again = make();
    await again.tj.pressed(tab(1, LI_J), 0);
    await again.tj.loaded(tab(1, wd));
    await again.tj.submitted(1);
    expect(await again.tj.suggestion(tab(1, wd))).toBeNull();
  });

  it("one press, one new tab; the board tab keeps none; a handed press goes no further", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_J), 0);
    await tj.opened({ id: 2, openerTabId: 1 });
    now += 8_000;
    await tj.opened({ id: 3, openerTabId: 1 });
    await tj.opened({ id: 4, openerTabId: 2 });
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    expect((await tj.suggestion(tab(2, wd)))?.jobId).toBe("J");
    expect(await tj.suggestion(tab(3, wd))).toBeNull();
    expect(await tj.suggestion(tab(4, wd))).toBeNull();
    expect(await tj.suggestion(tab(1, wd))).toBeNull();
  });

  it("any change of address drops a choice, the #part too", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(1, wd));
    const nonce = await tj.pick(tab(1, wd), "J");
    await tj.moved(1); // onUpdated info.url: "#step2"
    expect(await tj.fillJob(tab(1, wd), null, nonce)).toBeNull();
  });

  it("no choice for this fill: the files are held; a choice for this press lets them through", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(1, wd));
    expect(await tj.holdsFiles(tab(1, wd), null)).toBe(true); // automatic, toolbar
    const usual = await tj.pick(tab(1, wd), null); // "Use my usual résumé"
    expect(await tj.holdsFiles(tab(1, wd), usual)).toBe(false);
    expect(await tj.fillJob(tab(1, wd), null, usual)).toBeNull();
    // No suggestion: nothing held.
    const none = make();
    expect(await none.tj.holdsFiles(tab(1, wd), null)).toBe(false);
  });

  it("a problem with the job's files is shown until the next choice", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(1, wd));
    await tj.noteProblem(1, "IT Analyst's résumé didn't load.");
    expect((await tj.suggestion(tab(1, wd))).problem).toBe("IT Analyst's résumé didn't load.");
    await tj.pick(tab(1, wd), "J");
    expect((await tj.suggestion(tab(1, wd))).problem).toBeUndefined();
  });
});

describe("good path: LinkedIn → the application, every step offers the choice; a press uses J's files", () => {
  const paths = {
    Workday: ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234", "https://acme.wd5.myworkdayjobs.com/en-US/External/login", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply/applyManually"],
    iCIMS: ["https://careers-acme.icims.com/jobs/12345/it-analyst/job?mode=job", "https://careers-acme.icims.com/jobs/12345/it-analyst/candidate?mode=apply"],
    Taleo: ["https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=2400123", "https://acme.taleo.net/careersection/ex/flow.jsf?lang=en"],
    Greenhouse: ["https://boards.greenhouse.io/acme/jobs/4455667?gh_src=li", "https://boards.greenhouse.io/acme/jobs/4455667/confirmation"],
    Lever: ["https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666", "https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666/apply"],
    Dayforce: ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345", "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345/apply"],
    Paylocity: ["https://recruiting.paylocity.com/Recruiting/Jobs/Details/2345678", "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/2345678"],
    Oracle: ["https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/210512345", "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/210512345/apply/section/1"],
  };
  for (const [name, urls] of Object.entries(paths)) {
    it(`${name} (its own Apply pressed on the way keeps it)`, async () => {
      let now = T0;
      const { tj, learnLink } = make({ now: () => now });
      await tj.pressed(tab(1, LI_J), 0);
      await tj.opened({ id: 2, openerTabId: 1 });
      for (const [i, u] of urls.entries()) {
        now += 30_000;
        await tj.loaded(tab(2, u));
        // The company site's own Apply button (G2): the press stays.
        await tj.pressed(tab(2, u), 0);
        const s = await tj.suggestion(tab(2, u));
        expect(s?.jobId).toBe("J");
        expect(s.ask).toBe(i === 0);
        if (i === 0) expect(await tj.answerLanding(tab(2, u), true, s.page)).toEqual({ ok: true });
        expect(await tj.fillJob(tab(2, u), null, null)).toBeNull();
        const nonce = await tj.pick(tab(2, u), "J");
        expect(await tj.fillJob(tab(2, u), null, nonce)).toBe("J");
        await tj.endPick(2, nonce);
      }
      expect(learnLink).toHaveBeenCalledTimes(1);
      expect(learnLink).toHaveBeenCalledWith("J", urls[0]);
    });
  }

  it("the link question: No, another page than asked, or a page not naming its posting learns nothing", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_J), 0);
    const home = "https://acme.com/careers/apply";
    await tj.loaded(tab(1, home));
    expect((await tj.suggestion(tab(1, home))).ask).toBe(false); // no posting id: not asked
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    const other = make();
    await other.tj.pressed(tab(1, LI_J), 0);
    await other.tj.loaded(tab(1, wd));
    const s = await other.tj.suggestion(tab(1, wd));
    expect(s.ask).toBe(true);
    expect(await other.tj.answerLanding(tab(1, `${wd}/apply`), true, s.page)).toEqual({ refused: true });
    await other.tj.answerLanding(tab(1, wd), false, s.page);
    expect(other.learnLink).not.toHaveBeenCalled();
    expect((await other.tj.suggestion(tab(1, wd))).ask).toBe(false); // asked once
    expect(learnLink).not.toHaveBeenCalled();
  });

  it("a link the app couldn't save is said", async () => {
    const c = fakeChrome({ 1: { id: 1, url: LI_J } });
    const tj = createTabJobs({ ownMatch: async (t) => (t.url === LI_J ? { id: "J" } : null), learnLink: async () => false, chrome: c, now: () => T0 });
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(1, wd));
    expect(await tj.answerLanding(tab(1, wd), true, pageOf(wd))).toEqual({ ok: true, linkFailed: true });
  });

  it("a press's suggestion ends after 45 minutes, and on closing the tab", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    now += SUGGEST_MS + 1;
    await tj.loaded(tab(1, wd));
    expect(await tj.suggestion(tab(1, wd))).toBeNull();
    const again = make();
    await again.tj.pressed(tab(1, LI_J), 0);
    await again.tj.closed(1);
    expect(await again.tj.suggestion(tab(1, wd))).toBeNull();
  });
});

describe("the panel never waits behind a tab opening", () => {
  it("a slow run check doesn't hold the suggestion, the pick or the answer", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    const { tj } = make({ run: { opened: () => slow.then(() => false), landed: async () => {} } });
    await tj.pressed(tab(1, LI_J), 0);
    const opening = tj.opened({ id: 2, openerTabId: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(2, wd));
    expect((await tj.suggestion(tab(2, wd)))?.jobId).toBe("J");
    expect(await tj.pick(tab(2, wd), "J")).toBeTruthy();
    release();
    await opening;
  });

  it("a run's new tab that lands before the run check returns is still told", async () => {
    let release;
    const slow = new Promise((r) => (release = r));
    const landed = vi.fn(async () => {});
    const { tj } = make({ run: { opened: () => slow.then(() => true), landed } });
    const opening = tj.opened({ id: 2, openerTabId: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(2, wd));
    expect(landed).not.toHaveBeenCalled();
    release();
    await opening;
    expect(landed).toHaveBeenCalledTimes(1);
    expect(landed).toHaveBeenCalledWith(expect.objectContaining({ id: 2, url: wd }), 1);
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

describe("no choice of files for this fill (an automatic fill on a suggested job's page)", () => {
  it("leaves the résumé, cover-letter and résumé-text boxes for the user's pick", () => {
    const copy = { values: {}, answers: [], holdFiles: true, resumeFile: new Blob(["x"]), coverLetterFile: new Blob(["y"]), coverLetterText: "Hi Jordan", resumeText: "Sam Rivera" };
    expect(resolve({ kind: "file", question: "Resume", hints: {} }, copy)).toMatchObject({ skip: "choose_files", key: "resume_file" });
    expect(resolve({ kind: "file", question: "Cover letter", hints: {} }, copy)).toMatchObject({ skip: "choose_files", key: "cover_letter_file" });
    expect(resolve({ kind: "textarea", question: "Cover letter", hints: {} }, copy)).toMatchObject({ skip: "choose_files" });
    expect(resolve({ kind: "textarea", question: "Paste your resume", hints: {} }, copy)).toMatchObject({ skip: "choose_files" });
    // Everything else fills as always.
    expect(resolve({ kind: "file", question: "Resume", hints: {} }, { ...copy, holdFiles: false })).toMatchObject({ key: "resume_file", source: "profile" });
  });
});

describe("seventh review", () => {
  it("a job with no files of its own: nothing is held, fills go as always (B1)", async () => {
    const c = fakeChrome({ 1: { id: 1, url: LI_J } });
    const tj = createTabJobs({ ownMatch: async (t) => (t.url === LI_J ? { id: "J" } : null), hasFiles: async () => false, chrome: c, now: () => T0 });
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(1, wd));
    expect((await tj.suggestion(tab(1, wd)))?.jobId).toBe("J");
    expect(await tj.holdsFiles(tab(1, wd), null)).toBe(false);
  });

  it("the landing is the first page after the press; going back to a search ends it (F1)", async () => {
    let now = T0;
    const { tj, learnLink } = make({ now: () => now });
    await tj.pressed(tab(1, LI_J), 0);
    for (const u of ["https://acme.com/about", "https://www.google.com/search?q=beta+jobs", "https://job-boards.greenhouse.io/beta/jobs/7777777"]) {
      now += 15_000;
      await tj.loaded(tab(1, u));
    }
    const beta = "https://job-boards.greenhouse.io/beta/jobs/7777777";
    expect(await tj.suggestion(tab(1, beta))).toBeNull();
    expect(learnLink).not.toHaveBeenCalled();
  });

  it("the landing site's own Apply hands over to its applicant system once (two hops)", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_J), 0);
    const careers = "https://careers.acme.com/job/12345/it-analyst";
    const wd = "https://acme.wd5.myworkdayjobs.com/External/job/Portland/IT-Analyst_JR-1234/apply";
    await tj.loaded(tab(1, careers));
    now += 10_000;
    expect(await tj.suggestion(tab(1, wd))).toBeNull(); // another site: not before the careers page's Apply
    await tj.pressed(tab(1, careers), 0); // its own Apply
    now += 5_000;
    await tj.loaded(tab(1, wd));
    expect((await tj.suggestion(tab(1, wd)))?.jobId).toBe("J");
    // Once: a third site isn't the application's.
    now += 5_000;
    const other = "https://globex.wd1.myworkdayjobs.com/External/job/X/Dev_R-9";
    await tj.loaded(tab(1, other));
    expect(await tj.suggestion(tab(1, other))).toBeNull();
  });

  it("a Yes learns a link only on the application's own site", async () => {
    let now = T0;
    const { tj, learnLink } = make({ now: () => now });
    await tj.pressed(tab(1, LI_J), 0);
    const wd = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    await tj.loaded(tab(1, wd));
    const s = await tj.suggestion(tab(1, wd));
    expect(await tj.answerLanding(tab(1, wd), true, s.page)).toEqual({ ok: true });
    expect(learnLink).toHaveBeenCalledWith("J", wd);
  });

  it("only a press on the job's board listing starts a suggestion (F3)", async () => {
    const company = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111";
    const c = fakeChrome({});
    const tj = createTabJobs({ ownMatch: async (t) => (t.url === company ? { id: "J" } : null), chrome: c, now: () => T0 });
    await tj.pressed(tab(1, company), 0); // the job's own company page (its learned link)
    const next = "https://acme.wd5.myworkdayjobs.com/x/job/y_R111/apply";
    await tj.loaded(tab(1, next));
    expect(await tj.suggestion(tab(1, next))).toBeNull();
    expect(c.store.je_tab_press || {}).toEqual({});
  });

  it("a learned Greenhouse or iCIMS link matches the posting's later pages, never another (F5)", () => {
    const gh = "https://job-boards.greenhouse.io/acme/jobs/4567890";
    expect(sameApplication(gh, `${gh}#app`)).toBe(true);
    expect(sameApplication(gh, `${gh}/confirmation`)).toBe(true);
    expect(sameApplication(gh, "https://job-boards.greenhouse.io/acme/jobs/4567891")).toBe(false);
    const ic = "https://careers-acme.icims.com/jobs/1234/it-analyst/job";
    expect(sameApplication(ic, "https://careers-acme.icims.com/jobs/1234/it-analyst/candidate?mode=apply")).toBe(true);
    expect(sameApplication(ic, "https://careers-acme.icims.com/jobs/5678/designer/job")).toBe(false);
    const J = { id: "J", job_listing_id: "1", title: "IT Analyst", company: "Acme", location: "", url: LI_J, applied: false, company_url: gh };
    expect(bestJobMatch({ url: `${gh}/confirmation`, title: "Thanks" }, [J])?.id).toBe("J");
  });

  it("roles and opportunities are applications too", () => {
    expect(looksLikeApplication("https://acme.example/opportunities/data-analyst")).toBe(true);
    expect(looksLikeApplication("https://acme.example/roles/data-analyst")).toBe(true);
  });
});
