import { describe, expect, it } from "vitest";
import {
  MAX_TRACKS,
  STARTER_TRACKS,
  formatPay,
  parsePay,
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
