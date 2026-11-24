import { describe, expect, it } from "vitest";
import {
  bestJobMatch,
  detectContext,
  downloadFilename,
  findDuplicate,
  siteLabel,
} from "../panel/src/lib/context.ts";
import { postingKey } from "../src/autofill/hosts.js";

const JOBS = [
  { id: "1", job_listing_id: "l1", title: "Help Desk Analyst", company: "Vellacor Robotics", location: "", url: "", applied: false },
  { id: "2", job_listing_id: "l2", title: "IT Support Specialist", company: "Quillstone", location: "", url: "", applied: true },
];

describe("detectContext: what the tab beside the panel is", () => {
  it.each([
    ["https://myjobs.indeed.com/applied", { kind: "indeed-myjobs" }],
    ["https://smartapply.indeed.com/beta/indeedapply/form", { kind: "application", site: "Indeed", autoTracked: false, indeed: true }],
    ["https://job-boards.greenhouse.io/vellacor/jobs/1", { kind: "application", site: "Greenhouse", autoTracked: true, indeed: false }],
    ["https://jobs.lever.co/quillstone/123/apply", { kind: "application", site: "Lever", autoTracked: true, indeed: false }],
    ["https://vellacor.wd5.myworkdayjobs.com/en-US/External/job/X/apply", { kind: "application", site: "Workday", autoTracked: true, indeed: false }],
    ["https://www.amazon.jobs/en/applicant/apply/123", { kind: "application", site: "Amazon", autoTracked: false, indeed: false }],
    ["https://careers.tidewell.example/jobs/42", { kind: "page", site: "Tidewell" }],
    ["chrome://extensions/", { kind: "none" }],
    ["", { kind: "none" }],
  ])("%s", (url, want) => {
    expect(detectContext(url)).toEqual(want);
  });

  it("a job LISTING on Workday isn't an application", () => {
    expect(detectContext("https://vellacor.wd5.myworkdayjobs.com/en-US/External/job/Springfield/IT-Admin_R-1").kind).toBe("page");
  });
});

