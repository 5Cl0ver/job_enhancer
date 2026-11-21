import { describe, expect, it } from "vitest";
import {
  findingFacts,
  levelsLabel,
  lookingFor,
  type Mission,
  missionChanges,
  missionLookingFor,
  type Recommended,
  type Track,
  trackChanges,
} from "@/lib/scout";

const REC: Recommended = {
  mission: {
    job_count: 10,
    posted_within_days: 7,
    min_fit: 6,
    radius_miles: 25,
  },
  track: { levels: ["entry", "mid"], skip: { degree_only: false } },
};

describe("levelsLabel", () => {
  it("joins levels next to each other with a dash, others with +", () => {
    expect(levelsLabel(["mid", "entry"])).toBe("Entry–Mid");
    expect(levelsLabel(["entry", "senior"])).toBe("Entry + Senior");
    expect(levelsLabel(["senior"])).toBe("Senior");
    expect(levelsLabel([])).toBe("Entry–Mid");
    expect(levelsLabel(undefined)).toBe("Entry–Mid");
  });
});

describe("lookingFor", () => {
  it("says what a search looks for in one plain line", () => {
    expect(
      lookingFor({
        source: "linkedin",
        track: "IT Admin",
        levels: ["entry", "mid"],
        location: "Beaverton, OR",
        radius_miles: 25,
        remote: "any",
        days: 7,
        min_fit: 6,
      }),
    ).toBe(
      "Entry–mid IT Admin jobs · Beaverton, OR + 25 mi · past week · fit 6+",
    );
    expect(
      lookingFor({
        source: "indeed",
        track: "Help Desk",
        broad: false,
        levels: ["senior"],
        location: null,
        radius_miles: null,
        remote: "remote_only",
        days: 1,
        min_fit: 7,
      }),
    ).toBe("Senior Help Desk jobs · remote · today · fit 7+");
  });

  it("fills in the default radius for a search around a place", () => {
    const m = {
      source: "linkedin",
      broad: true,
      location: "Springfield, IL",
      radius_miles: null,
      remote: "no_remote",
      posted_within_days: 3,
      min_fit: 6,
      job_count: 10,
    } as unknown as Mission;
    expect(lookingFor(missionLookingFor(m, undefined))).toBe(
      "Entry–mid jobs you'd be good at · Springfield, IL + 25 mi, on-site · past 3 days · fit 6+",
    );
  });
});

describe("findingFacts", () => {
  it("lists what Claude read, skipping what it didn't", () => {
    expect(
      findingFacts({
        level: "mid",
        years_asked: 3,
        location: "Springfield, IL",
        posted: "2 days ago",
      }),
    ).toBe("Mid · 3+ yrs · Springfield, IL · 2 days ago");
    expect(
      findingFacts({
        level: null,
        years_asked: null,
        location: null,
        posted: null,
      }),
    ).toBe("");
  });
});

describe("recommended settings", () => {
  const mission = {
    job_count: 2,
    posted_within_days: 1,
    min_fit: 8,
    location: "Beaverton",
    remote: "any",
    radius_miles: null,
  } as Mission;

  it("lists only what would widen the search", () => {
    expect(missionChanges(mission, REC)).toEqual([
      { label: "Jobs per run", from: "2", to: "10" },
      { label: "Posted", from: "Today", to: "Last 7 days" },
      { label: "Fit for Best", from: "8+", to: "6+" },
      { label: "Distance", from: "Not set", to: "25 mi" },
    ]);
    const wide = {
      ...mission,
      job_count: 10,
      posted_within_days: 14,
      min_fit: 5,
      radius_miles: 50,
    };
    expect(missionChanges(wide, REC)).toEqual([]);
  });

  it("adds Entry and Mid and turns the degree rule off", () => {
    const track = {
      levels: ["senior"],
      skip_rules: { degree_only: true, max_years: null, exclude: [] },
    } as unknown as Track;
    expect(trackChanges(track, REC)).toEqual([
      { label: "Levels", from: "Senior", to: "Entry–Senior" },
      { label: "Degree rule", from: "Skip degree-only jobs", to: "Off" },
    ]);
    const done = {
      levels: ["entry", "mid"],
      skip_rules: { degree_only: false, max_years: null, exclude: [] },
    } as unknown as Track;
    expect(trackChanges(done, REC)).toEqual([]);
  });
});
