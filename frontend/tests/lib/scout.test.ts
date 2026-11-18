import { describe, expect, it } from "vitest";
import {
  MAX_TRACKS,
  STARTER_TRACKS,
  fitBand,
  formatPay,
  isOpen,
  parsePay,
  runSummary,
  splitLines,
  splitList,
} from "@/lib/scout";

describe("splitList / splitLines", () => {
  it("splits skills on commas or new lines, dropping blanks", () => {
    expect(splitList("Microsoft 365, Entra ID\n\nPowerShell ,")).toEqual([
      "Microsoft 365",
      "Entra ID",
      "PowerShell",
    ]);
  });

  it("keeps commas inside a title", () => {
    expect(splitLines("Engineer, Senior\n  Analyst \n")).toEqual(["Engineer, Senior", "Analyst"]);
  });
});

describe("pay", () => {
  it("reads the ways people type a salary", () => {
    expect(parsePay("$70K")).toBe(70000);
    expect(parsePay("70,000")).toBe(70000);
    expect(parsePay("72.5k")).toBe(72500);
    expect(parsePay("  ")).toBeNull();
    expect(parsePay("lots")).toBeNaN();
    expect(parsePay("-5")).toBeNaN();
  });

  it("shows pay short", () => {
    expect(formatPay(72000)).toBe("$72K");
    expect(formatPay(null)).toBeNull();
  });
});

describe("starter resume types", () => {
  it("fit within the limit, with unique names and some titles each", () => {
    expect(STARTER_TRACKS.length).toBeLessThanOrEqual(MAX_TRACKS);
    expect(new Set(STARTER_TRACKS.map((t) => t.name.toLowerCase())).size).toBe(
      STARTER_TRACKS.length,
    );
    for (const t of STARTER_TRACKS) expect(t.target_titles.length).toBeGreaterThan(0);
  });
});

describe("scout runs", () => {
  it("bands fit scores", () => {
    expect([fitBand(9), fitBand(8), fitBand(7), fitBand(6), fitBand(5)]).toEqual([
      "Strong",
      "Strong",
      "Good",
      "Good",
      "Weak",
    ]);
  });

  it("summarises a run in one line", () => {
    const counts = { saved: 2, below_bar: 1, duplicate: 1, waiting_for_copy: 0, no_copy: 0 };
    expect(runSummary({ status: "queued", counts, target: 5 })).toBe(
      "Waiting for Claude to start",
    );
    expect(runSummary({ status: "running", counts, target: 5 })).toBe(
      "Searching · 2 of 5 saved · 2 passed over",
    );
    expect(runSummary({ status: "done", counts: { ...counts, below_bar: 0, duplicate: 0 }, target: 5 })).toBe(
      "Done · 2 saved",
    );
  });

  it("knows which runs are still open", () => {
    expect(isOpen({ status: "queued" })).toBe(true);
    expect(isOpen({ status: "running" })).toBe(true);
    expect(isOpen({ status: "done" })).toBe(false);
    expect(isOpen({ status: "stopped" })).toBe(false);
  });
});