describe("bestJobMatch never links a page to the wrong saved job", () => {
  const SAVED = [
    { id: "t", job_listing_id: "lt", title: "Software Engineer I", company: "Brightfold", location: "", url: "https://job-boards.greenhouse.io/brightfold/jobs/4001", applied: false },
    { id: "a", job_listing_id: "la", title: "Software Engineer II, Fullstack (Ads Platform)", company: "Opaline Pay", location: "", url: "https://job-boards.greenhouse.io/opalinepay/jobs/7002", applied: false },
  ];
  const AFFIRM_LIKE = {
    url: "https://job-boards.greenhouse.io/opalinepay/jobs/7002",
    title: "Job Application for Software Engineer II, Fullstack (Ads Platform) at Opaline Pay",
  };

  it("\"Software Engineer I\" at another company is not \"Software Engineer II\" (the reported bug)", () => {
    expect(bestJobMatch(AFFIRM_LIKE, [SAVED[0]])).toBeNull();
    expect(bestJobMatch({ ...AFFIRM_LIKE, url: "https://job-boards.greenhouse.io/opalinepay/jobs/7099" }, [SAVED[0]])).toBeNull();
  });

  it("the same posting wins, however it's reached", () => {
    expect(bestJobMatch(AFFIRM_LIKE, SAVED)?.id).toBe("a");
    expect(bestJobMatch({ url: "https://boards.greenhouse.io/embed/job_app?for=opalinepay&token=7002", title: "" }, SAVED)?.id).toBe("a");
    expect(bestJobMatch({ url: "https://opalinepay.example/careers/open-roles?gh_jid=7002", title: "Careers" }, SAVED)?.id).toBe("a");
  });

  it("another posting on the same applicant system never counts, even with the same title", () => {
    const other = { url: "https://job-boards.greenhouse.io/brightfold/jobs/4555", title: "Job Application for Software Engineer I at Brightfold" };
    expect(bestJobMatch(other, SAVED)).toBeNull();
  });

  it("a job saved from elsewhere still links by whole title + company", () => {
    const fromLinkedIn = [{ ...SAVED[1], url: "https://www.linkedin.com/jobs/view/3900000001" }];
    expect(bestJobMatch(AFFIRM_LIKE, fromLinkedIn)?.id).toBe("a");
  });

  it("Not this job: the user's word wins", () => {
    expect(bestJobMatch(AFFIRM_LIKE, SAVED, ["a"])).toBeNull();
  });

  it("one address saved for several jobs: the title and company decide", () => {
    const hub = "https://opalinepay.example/careers/2026-openings";
    const two = [
      { ...SAVED[0], id: "x", company: "Opaline Pay", url: hub },
      { ...SAVED[1], id: "y", url: hub },
    ];
    expect(bestJobMatch({ url: hub, title: "Software Engineer II, Fullstack (Ads Platform) | Opaline Pay" }, two)?.id).toBe("y");
    expect(bestJobMatch({ url: hub, title: "Opaline Pay careers" }, two)).toBeNull();
  });

  it("one posting saved twice (board and company site): still linked, not cancelled out", () => {
    const twice = [SAVED[1], { ...SAVED[1], id: "a2", url: "https://opalinepay.example/careers?gh_jid=7002" }];
    expect(["a", "a2"]).toContain(bestJobMatch(AFFIRM_LIKE, twice)?.id);
    const edited = [SAVED[1], { ...SAVED[1], id: "a3", title: "SWE II Ads" }];
    expect(bestJobMatch(AFFIRM_LIKE, edited)?.id).toBe("a");
  });

  it("the job saved from this page is linked to it, whatever its address", () => {
    const fromOther = [{ ...SAVED[0], id: "p", url: "https://job-boards.greenhouse.io/brightfold/jobs/4001" }];
    const page = { url: "https://job-boards.greenhouse.io/brightfold/jobs/4555", title: "Job Application for Software Engineer I at Brightfold" };
    expect(bestJobMatch(page, fromOther)).toBeNull();
    expect(bestJobMatch(page, fromOther, [], "p")?.id).toBe("p");
    expect(bestJobMatch(page, fromOther, ["p"], "p")).toBeNull(); // Not this job still wins
  });

  it("a pin only holds where the address is one posting", () => {
    const hub = "https://careers.kelso.example/#/job/42";
    const jobs = [
      { ...SAVED[0], id: "p42", title: "IT Analyst", company: "Kelso", url: hub },
      { ...SAVED[0], id: "p43", title: "Data Analyst", company: "Kelso", url: "" },
    ];
    expect(bestJobMatch({ url: "https://careers.kelso.example/#/job/43", title: "Data Analyst - Kelso" }, jobs, [], "p42")?.id).toBe("p43");
  });

  it("one posting saved twice under other titles: still this page", () => {
    const twice = [
      { ...SAVED[1], id: "x1", title: "SWE II Ads" },
      { ...SAVED[1], id: "x2", title: "Software Engineer 2" },
    ];
    expect(["x1", "x2"]).toContain(bestJobMatch(AFFIRM_LIKE, twice)?.id);
  });

  it("a job site that is also the employer still links on its own careers site", () => {
    const wd = [{ ...SAVED[0], id: "w", title: "Software Engineer", company: "Workday", url: "https://www.linkedin.com/jobs/view/3900000009" }];
    expect(bestJobMatch({ url: "https://workday.wd5.myworkdayjobs.com/Workday/job/USA-CA/Software-Engineer_JR-9", title: "Software Engineer at Workday" }, wd)?.id).toBe("w");
  });

  it("a company that is a common word or a job site's name is never proof", () => {
    const odd = [
      { ...SAVED[0], id: "r", title: "Software Engineer", company: "Remote", url: "" },
      { ...SAVED[0], id: "i", title: "Software Engineer", company: "Indeed", url: "" },
      { ...SAVED[0], id: "g", title: "Software Engineer", company: "Greenhouse Software", url: "" },
    ];
    expect(bestJobMatch({ url: "https://acme.example/jobs/12", title: "Software Engineer (Remote) - Acme" }, odd)).toBeNull();
    expect(bestJobMatch({ url: "https://www.indeed.com/viewjob?jk=abc123", title: "Software Engineer - Acme | Indeed.com" }, odd)).toBeNull();
    expect(bestJobMatch({ url: "https://job-boards.greenhouse.io/acme/jobs/55", title: "Software Engineer at Acme" }, odd)).toBeNull();
  });

  it("the most specific title wins", () => {
    const both = [
      { ...SAVED[1], id: "short", title: "Software Engineer", url: "" },
      { ...SAVED[1], id: "long", url: "" },
    ];
    expect(bestJobMatch({ ...AFFIRM_LIKE, url: "https://opalinepay.example/apply" }, both)?.id).toBe("long");
  });
});

