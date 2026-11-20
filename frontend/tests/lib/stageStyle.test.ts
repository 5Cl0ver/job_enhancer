import { describe, expect, it } from "vitest";
import { stageTone } from "@/lib/stageStyle";

const colour = (name: string | null) => stageTone(name).dot;

describe("stageTone", () => {
  it("gives each built-in stage its own colour", () => {
    const stages = [
      "Interested",
      "Referral Sent",
      "Applied",
      "Phone Screen",
      "Take-Home Assignment",
      "Interview",
      "Offer",
      "Rejected",
    ];
    expect(new Set(stages.map(colour)).size).toBe(stages.length);
  });

  it("colours custom stages by what they mean", () => {
    expect(colour("Final interview")).toBe(colour("Interview"));
    expect(colour("Coding challenge")).toBe(colour("Take-Home Assignment"));
    expect(colour("Offer accepted")).toBe(colour("Offer"));
    expect(colour("Withdrawn")).toBe(colour("Rejected"));
  });

  it("falls back to a neutral colour", () => {
    expect(colour("Wishlist")).toBe(colour(null));
  });
});
