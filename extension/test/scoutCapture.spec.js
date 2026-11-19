// Claude Scout page copy: what gets sent, and when the page stops trying.
import { describe, it, expect } from "vitest";
import { scoutDone, scoutPayload } from "../src/scoutCapture.js";
import { MIN_DESCRIPTION } from "../src/backfill.js";

const job = {
  title: "IT Systems Administrator",
  company: "Brambleworks",
  location: "Springfield, IL",
  is_remote: false,
  url: "https://www.linkedin.com/jobs/view/4012345678/",
  description: "About the job ".repeat(30),
  salary_min: 72000,
  salary_max: 85000,
  salary_period: "yearly",
  job_type: "",
  _via: "linkedin",
};

describe("scoutPayload", () => {
  it("sends the posting exactly as extracted", () => {
    const p = scoutPayload(job);
    expect(p.description).toBe(job.description);
    expect(p).toMatchObject({
      url: job.url,
      title: job.title,
      company: job.company,
      salary_min: 72000,
      salary_period: "yearly",
      job_type: null,
      via: "linkedin",
    });
  });

  it("waits while the description is still a snippet or missing", () => {
    expect(scoutPayload({ ...job, description: "x".repeat(MIN_DESCRIPTION - 1) })).toBeNull();
    expect(scoutPayload({ ...job, description: undefined })).toBeNull();
  });

  it("needs a title, company and link", () => {
    expect(scoutPayload({ ...job, title: "" })).toBeNull();
    expect(scoutPayload({ ...job, company: "" })).toBeNull();
    expect(scoutPayload({ ...job, url: "" })).toBeNull();
  });
});

describe("scoutDone", () => {
  it("keeps trying while no run is open, so a run that starts later still gets it", () => {
    expect(scoutDone({ active: false })).toBe(false);
    expect(scoutDone(undefined)).toBe(false);
  });

  it("stops once an open run has answered", () => {
    expect(scoutDone({ active: true, stored: true })).toBe(true);
    expect(scoutDone({ active: true, stored: false })).toBe(true);
  });

  it("tries again when the app errored (a cold start), so the copy isn't lost", () => {
    expect(scoutDone({ active: true, stored: false, failed: true })).toBe(false);
  });
});
