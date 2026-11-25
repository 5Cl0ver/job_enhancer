import { describe, expect, it } from "vitest";
import {
  type Company,
  companiesLine,
  companyStatus,
  isBoard,
  needsPlace,
  MAX_TRACKS,
  STARTER_TRACKS,
  fitBand,
  formatPay,
  isOpen,
  lookedAt,
  parsePay,
  reviewTicks,
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
    expect(splitLines("Engineer, Senior\n  Analyst \n")).toEqual([
      "Engineer, Senior",
      "Analyst",
    ]);
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
    for (const t of STARTER_TRACKS)
      expect(t.target_titles.length).toBeGreaterThan(0);
  });
});

describe("scout runs", () => {
  it("bands fit scores", () => {
    expect([
      fitBand(9),
      fitBand(8),
      fitBand(7),
      fitBand(6),
      fitBand(5),
    ]).toEqual(["Strong", "Strong", "Good", "Good", "Weak"]);
  });

  it("summarises a run in one line", () => {
    const counts = {
      picked: 1,
      saved: 1,
      skipped: 0,
      below_bar: 1,
      duplicate: 1,
      waiting_for_copy: 0,
      no_copy: 0,
    };
    expect(runSummary({ status: "queued", counts, target: 5 })).toBe(
      "Waiting for Claude to start",
    );
    // Good fits count as found whether or not they've been confirmed yet;
    // one the user passed on doesn't (Claude keeps looking).
    expect(
      runSummary({
        status: "running",
        counts: { ...counts, skipped: 3 },
        target: 5,
      }),
    ).toBe("Searching · 2 of 5 found · 2 passed over");
    expect(runSummary({ status: "done", counts, target: 5 })).toBe(
      "Done · 1 waiting for you · 1 saved · 2 passed over",
    );
    expect(
      runSummary({
        status: "stopped",
        counts: { ...counts, picked: 0, saved: 2, below_bar: 0, duplicate: 0 },
        target: 5,
      }),
    ).toBe("Stopped · 2 saved");
  });

  it("says why a finished search came back short, and the numbers add up", () => {
    const counts = {
      picked: 2,
      saved: 0,
      skipped: 0,
      below_bar: 3,
      duplicate: 0,
      waiting_for_copy: 0,
      no_copy: 1,
    };
    const looked_at = { rows: 24, in_tracker: 2, seen_before: 9, excluded: 4 };
    const line = lookedAt({ status: "done", counts, target: 5, looked_at });
    expect(line).toBe(
      "Asked for 5, found 2. Looked at 24 postings: 9 seen in earlier searches · " +
        "4 had a word you skip · 2 already in My Jobs · 3 below your bar · " +
        "1 couldn't be copied · 3 not opened.",
    );
    const numbers = [...line!.split("postings:")[1].matchAll(/(\d+) /g)].map(
      (m) => Number(m[1]),
    );
    expect(numbers.reduce((a, b) => a + b, 0) + 2).toBe(24);
    // Nothing to explain while it runs, or when it found what was asked.
    expect(
      lookedAt({ status: "running", counts, target: 5, looked_at }),
    ).toBeNull();
    expect(
      lookedAt({ status: "done", counts, target: 2, looked_at }),
    ).toBeNull();
    // A job reported without the results-page check: the numbers still add up.
    expect(
      lookedAt({ status: "done", counts, target: 5, looked_at: { rows: 3 } }),
    ).toBe(
      "Asked for 5, found 2. Looked at 6 postings: 3 below your bar · 1 couldn't be copied.",
    );
    // A run from before the counts were kept still says what it can.
    expect(
      lookedAt({ status: "done", counts, target: 5, looked_at: null }),
    ).toBe("Asked for 5, found 2. 3 below your bar · 1 couldn't be copied.");
  });

  it("counts the titles Claude said didn't fit, apart from the words you skip", () => {
    const counts = {
      picked: 1,
      saved: 0,
      skipped: 0,
      below_bar: 0,
      duplicate: 0,
      waiting_for_copy: 0,
      no_copy: 0,
    };
    const looked_at = { rows: 20, title_passed: 12, excluded: 2, seen_before: 5 };
    expect(lookedAt({ status: "done", counts, target: 3, looked_at })).toBe(
      "Asked for 3, found 1. Looked at 20 postings: 5 seen in earlier searches · " +
        "12 titles didn't fit · 2 had a word you skip.",
    );
  });

  it("ticks good fits by default and follows the user's changes", () => {
    const findings = [
      { id: "a", outcome: "picked" as const, can_save: true },
      { id: "b", outcome: "below_bar" as const, can_save: true },
      { id: "c", outcome: "picked" as const, can_save: false },
      { id: "d", outcome: "duplicate" as const, can_save: false },
    ];
    expect([...reviewTicks(findings, new Map())]).toEqual(["a"]);
    const changed = new Map([
      ["a", false],
      ["b", true],
      ["c", true], // can't be saved: never ticked
    ]);
    expect([...reviewTicks(findings, changed)]).toEqual(["b"]);
  });

  it("knows which runs are still open", () => {
    expect(isOpen({ status: "queued" })).toBe(true);
    expect(isOpen({ status: "running" })).toBe(true);
    expect(isOpen({ status: "done" })).toBe(false);
    expect(isOpen({ status: "stopped" })).toBe(false);
  });
});

