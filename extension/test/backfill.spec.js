// Passive backfill decision logic — when should a fresh capture be sent up to
// upgrade an already-saved (but thin) job?
import { describe, it, expect } from "vitest";
import { shouldBackfill, MIN_DESCRIPTION } from "../src/backfill.js";

const richJob = {
  title: "Web Developer",
  company: "Civic Canvas",
  description: "x".repeat(MIN_DESCRIPTION),
};

describe("shouldBackfill", () => {
  it("fires when the job is saved-but-thin and we can see a full description", () => {
    expect(shouldBackfill(richJob, { saved: true, needs_details: true })).toBe(true);
  });

  it("does nothing for jobs the user hasn't saved", () => {
    expect(shouldBackfill(richJob, { saved: false, needs_details: false })).toBe(false);
  });

  it("does nothing when the saved listing already has details", () => {
    expect(shouldBackfill(richJob, { saved: true, needs_details: false })).toBe(false);
  });

  it("won't send a snippet — the capture must have a real description", () => {
    const thinCapture = { ...richJob, description: "Short feed snippet." };
    expect(shouldBackfill(thinCapture, { saved: true, needs_details: true })).toBe(false);
    const noDescription = { title: "Web Developer" };
    expect(shouldBackfill(noDescription, { saved: true, needs_details: true })).toBe(false);
  });

  it("requires a readable title and tolerates missing inputs", () => {
    expect(shouldBackfill({ ...richJob, title: "" }, { saved: true, needs_details: true })).toBe(false);
    expect(shouldBackfill(null, { saved: true, needs_details: true })).toBe(false);
    expect(shouldBackfill(richJob, null)).toBe(false);
  });
});
