// Job Catcher's files and tabs (spec 040). Invented data.
// Never a guess: right after the user's own press on an Apply on a saved
// job's own page, the side panel asks "Applying for <job>?" on the next
// page that names no job; only Yes, on that page, binds the tab to it (its
// résumé, cover letter, Submit and company link). The binding is kept only
// on pages surely of that posting; elsewhere on the company's site the
// panel asks "Still applying for…?"; anything else drops it. Every other
// path ends with no binding.
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { BIND_MS, OPEN_MS, TAB_JOB, askAbout, bindHere, boundJobId, confirmBinding, isSignIn, isWebPage, judgeBinding, keepBinding, onHub, onJobBoard, otherPosting, postingIds, putEntry, sameApplication, siteOf, worthTelling } from "../src/tabJob.js";
import { pageId } from "../src/autofill/hosts.js";
import { createTabJobs } from "../src/background/tabJobs.js";
import { applyLabel, isApplyPress, watchApplyPresses } from "../src/autofill/applyClick.js";
import { bestJobMatch } from "../panel/src/lib/context.ts";
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

/**
 * Say Yes on the first page, then load each next one 30 s apart: the verdict
 * on each ("keep", "same", "ask", "drop"). On "ask" the user says Yes again
 * (`stillYes`) or goes on without answering.
 */
function walk(urls, { stillYes = true } = {}) {
  let b = bindHere("A", urls[0], T0);
  const out = [];
  for (const [i, u] of urls.slice(1).entries()) {
    const at = T0 + (i + 1) * 30_000;
    const { verdict, bound } = judgeBinding(b, u, at);
    out.push(verdict);
    if (verdict === "drop") break;
    b = bound;
    if (verdict === "ask") {
      expect(boundJobId(b, u, at)).toBeNull(); // never used while asking
      if (stillYes) b = confirmBinding(b, u, at); // else the user goes on without answering
    }
    if (verdict === "keep" || (verdict === "ask" && stillYes)) expect(boundJobId(b, u, at)).toBe("A");
  }
  return out;
}

