// The side panel's saved-jobs refresh: a cheap change check at most once a
// minute while visible + focused — no 15-second full-list poll.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSavedSync, parseSummary, MIN_INTERVAL_MS } from "../src/savedSync.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

function harness({ active = true, responses = [] } = {}) {
  let t = 1_000_000;
  const state = { active };
  const fetchSummary = vi.fn(async (version) => {
    const next = responses.shift() ?? { signedIn: true, changed: false, version };
    return typeof next === "function" ? next(version) : next;
  });
  const onJobs = vi.fn();
  const onError = vi.fn();
  const onSignedOut = vi.fn();
  const sync = createSavedSync({
    fetchSummary,
    onJobs,
    onError,
    onSignedOut,
    isActive: () => state.active,
    now: () => t,
  });
  return {
    sync,
    fetchSummary,
    onJobs,
    onError,
    onSignedOut,
    state,
    advance: (ms) => (t += ms),
  };
}

const changed = (version, jobs = [{ id: "a" }]) => ({ signedIn: true, changed: true, version, jobs });

describe("the old poll is gone", () => {
  const panel = read("../sidepanel.js");

  it("has no 15-second (or any sub-minute) saved-jobs interval", () => {
    expect(panel).not.toMatch(/setInterval\(\s*maybeRefresh/);
    expect(panel).not.toMatch(/setInterval\([^)]*15000/);
    const intervals = [...panel.matchAll(/setInterval\(([^,]+),\s*([^)]+)\)/g)].map((m) => [
      m[1].trim(),
      m[2].trim(),
    ]);
    expect(intervals).toEqual([
      ["maybeCheck", "self.JobEnhancerSavedSync.MIN_INTERVAL_MS"],
      ["refreshContext", "3000"], // context card only: tab info, no API call
    ]);
  });

  it("focus and visibility only run the throttled change check", () => {
    const body = panel.slice(panel.indexOf("const maybeCheck"), panel.indexOf("setInterval(maybeCheck"));
    expect(body).toContain("savedSync.check()");
    expect(body).not.toMatch(/loadSaved\(|listSaved|force/);
  });

  it("background asks the change-check endpoint, not the full list", () => {
    const bg = read("../src/background.entry.js");
    const fn = bg.slice(bg.indexOf("async function listSaved("), bg.indexOf("async function listSavedLegacy"));
    expect(fn).toContain("/v1/saved-jobs/summary");
    expect(fn).toContain("version=");
    expect(fn).not.toMatch(/saved-jobs\/`/); // the full list is only the 404 fallback
  });

  it("the panel loads the bundled check before its own script", () => {
    const html = read("../sidepanel.html");
    expect(html.indexOf("dist/sidepanel-sync.js")).toBeGreaterThan(-1);
    expect(html.indexOf("dist/sidepanel-sync.js")).toBeLessThan(html.indexOf('src="sidepanel.js"'));
  });
});

describe("change check", () => {
  it("an unchanged check sends the version and downloads nothing", async () => {
    const h = harness({ responses: [changed("v1")] });
    expect(await h.sync.check({ force: true })).toBe("changed");
    expect(h.onJobs).toHaveBeenCalledTimes(1);
    h.advance(MIN_INTERVAL_MS);
    expect(await h.sync.check()).toBe("unchanged");
    expect(h.fetchSummary).toHaveBeenLastCalledWith("v1");
    expect(h.onJobs).toHaveBeenCalledTimes(1); // list not re-rendered or re-fetched
  });

  it("runs at most once a minute no matter how many focus events", async () => {
    const h = harness({ responses: [changed("v1")] });
    await h.sync.check();
    for (let i = 0; i < 20; i++) {
      h.advance(2_000);
      await h.sync.check(); // focus / visibility / tick
    }
    expect(h.fetchSummary).toHaveBeenCalledTimes(1);
    h.advance(MIN_INTERVAL_MS);
    await h.sync.check();
    expect(h.fetchSummary).toHaveBeenCalledTimes(2);
  });

  it("does nothing while the panel is hidden or unfocused", async () => {
    const h = harness({ active: false });
    for (let i = 0; i < 10; i++) {
      h.advance(MIN_INTERVAL_MS);
      expect(await h.sync.check()).toBe("skipped");
    }
    expect(h.fetchSummary).not.toHaveBeenCalled();
  });

  it("an hour with the panel open costs at most 60 cheap checks", async () => {
    const h = harness({ responses: [changed("v1")] });
    for (let s = 0; s < 3600; s += 15) {
      await h.sync.check(); // even if something fired every 15 s
      h.advance(15_000);
    }
    expect(h.fetchSummary.mock.calls.length).toBeLessThanOrEqual(60);
    expect(h.onJobs).toHaveBeenCalledTimes(1); // list downloaded once
  });

  it("a save and the background's jobSaved ping share one request", async () => {
    let resolve;
    const h = harness({
      responses: [() => new Promise((r) => (resolve = r))],
    });
    const a = h.sync.check({ force: true }); // after the save
    const b = h.sync.check({ force: true }); // "jobSaved" message
    resolve(changed("v2"));
    await Promise.all([a, b]);
    expect(h.fetchSummary).toHaveBeenCalledTimes(1);
    expect(h.onJobs).toHaveBeenCalledTimes(1);
  });

  it("a save skips the minute wait but still only downloads on change", async () => {
    const h = harness({ responses: [changed("v1"), changed("v2")] });
    await h.sync.check();
    h.advance(5_000);
    expect(await h.sync.check()).toBe("skipped");
    expect(await h.sync.check({ force: true })).toBe("changed");
    expect(h.onJobs).toHaveBeenCalledTimes(2);
  });

  it("shows errors, keeps the last list, and clears the error on success", async () => {
    const h = harness({
      responses: [changed("v1"), { signedIn: true, error: "Couldn't load your saved jobs (error 502)." }],
    });
    await h.sync.check({ force: true });
    expect(await h.sync.check({ force: true })).toBe("error");
    expect(h.onError).toHaveBeenLastCalledWith("Couldn't load your saved jobs (error 502).");
    expect(h.onJobs).toHaveBeenCalledTimes(1); // nothing cleared
    expect(await h.sync.check({ force: true })).toBe("unchanged");
    expect(h.onError).toHaveBeenLastCalledWith(null);
    expect(h.sync.version).toBe("v1");
  });

  it("network failures become a readable error", async () => {
    const h = harness({
      responses: [
        () => {
          throw new Error("Failed to fetch");
        },
      ],
    });
    expect(await h.sync.check({ force: true })).toBe("error");
    expect(h.onError).toHaveBeenLastCalledWith("Failed to fetch");
  });

  it("a signed-out answer sends the panel to sign-in", async () => {
    const h = harness({ responses: [{ signedIn: false }] });
    expect(await h.sync.check({ force: true })).toBe("signed_out");
    expect(h.onSignedOut).toHaveBeenCalledTimes(1);
  });
});

describe("parseSummary", () => {
  it("maps the slim list", () => {
    expect(
      parseSummary({
        version: "v9",
        changed: true,
        jobs: [
          {
            id: "s1",
            job_listing_id: "l1",
            title: "Data Analyst",
            company: "Orbweaver",
            location: "Remote",
            url: "https://jobs.example/1",
            applied_at: "2026-11-01T10:00:00Z",
          },
        ],
      }),
    ).toEqual({
      changed: true,
      version: "v9",
      jobs: [
        {
          id: "s1",
          job_listing_id: "l1",
          title: "Data Analyst",
          company: "Orbweaver",
          location: "Remote",
          url: "https://jobs.example/1",
          applied: true,
        },
      ],
    });
  });

  it("unchanged carries no list", () => {
    expect(parseSummary({ version: "v9", changed: false })).toEqual({ changed: false, version: "v9" });
  });

  it("a malformed body is an error, not an empty list", () => {
    expect(parseSummary(null).error).toBeTruthy();
    expect(parseSummary({ jobs: [] }).error).toBeTruthy();
  });
});
