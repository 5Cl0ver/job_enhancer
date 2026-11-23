import { describe, expect, it } from "vitest";
import {
  bestJobMatch,
  detectContext,
  downloadFilename,
  findDuplicate,
  siteLabel,
} from "../panel/src/lib/context.ts";

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

describe("helpers", () => {
  it("names a site from its host", () => {
    expect(siteLabel("www.amazon.jobs")).toBe("Amazon");
    expect(siteLabel("boards.greenhouse.io")).toBe("Greenhouse");
  });

  it("finds the saved job a tab is about by its title", () => {
    expect(bestJobMatch("Apply: Help Desk Analyst at Vellacor Robotics", JOBS)?.id).toBe("1");
    expect(bestJobMatch("Some other page", JOBS)).toBeNull();
  });

  it("spots a duplicate: same company, same or contained title", () => {
    expect(findDuplicate({ title: "Help Desk Analyst II", company: "Vellacor Robotics" }, JOBS)?.id).toBe("1");
    expect(findDuplicate({ title: "Help Desk Analyst", company: "Tidewell Labs" }, JOBS)).toBeNull();
    expect(findDuplicate({ title: "", company: "Quillstone" }, JOBS)).toBeNull();
  });

  it("names documents after the user's own résumé file", () => {
    expect(downloadFilename("Wren_Calloway_Resume.pdf", "cover_letter")).toBe("Wren_Calloway_Cover_Letter.pdf");
    expect(downloadFilename("wren calloway cv.docx", "resume")).toBe("wren_calloway_Resume.pdf");
    expect(downloadFilename("", "resume")).toBe("Resume.pdf");
  });
});