describe("whereLabel", () => {
  it("says how far around a place the search looks", async () => {
    const { whereLabel } = await import("@/lib/scout");
    const base = {
      location: "Springfield, IL",
      radius_miles: 25,
      remote: "any",
    } as const;
    expect(whereLabel(base)).toBe("within 25 mi of Springfield, IL");
    expect(whereLabel({ ...base, radius_miles: null })).toBe("Springfield, IL");
    // A radius means nothing for remote-only jobs or with no place.
    expect(whereLabel({ ...base, remote: "remote_only" })).toBe(
      "Springfield, IL",
    );
    expect(whereLabel({ ...base, location: null })).toBeNull();
  });
});

describe("local companies", () => {
  it("only Local companies needs a place, and only the three boards decide distance", () => {
    expect(needsPlace("local_companies")).toBe(true);
    expect(needsPlace("google_jobs")).toBe(false);
    expect(isBoard("linkedin")).toBe(true);
    expect(isBoard("google_jobs")).toBe(false);
  });

  it("sums up a run's companies, or says nothing for other searches", () => {
    expect(companiesLine(null)).toBeNull();
    expect(companiesLine({ rows: 20 })).toBeNull();
    expect(companiesLine({ companies: 1, companies_new: 1 })).toBe(
      "Checked 1 local company: 1 new · 0 had jobs listed.",
    );
  });

  it("says what a company had and when", () => {
    const c: Company = {
      id: "c1",
      name: "Brambleworks",
      website: "https://brambleworks.example",
      careers_url: null,
      last_checked_at: "2026-11-18T12:00:00Z",
      times_checked: 1,
      last_result: "openings",
      never_check: false,
      due: false,
    };
    expect(companyStatus(c)).toMatch(/^Has jobs listed · checked Nov 1[78]$/);
    expect(companyStatus({ ...c, last_checked_at: null })).toBe(
      "Has jobs listed · checked next run",
    );
    expect(
      companyStatus({ ...c, last_result: "no_careers", never_check: true }),
    ).toBe("No careers page · you skipped it");
    expect(
      companyStatus({
        ...c,
        last_result: "not_checked",
        last_checked_at: null,
      }),
    ).toBe("Couldn't check · tried again next run");
  });
});

import { boardRadius, droppedLine, linksLine } from "@/lib/scout";

describe("wider search helpers", () => {
  it("rounds a radius up to what each board offers", () => {
    expect(boardRadius("linkedin", 40)).toBe(50);
    expect(boardRadius("indeed", 30)).toBe(35);
    expect(boardRadius("linkedin", 150)).toBe(100);
    expect(boardRadius("google_jobs", 40)).toBe(40);
  });

  it("says each search's result count and any dropped filters", () => {
    const run = {
      source: "linkedin" as const,
      links: [
        { title: "IT Administrator", total: 27, pages: 2, dropped: [] },
        { title: "M365 Admin", total: 4, pages: 1, dropped: ["sortBy"] },
        { title: "IT Specialist", total: null, pages: 0, dropped: ["sortBy"] },
      ],
    };
    expect(linksLine(run)).toBe(
      "LinkedIn's results per search: IT Administrator 27 · M365 Admin 4.",
    );
    expect(droppedLine(run)).toBe(
      "LinkedIn dropped these filters when it opened the search: sortBy.",
    );
    expect(linksLine({ source: "linkedin", links: [] })).toBeNull();
  });
});
