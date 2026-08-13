import { describe, it, expect } from "vitest";
import { getNextAction } from "@/lib/nextAction";
import type { SavedJob } from "@/types/api";

// Minimal SavedJob factory — only the fields getNextAction reads matter.
function job(overrides: Partial<SavedJob> = {}): SavedJob {
  const nowIso = new Date().toISOString();
  return {
    id: "1",
    user_id: "u",
    job_listing_id: "j",
    collection_id: null,
    pipeline_stage_id: null,
    notes: null,
    applied_at: null,
    last_stage_change: nowIso,
    is_archived: false,
    flagged_for_research: false,
    emailed_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    // job_listing isn't read by getNextAction; cast keeps the factory small.
    job_listing: {} as SavedJob["job_listing"],
    ...overrides,
  };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe("getNextAction", () => {
  it("nudges a fresh saved job to apply", () => {
    const a = getNextAction(job(), { followUpDays: 7, stageName: "Interested" });
    expect(a).toEqual({ label: "Apply", tone: "prep" });
  });

  it("flags a stale un-applied job to apply or archive", () => {
    const a = getNextAction(job({ last_stage_change: daysAgo(10) }), {
      followUpDays: 7,
      stageName: "Interested",
    });
    expect(a).toEqual({ label: "Apply or archive", tone: "do" });
  });

  it("tells you to email after applying", () => {
    const a = getNextAction(job({ applied_at: daysAgo(1) }), {
      followUpDays: 7,
      stageName: "Applied",
    });
    expect(a).toEqual({ label: "Send outreach email", tone: "do" });
  });

  it("waits on a reply when recently emailed", () => {
    const a = getNextAction(
      job({ applied_at: daysAgo(2), emailed_at: daysAgo(2), last_stage_change: daysAgo(2) }),
      { followUpDays: 7, stageName: "Applied" },
    );
    expect(a).toEqual({ label: "Waiting on reply", tone: "wait" });
  });

  it("detects ghosting once the follow-up window passes", () => {
    const a = getNextAction(
      job({ applied_at: daysAgo(12), emailed_at: daysAgo(12), last_stage_change: daysAgo(12) }),
      { followUpDays: 7, stageName: "Applied" },
    );
    expect(a?.tone).toBe("do");
    expect(a?.label).toMatch(/no reply in 12d/i);
  });

  it("prompts interview prep in interview stages", () => {
    for (const stage of ["Phone Screen", "Interview", "Take-Home Assignment", "Final Round"]) {
      expect(getNextAction(job(), { followUpDays: 7, stageName: stage })).toEqual({
        label: "Prep for interview",
        tone: "prep",
      });
    }
  });

  it("celebrates an offer and goes quiet on a rejection", () => {
    expect(getNextAction(job(), { followUpDays: 7, stageName: "Offer" })?.tone).toBe("win");
    expect(getNextAction(job(), { followUpDays: 7, stageName: "Rejected" })).toBeNull();
  });
});
