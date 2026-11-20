import { describe, expect, it } from "vitest";
import { filterJobs, filtersSet, NO_FILTERS } from "@/lib/jobFilters";
import { folderLink, originOf, originsIn, originText, runLink } from "@/lib/origin";
import type { SavedJob } from "@/types/api";

function job(origin: string | null, scout: SavedJob["scout"] = null) {
  return {
    id: `${origin}`,
    origin,
    scout,
    applied_at: null,
    job_listing: { title: "IT Administrator", company: "Vellacor", location: "", is_remote: false },
  } as SavedJob;
}

describe("originText", () => {
  it("names each way a job arrives", () => {
    expect(originText(job("email"))).toBe("From an email");
    expect(originText(job("extension"))).toBe("Job Catcher");
    expect(originText(job("claude"))).toBe("Saved by Claude");
    expect(originText(job("search"))).toBe("Job board search");
    expect(originText(job("manual"))).toBe("Added by you");
  });

  it("adds Claude's fit score to a job Scout found", () => {
    expect(originText(job("scout", { fit_score: 8, run_id: "r1" }))).toBe(
      "Claude Scout · fit 8/10",
    );
    expect(originText(job("scout"))).toBe("Claude Scout");
  });

  it("says nothing when the origin isn't known, rather than guess", () => {
    expect(originText(job(null))).toBeNull();
    expect(originOf(job("something-new"))).toBeNull();
    expect(originText({ origin: undefined })).toBeNull();
  });
});

describe("originsIn", () => {
  it("lists only the origins present, in a fixed order", () => {
    const jobs = [job("manual"), job("scout"), job(null), job("manual"), job("email")];
    expect(originsIn(jobs)).toEqual(["scout", "email", "manual"]);
    expect(originsIn([job(null)])).toEqual([]);
  });
});

describe("the Where-from filter", () => {
  const jobs = [job("scout"), job("email"), job(null)];

  it("keeps one origin's jobs and counts as a set filter", () => {
    const f = { ...NO_FILTERS, origin: "scout" };
    expect(filterJobs(jobs, f).map((j) => j.origin)).toEqual(["scout"]);
    expect(filtersSet(f)).toBe(1);
  });

  it("shows everything, unplaced jobs included, when it's off", () => {
    expect(filterJobs(jobs, NO_FILTERS)).toHaveLength(3);
    expect(filtersSet(NO_FILTERS)).toBe(0);
  });
});

describe("links between pages", () => {
  it("opens My Jobs on a collection and History on a run", () => {
    expect(folderLink("c 1")).toBe("/jobs?folder=c%201");
    expect(runLink("r1")).toBe("/search?tab=scout&view=history&run=r1");
  });
});
