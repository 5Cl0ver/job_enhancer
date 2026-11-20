import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  filterJobs,
  filtersSet,
  jobTypesIn,
  stageCounts,
} from "@/lib/jobFilters";
import type { SavedJob } from "@/types/api";

function job(id: string, over: Record<string, unknown> = {}, saved: Partial<SavedJob> = {}) {
  return {
    id,
    pipeline_stage_id: "applied",
    applied_at: null,
    ...saved,
    job_listing: {
      title: "IT Systems Administrator",
      company: "Vellacor",
      location: "Springfield, IL",
      is_remote: false,
      salary_min: null,
      salary_max: null,
      salary_period: null,
      job_type: null,
      ...over,
    },
  } as SavedJob;
}

describe("filterJobs", () => {
  const jobs = [
    job("1"),
    job("2", { title: "Jira Administrator", company: "Quillstone", is_remote: true }),
    job("3", { salary_max: 90_000, job_type: "full-time" }, { applied_at: "2026-11-01T00:00:00Z" }),
    job("4", { salary_max: 40, salary_period: "hourly", location: "Portland, OR" }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>) =>
    filterJobs(jobs, { ...NO_FILTERS, ...f }).map((j) => j.id);

  it("no filters keeps everything", () => {
    expect(ids({})).toEqual(["1", "2", "3", "4"]);
  });

  it("search looks at title and company", () => {
    expect(ids({ q: "jira" })).toEqual(["2"]);
    expect(ids({ q: " VELLACOR " })).toEqual(["1", "3", "4"]);
  });

  it("pay compares yearly, turning hourly pay into a year", () => {
    // $40/hour is $83,200 a year.
    expect(ids({ minPay: 75_000 })).toEqual(["3", "4"]);
    expect(ids({ minPay: 100_000 })).toEqual([]);
  });

  it("place, type, applied and remote each narrow the list", () => {
    expect(ids({ loc: "portland" })).toEqual(["4"]);
    expect(ids({ jobType: "Full-Time" })).toEqual(["3"]);
    expect(ids({ applied: "applied" })).toEqual(["3"]);
    expect(ids({ applied: "not" })).toEqual(["1", "2", "4"]);
    expect(ids({ remoteOnly: true })).toEqual(["2"]);
  });
});

describe("filtersSet", () => {
  it("counts the filters that are on, not the search text", () => {
    expect(filtersSet(NO_FILTERS)).toBe(0);
    expect(filtersSet({ ...NO_FILTERS, q: "jira" })).toBe(0);
    expect(filtersSet({ ...NO_FILTERS, loc: "OR", remoteOnly: true, minPay: 50_000 })).toBe(3);
  });
});

describe("jobTypesIn / stageCounts", () => {
  it("lists the job types present, once each", () => {
    const jobs = [job("1", { job_type: "full-time" }), job("2", { job_type: "contract" }), job("3")];
    expect(jobTypesIn(jobs)).toEqual(["contract", "full-time"]);
  });

  it("counts jobs per stage and leaves out jobs with no stage", () => {
    const jobs = [
      job("1"),
      job("2"),
      job("3", {}, { pipeline_stage_id: "interview" }),
      job("4", {}, { pipeline_stage_id: null }),
    ];
    expect([...stageCounts(jobs)]).toEqual([
      ["applied", 2],
      ["interview", 1],
    ]);
  });
});