describe("postingKey: which posting an address is", () => {
  it.each([
    ["https://boards.greenhouse.io/vellacor/jobs/123", "greenhouse:123"],
    ["https://job-boards.greenhouse.io/vellacor/jobs/123#app", "greenhouse:123"],
    ["https://boards.greenhouse.io/embed/job_app?for=vellacor&token=123", "greenhouse:123"],
    ["https://vellacor.example/careers?gh_jid=123", "greenhouse:123"],
    ["https://jobs.lever.co/quillstone/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/apply", "lever:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"],
    ["https://jobs.ashbyhq.com/quillstone/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/application", "ashby:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"],
    ["https://jobs.smartrecruiters.com/Tidewell/744000012345-it-analyst", "smartrecruiters:744000012345"],
    ["https://apply.workable.com/tidewell/j/AB12CD34EF/apply/", "workable:ab12cd34ef"],
    ["https://www.linkedin.com/jobs/view/it-analyst-at-tidewell-3900000001", "linkedin:3900000001"],
    ["https://www.linkedin.com/jobs/search/?currentJobId=3900000001", "linkedin:3900000001"],
    ["https://vellacor.wd5.myworkdayjobs.com/en-US/External/job/Portland_OR/IT-Analyst_JR-1234/apply/applyManually", "workday:vellacor.wd5.myworkdayjobs.com:jr-1234"],
    ["https://www.paycomonline.net/v4/ats/web.php/portal/0000NVF/jobs/ViewJobDetails?job=61770", "paycomonline.net/v4/ats/web.php/portal/0000nvf/jobs/viewjobdetails?job=61770"],
    ["https://careers.tidewell.example/jobs/42/apply", "careers.tidewell.example/jobs/42"],
    // myworkdaysite.com is shared: the tenant in the path tells companies apart.
    ["https://wd5.myworkdaysite.com/recruiting/vellacor/External/job/Portland/IT-Analyst_R-1234", "workday:wd5.myworkdaysite.com/vellacor:r-1234"],
    ["https://wd5.myworkdaysite.com/recruiting/quillstone/External/job/Salem/Analyst_R-1234", "workday:wd5.myworkdaysite.com/quillstone:r-1234"],
  ])("%s", (url, key) => {
    expect(postingKey(url)?.key).toBe(key);
  });

  it("a careers home page names no posting", () => {
    expect(postingKey("https://careers.tidewell.example/")).toBeNull();
    expect(postingKey("https://tidewell.example/careers/apply")).toBeNull();
    expect(postingKey("not a url")).toBeNull();
  });

  it("a random id that starts with digits is not a SmartRecruiters posting id", () => {
    expect(postingKey("https://jobs.smartrecruiters.com/oneclick-ui/company/Tidewell/publication/12345678-abcd-4ef0-9abc-0123456789ab")?.sure).not.toBe(true);
  });

  it("the systems' own ids are sure; a plain address is only a hint", () => {
    expect(postingKey("https://boards.greenhouse.io/vellacor/jobs/123")?.sure).toBe(true);
    expect(postingKey("https://careers.tidewell.example/jobs/42")?.sure).toBe(false);
  });
});

describe("helpers", () => {
  it("names a site from its host", () => {
    expect(siteLabel("www.amazon.jobs")).toBe("Amazon");
    expect(siteLabel("boards.greenhouse.io")).toBe("Greenhouse");
  });

  it("finds the saved job a tab is about by its title and company", () => {
    const page = (title, url = "https://careers.vellacor.example/apply/42") => ({ url, title });
    expect(bestJobMatch(page("Apply: Help Desk Analyst at Vellacor Robotics"), JOBS)?.id).toBe("1");
    expect(bestJobMatch(page("Some other page"), JOBS)).toBeNull();
    // The title alone isn't enough: another company's Help Desk Analyst.
    expect(bestJobMatch(page("Help Desk Analyst - Tidewell Labs", "https://tidewell.example/jobs/9"), JOBS)).toBeNull();
    // The company can be in the address instead (Workday tabs show only the title).
    expect(bestJobMatch(page("Help Desk Analyst", "https://vellacor.wd5.myworkdayjobs.com/en-US/External/job/X/Help-Desk-Analyst_R-9/apply"), JOBS)?.id).toBe("1");
  });

  it("spots a duplicate: same company, same or contained title", () => {
    expect(findDuplicate({ title: "Help Desk Analyst II", company: "Vellacor Robotics" }, JOBS)?.id).toBe("1");
    expect(findDuplicate({ title: "Help Desk Analyst", company: "Tidewell Labs" }, JOBS)).toBeNull();
    expect(findDuplicate({ title: "", company: "Quillstone" }, JOBS)).toBeNull();
    // Whole words: "IT Support Specialist II" contains "IT Support Specialist", "…Specialists" doesn't.
    expect(findDuplicate({ title: "IT Support Specialists", company: "Quillstone" }, JOBS)).toBeNull();
  });

  it("names documents after the user's own résumé file", () => {
    expect(downloadFilename("Wren_Calloway_Resume.pdf", "cover_letter")).toBe("Wren_Calloway_Cover_Letter.pdf");
    expect(downloadFilename("wren calloway cv.docx", "resume")).toBe("wren_calloway_Resume.pdf");
    expect(downloadFilename("", "resume")).toBe("Resume.pdf");
  });
});