describe("good path: Yes, then every step keeps the job (a few asked once)", () => {
  const paths = {
    Workday: [
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply",
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=1",
      "https://www.linkedin.com/oauth/v2/authorization?client_id=x",
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply/applyManually",
    ],
    iCIMS: ["https://careers-acme.icims.com/jobs/12345/it-analyst/job?mode=job&iis=LinkedIn", "https://careers-acme.icims.com/jobs/12345/it-analyst/job/candidate?mode=apply"],
    Taleo: ["https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=2400123&lang=en", "https://acme.taleo.net/careersection/ex/jobdetail.ftl?job=2400123&tz=GMT"],
    Paylocity: ["https://recruiting.paylocity.com/Recruiting/Jobs/Apply/2345678", "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/2345678/step2"],
    UKG: [
      "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/OpportunityDetail?opportunityId=aaaabbbb-1111-2222-3333-444455556666",
      "https://recruiting.ultipro.com/ACM1000ACME/JobBoard/0f1e2d3c-1111-2222-3333-444455556666/Apply/OpportunityApply?opportunityId=aaaabbbb-1111-2222-3333-444455556666",
    ],
    Dayforce: ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345", "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345/apply"],
    Greenhouse: ["https://boards.greenhouse.io/acme/jobs/4455667?gh_src=li", "https://boards.greenhouse.io/acme/jobs/4455667/confirmation"],
    Lever: ["https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666", "https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666/apply", "https://jobs.lever.co/acme/aaaabbbb-1111-2222-3333-444455556666/thanks"],
  };
  for (const [name, urls] of Object.entries(paths)) {
    it(`${name}: every step is kept without asking`, () => {
      expect(askAbout(PRESS, urls[0], null, T0)).toBe("A");
      expect(walk(urls).every((v) => v === "keep" || v === "same")).toBe(true);
    });
  }

  it("a step that isn't surely the posting asks once; after Yes it keeps", () => {
    // Workday's sign-in page, Taleo's flow, iCIMS's login: no posting id.
    expect(walk(["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply", "https://acme.wd5.myworkdayjobs.com/en-US/External/login", "https://acme.wd5.myworkdayjobs.com/en-US/External/login", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/IT-Analyst_JR-1234/apply/applyManually"])).toEqual(["ask", "keep", "keep"]);
    expect(walk(["https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345", "https://acme.taleo.net/careersection/2/jobapply.ftl?lang=en"])).toEqual(["ask"]);
    expect(walk(["https://careers-acme.icims.com/jobs/12345/engineer/job", "https://careers-acme.icims.com/jobs/12345/engineer/login"])).toEqual(["ask"]);
    // SuccessFactors keeps its one address.
    expect(walk(["https://career5.successfactors.com/career?company=acme&career_job_req_id=123", "https://career5.successfactors.com/career?company=acme&navBarLevel=MY_PROFILE"])).toEqual(["keep"]);
  });

  it("the 45 minutes restart only on a kept page (or the user's own work: touch)", () => {
    const url = paths.Workday[0];
    let b = bindHere("A", url, T0);
    b = keepBinding(b, `${url}/apply`, T0 + BIND_MS - 1_000);
    expect(b?.at).toBe(T0 + BIND_MS - 1_000);
    expect(judgeBinding(b, `${url}/apply`, T0 + 2 * BIND_MS).verdict).toBe("drop");
    // An asked page never restarts it.
    const asked = judgeBinding(bindHere("A", url, T0), "https://acme.wd5.myworkdayjobs.com/en-US/External/userHome", T0 + 40 * 60_000);
    expect(asked.verdict).toBe("ask");
    expect(asked.bound.at).toBe(T0);
    expect(judgeBinding(b, "about:blank", T0 + BIND_MS).verdict).toBe("same");
    expect(isWebPage("chrome://newtab/")).toBe(false);
  });
});

describe("the reviewer's cases: a Yes never spreads", () => {
  const board = "11111111-2222-3333-4444-555555555555";
  const cases = [
    // [Yes page, next pages…, the verdicts]
    ["Workable, then another job's slug", ["https://apply.workable.com/acme/j/A1B2C3D4E5/apply/", "https://apply.workable.com/acme/j/F6G7H8J9K0/apply/"], ["ask"]],
    ["a careers slug, then another", ["https://acme.com/careers/senior-designer/apply", "https://acme.com/careers/staff-engineer/apply"], ["ask"]],
    ["Breezy slugs", ["https://acme.breezy.hr/p/a1b2c3d4e5f6-senior-designer/apply", "https://acme.breezy.hr/p/f6e5d4c3b2a1-staff-engineer/apply"], ["ask"]],
    ["Jobvite slugs", ["https://jobs.jobvite.com/acme/job/oAbCdEfG", "https://jobs.jobvite.com/acme/job/oHiJkLmN"], ["ask"]],
    ["JazzHR slugs", ["https://acme.applytojob.com/apply/AbCdEfGh/Engineer", "https://acme.applytojob.com/apply/IjKlMnOp/Designer"], ["ask"]],
    ["a #route slug", ["https://acme.com/careers#/job/senior", "https://acme.com/careers#/job/junior"], ["ask"]],
    ["UKG: Register, then an opportunity, then another", [`https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/Account/Register`, `https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/OpportunityDetail?opportunityId=aaaaaaaa-2222-3333-4444-555555555555`, `https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/OpportunityDetail?opportunityId=bbbbbbbb-2222-3333-4444-555555555555`], ["ask", "ask"]],
    ["UKG: another opportunity", [`https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/OpportunityDetail?opportunityId=aaaaaaaa-2222-3333-4444-555555555555`, `https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/OpportunityApply?opportunityId=bbbbbbbb-2222-3333-4444-555555555555`], ["drop"]],
    ["UKG: Yes on the board home, then an opportunity", [`https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/`, `https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/OpportunityDetail?opportunityId=bbbbbbbb-2222-3333-4444-555555555555`], ["ask"]],
    ["Workday: another requisition", ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Engineer_R12345/apply", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Designer_R67890/apply"], ["drop"]],
    ["Workday: a reposted requisition", ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Engineer_JR-12345", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Designer_JR12345-1"], ["drop"]],
    ["Greenhouse: another job", ["https://job-boards.greenhouse.io/acme/jobs/4012345", "https://job-boards.greenhouse.io/acme/jobs/4067890"], ["drop"]],
    ["gh_jid: another job", ["https://acme.com/careers?gh_jid=4012345", "https://acme.com/careers/job?gh_jid=4067890"], ["drop"]],
    ["Greenhouse: another company", ["https://boards.greenhouse.io/acme/jobs/4012345", "https://boards.greenhouse.io/beta/jobs/4012345"], ["drop"]],
    ["Lever: another company", ["https://jobs.lever.co/acme/aaaaaaaa-2222-3333-4444-555555555555/apply", "https://jobs.lever.co/beta/aaaaaaaa-2222-3333-4444-555555555555/apply"], ["drop"]],
    ["Lever: its list, then another job", ["https://jobs.lever.co/acme/aaaaaaaa-2222-3333-4444-555555555555/apply", "https://jobs.lever.co/acme", "https://jobs.lever.co/acme/bbbbbbbb-2222-3333-4444-555555555555"], ["ask", "drop"]],
    ["iCIMS: search, then another job", ["https://careers-acme.icims.com/jobs/12345/engineer/job", "https://careers-acme.icims.com/jobs/search?ss=1", "https://careers-acme.icims.com/jobs/67890/designer/job"], ["ask", "drop"]],
    ["iCIMS: another job, the portal part the same", ["https://careers-acme.icims.com/jobs/12345/engineer/job?in_iframe=1&hub=7", "https://careers-acme.icims.com/jobs/67890/designer/job?in_iframe=1&hub=7"], ["drop"]],
    ["Taleo: another job", ["https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345", "https://acme.taleo.net/careersection/2/jobapply.ftl?lang=en", "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=67890"], ["ask", "drop"]],
    ["Taleo: Yes on a step, then a job", ["https://acme.taleo.net/careersection/2/jobapply.ftl?lang=en", "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=67890"], ["ask"]],
    ["Taleo: the section's number kept, a job appears", ["https://acme.taleo.net/careersection/10000/jobapply.ftl?lang=en", "https://acme.taleo.net/careersection/10000/jobdetail.ftl?job=67890"], ["ask"]],
    ["Dayforce: another company", ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345", "https://jobs.dayforcehcm.com/en-US/beta/CANDIDATEPORTAL/jobs/12345"], ["drop"]],
    ["Dayforce: another job", ["https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345", "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/67890"], ["drop"]],
    ["Paylocity: another job", ["https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1234567", "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/7654321"], ["drop"]],
    ["SuccessFactors: another company", ["https://career5.successfactors.com/career?company=acme&career_job_req_id=123", "https://career5.successfactors.com/career?company=beta&career_job_req_id=123"], ["drop"]],
    ["SuccessFactors: another requisition", ["https://career5.successfactors.com/career?company=acme&career_job_req_id=123", "https://career5.successfactors.com/career?company=acme&career_job_req_id=456"], ["drop"]],
    ["ADP: another company", ["https://myjobs.adp.com/acme/cx/job-details?reqId=5001234", "https://myjobs.adp.com/beta/cx/job-details?reqId=5001234"], ["drop"]],
    ["ADP WFN: another company", ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=aaaaaaaa-2222-3333-4444-555555555555&jobId=123", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=bbbbbbbb-2222-3333-4444-555555555555&jobId=123"], ["drop"]],
    ["ADP WFN: another job", ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=aaaaaaaa-2222-3333-4444-555555555555&jobId=123", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=aaaaaaaa-2222-3333-4444-555555555555&jobId=456"], ["drop"]],
    ["ADP WFN: Yes on its list, then a job", ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=aaaaaaaa-2222-3333-4444-555555555555&ccId=19000101_000001&lang=en_US", "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=aaaaaaaa-2222-3333-4444-555555555555&ccId=19000101_000001&jobId=999&lang=en_US"], ["ask"]],
    ["a zip and a year in two slugs", ["https://acme.com/jobs/portland-or-97201-engineer-2026", "https://acme.com/jobs/portland-or-97201-designer-2026"], ["ask"]],
    ["a step, then another slug", ["https://acme.com/jobs/12345-engineer", "https://acme.com/jobs/12345-engineer/apply/step2", "https://acme.com/jobs/engineer-portland"], ["keep", "ask"]],
    ["a #route number", ["https://acme.com/careers#/job/123", "https://acme.com/careers#/job/124"], ["drop"]],
    ["Workday: a sign-in, then another tenant", ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/x_R12345/apply", "https://login.microsoftonline.com/abc", "https://beta.wd1.myworkdayjobs.com/en-US/External/job/x_R12345/apply"], ["same", "drop"]],
    ["myworkdaysite: another tenant", ["https://wd5.myworkdaysite.com/recruiting/acme/External/job/x_R12345", "https://wd5.myworkdaysite.com/recruiting/beta/External/job/x_R12345"], ["drop"]],
    ["SmartRecruiters: another job", ["https://jobs.smartrecruiters.com/Acme/743999123456789-engineer", "https://jobs.smartrecruiters.com/Acme/743999987654321-designer"], ["drop"]],
    ["Paycom: another company", ["https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=12345&clientkey=ABC", "https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=12345&clientkey=DEF"], ["drop"]],
    ["Oracle: another job, the site number shared", ["https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210512345/apply/section/1", "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210598765"], ["drop"]],
    ["a store number shared", ["https://careers.acme.com/store-0456/jobs/12345", "https://careers.acme.com/store-0456/jobs/67890"], ["drop"]],
    ["Avature: another job", ["https://acme.avature.net/careers/ApplicationMethods?jobId=12345", "https://acme.avature.net/careers/JobDetail/Designer/67890"], ["drop"]],
    ["a step, then another job referring back", ["https://acme.com/careers/job/12345?src=linkedin", "https://acme.com/careers/job/12345/apply", "https://acme.com/careers/job/67890/apply?ref=12345"], ["keep", "drop"]],
    ["Jobvite: another company", ["https://jobs.jobvite.com/careers/acme/job/oAbCdEfG/apply", "https://jobs.jobvite.com/careers/globex/job/oZzYyXxW/apply"], ["drop"]],
    ["Jobvite: another company, the other address", ["https://jobs.jobvite.com/careers/acme/job/oAbCdEfG/apply", "https://jobs.jobvite.com/globex/job/oZzYyXxW/apply"], ["drop"]],
  ];
  for (const [name, urls, verdicts] of cases) {
    it(name, () => {
      expect(walk(urls, { stillYes: false })).toEqual(verdicts);
    });
  }

  it("UKG: Yes to the first opportunity, then another one drops it", () => {
    const opp = (id) => `https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/OpportunityDetail?opportunityId=${id}-2222-3333-4444-555555555555`;
    expect(walk([`https://recruiting.ultipro.com/ACME1000/JobBoard/${board}/Account/Register`, opp("aaaaaaaa"), opp("bbbbbbbb")])).toEqual(["ask", "drop"]);
  });

  it("sign-ins on the way change nothing: LinkedIn's, Indeed's, Apple, SAP, ADP, iCIMS", () => {
    const b = bindHere("A", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x_R111/apply", T0);
    for (const u of ["https://www.linkedin.com/oauth/v2/authorization?client_id=x", "https://secure.indeed.com/oauth/v2/authorize?x", "https://secure.indeed.com/account/login", "https://appleid.apple.com/auth/authorize", "https://accounts.sap.com/saml2/idp/sso", "https://online.adp.com/signin/v1/", "https://login.icims.com/"]) {
      expect([u, judgeBinding(b, u, T0 + 1).verdict]).toEqual([u, "same"]);
      expect(isSignIn(u)).toBe(true);
    }
    expect(isSignIn(LI_A)).toBe(false);
  });

  it("the panel never asks on a sign-in, a shop, a news page or an aggregator", () => {
    for (const u of ["https://www.amazon.com/dp/B0", "https://news.example.com/careers-advice", "https://jooble.org/desc/123", "https://www.talent.com/view?id=abc", "https://www.adzuna.com/details/123", "https://click.appcast.io/track/abc", "https://www.glassdoor.com/job-listing/x", "https://acme.com/", "https://accounts.sap.com/saml2/idp/sso", "https://online.adp.com/signin/v1/", "https://login.icims.com/", "https://www.linkedin.com/oauth/v2/authorization"]) {
      expect([u, askAbout(PRESS, u, null, T0 + 1)]).toEqual([u, null]);
    }
    expect(askAbout(PRESS, "https://acme.com/careers/apply", null, T0 + 1)).toBe("A");
  });

  it("shared hosts are told apart by company (Jobvite, Rippling, ADP included)", () => {
    for (const [a, b] of [
      ["https://jobs.jobvite.com/careers/acme/job/x", "https://jobs.jobvite.com/careers/globex/job/x"],
      ["https://jobs.jobvite.com/acme/job/x", "https://jobs.jobvite.com/globex/job/x"],
      ["https://ats.rippling.com/acme/jobs/x", "https://ats.rippling.com/beta/jobs/x"],
      ["https://workforcenow.adp.com/x?cid=1", "https://workforcenow.adp.com/x?cid=2"],
    ]) {
      expect(siteOf(a)).not.toBe(siteOf(b));
    }
    expect(siteOf("https://jobs.jobvite.com/careers/acme/job/x")).toBe(siteOf("https://jobs.jobvite.com/acme/job/x"));
  });

  it("the company's application is never another posting that shares a number", () => {
    expect(sameApplication("https://acme.wd5.myworkdayjobs.com/en-US/External/job/x_R123", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/y_R123-1")).toBe(false);
    expect(sameApplication(`https://recruiting.ultipro.com/A/JobBoard/${board}/`, `https://recruiting.ultipro.com/A/JobBoard/${board}/OpportunityDetail?opportunityId=bbbbbbbb-2222-3333-4444-555555555555`)).toBe(false);
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
  const LI_K = "https://www.linkedin.com/jobs/view/4100000333/";
  const jobOf = { [LI_A]: { id: "A" } };
  const ownMatch = async (tab) => jobOf[tab.url] || null;
  const make = ({ now = () => T0 } = {}) => {
    const c = fakeChrome({ 1: { id: 1, url: LI_A, groupId: -1 }, 2: { id: 2, url: WD, groupId: -1 } });
    const learnLink = vi.fn(async () => {});
    const run = { opened: vi.fn(async () => false), landed: vi.fn(async () => {}) };
    return { c, learnLink, run, tj: createTabJobs({ ownMatch, learnLink, run, chrome: c, now }) };
  };
  const tab = (id, url) => ({ id, url });
  const ask = async (tj, t) => (await tj.question(t))?.jobId ?? null;

  it("good path: a press in A's listing, a new tab lands on Workday, Yes on that page binds it and teaches the link", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.opened({ id: 2, openerTabId: 1 });
    await tj.loaded(tab(2, WD));
    expect(await tj.carried(tab(2, WD))).toBeNull(); // nothing until Yes
    const q = await tj.question(tab(2, WD));
    expect(q).toEqual({ jobId: "A", again: false, page: pageId(WD) });
    expect(await tj.answer(tab(2, WD), true, q.page)).toEqual({ jobId: "A" });
    expect(learnLink).toHaveBeenCalledWith("A", WD);
    expect(await tj.question(tab(2, WD))).toBeNull();
    for (const step of [`${WD}/apply`, `${WD}/apply/applyManually`]) {
      await tj.loaded(tab(2, step));
      expect(await tj.carried(tab(2, step))).toBe("A");
    }
  });

  it("Yes binds only the page asked about: a tab that moved on is refused and asked again", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    const q = await tj.question(tab(1, WD));
    const elsewhere = "https://beta.wd1.myworkdayjobs.com/en-US/Careers/job/y_R222/apply";
    expect(await tj.answer(tab(1, elsewhere), true, q.page)).toEqual({ refused: true });
    expect(await tj.carried(tab(1, elsewhere))).toBeNull();
    expect(learnLink).not.toHaveBeenCalled();
    expect(await ask(tj, tab(1, elsewhere))).toBe("A"); // still asking, about this page
  });

  it("No: no binding, nothing learned, and no question again without a new press", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    expect(await tj.answer(tab(1, WD), false, pageId(WD))).toEqual({ jobId: null });
    expect(await tj.carried(tab(1, WD))).toBeNull();
    expect(await ask(tj, tab(1, WD))).toBeNull();
    expect(learnLink).not.toHaveBeenCalled();
  });

  it("a press in a frame (an ad), with no frame id, or on a page that is no saved job, is no press", async () => {
    const { tj, c } = make();
    await tj.pressed(tab(1, LI_A), 3);
    await tj.pressed(tab(1, LI_A), undefined);
    await tj.loaded(tab(1, WD));
    expect(await ask(tj, tab(1, WD))).toBeNull();
    expect(c.store.je_tab_press || {}).toEqual({});
  });

  it("an Apply on another, unsaved job clears the press", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, LI_K));
    await tj.pressed(tab(1, LI_K), 0); // K's Apply: not saved
    now += 60_000;
    const other = "https://beta.wd1.myworkdayjobs.com/en-US/Careers/job/Remote/Designer_R999";
    await tj.loaded(tab(1, other));
    expect(await ask(tj, tab(1, other))).toBeNull();
  });

  it("another board posting loaded in the pressed tab clears the press", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, LI_K));
    const other = "https://beta.wd1.myworkdayjobs.com/en-US/Careers/job/Remote/Designer_R999";
    await tj.loaded(tab(1, other));
    expect(await ask(tj, tab(1, other))).toBeNull();
  });

  it("one press, one new tab; the board tab keeps none once it handed it over", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_A), 0);
    await tj.opened({ id: 2, openerTabId: 1 });
    now += 8_000;
    await tj.opened({ id: 3, openerTabId: 1 }); // a link in A's description
    expect(await ask(tj, tab(3, "https://careers.acme.com/jobs/98765/senior-it-analyst/apply"))).toBeNull();
    expect(await ask(tj, tab(2, WD))).toBe("A");
    // A tab the new tab opens (a link on Workday) never takes the press on.
    await tj.opened({ id: 4, openerTabId: 2 });
    expect(await ask(tj, tab(2, WD))).toBe("A");
    expect(await ask(tj, tab(4, "https://careers.acme.com/jobs/98765/senior-it-analyst/apply"))).toBeNull();
    await tj.answer(tab(2, WD), false, pageId(WD));
    // Later in the board tab: no question from the press it gave away.
    const later = "https://careers.other.example/jobs/apply/5555";
    await tj.loaded(tab(1, later));
    expect(await ask(tj, tab(1, later))).toBeNull();
  });

  it("a new tab long after the press gets nothing", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_A), 0);
    now += OPEN_MS + 1;
    await tj.opened({ id: 2, openerTabId: 1 });
    expect(await ask(tj, tab(2, WD))).toBeNull();
  });

  it("not surely the posting: 'Still applying for…?', the job unused till Yes; No drops it", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    await tj.answer(tab(1, WD), true, pageId(WD));
    const home = "https://acme.wd5.myworkdayjobs.com/en-US/External/userHome";
    await tj.loaded(tab(1, home));
    expect(await tj.carried(tab(1, home))).toBeNull();
    expect(await tj.question(tab(1, home))).toEqual({ jobId: "A", again: true, page: pageId(home) });
    expect(await tj.answer(tab(1, home), true, pageId(home))).toEqual({ jobId: "A" });
    expect(await tj.carried(tab(1, home))).toBe("A");
    const list = "https://acme.wd5.myworkdayjobs.com/en-US/External?q=sales";
    await tj.loaded(tab(1, list));
    await tj.answer(tab(1, list), false, pageId(list));
    expect(await tj.carried(tab(1, list))).toBeNull();
    expect(await tj.question(tab(1, list))).toBeNull();
  });

  it("another posting or site drops the binding, and the question stays away", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    await tj.answer(tab(1, WD), true, pageId(WD));
    const other = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin/Sales_JR-9999/apply";
    await tj.loaded(tab(1, other));
    expect(await tj.carried(tab(1, other))).toBeNull();
    expect(await tj.question(tab(1, other))).toBeNull();
    await tj.loaded(tab(1, WD)); // even back on A's
    expect(await tj.carried(tab(1, WD))).toBeNull();
  });

  it("idle: an asked page never restarts the 45 minutes; a fill does (touch)", async () => {
    let now = T0;
    const { tj } = make({ now: () => now });
    await tj.pressed(tab(1, LI_A), 0);
    const yes = "https://apply.workable.com/acme/j/A1B2C3D4E5/apply/";
    await tj.loaded(tab(1, yes));
    await tj.answer(tab(1, yes), true, pageId(yes));
    now += 40 * 60_000;
    await tj.touch(1); // the user filled the page
    now += 40 * 60_000;
    expect(await tj.carried(tab(1, yes))).toBe("A");
    for (const u of ["https://apply.workable.com/acme/", "https://apply.workable.com/acme/j/F6G7H8J9K0/apply/"]) {
      now += 40 * 60_000;
      await tj.loaded(tab(1, u));
    }
    expect(await tj.carried(tab(1, "https://apply.workable.com/acme/j/F6G7H8J9K0/apply/"))).toBeNull();
  });

  it("two hops: Yes on the careers page, then its Apply to Workday asks again", async () => {
    const { tj } = make();
    const careers = "https://careers.acme.com/job/12345/it-analyst";
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, careers));
    await tj.answer(tab(1, careers), true, pageId(careers));
    await tj.pressed(tab(1, careers), 0); // the careers page's own Apply
    await tj.loaded(tab(1, WD));
    expect(await tj.carried(tab(1, WD))).toBeNull();
    expect(await tj.question(tab(1, WD))).toEqual({ jobId: "A", again: true, page: pageId(WD) });
  });

  it("Yes on a page with no strong posting id binds, but teaches no link", async () => {
    const { tj, learnLink } = make();
    await tj.pressed(tab(1, LI_A), 0);
    const df = "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/12345";
    await tj.loaded(tab(1, df));
    await tj.answer(tab(1, df), true, pageId(df));
    expect(await tj.carried(tab(1, df))).toBe("A");
    expect(learnLink).not.toHaveBeenCalled();
  });

  it("closing the tab forgets it", async () => {
    const { tj } = make();
    await tj.pressed(tab(1, LI_A), 0);
    await tj.loaded(tab(1, WD));
    await tj.answer(tab(1, WD), true, pageId(WD));
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
