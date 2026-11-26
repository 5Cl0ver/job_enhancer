// Bugs & ideas from Job Catcher (spec 032): the owner's report and Job
// Catcher's own failures. Pages as their site and path only (never a query),
// Job Catcher's own words only, one per kind and page every 10 minutes, and
// sending never throws or repeats.
import { describe, expect, it, vi } from "vitest";
import {
  CAUGHT_EVERY_MS,
  canRunHere,
  caughtBody,
  createCaughtReporter,
  fillFailure,
  isSaveFailure,
  ownerReport,
  placeOf,
  shortMessage,
} from "../src/background/bugReports.js";

const PAGE = "https://www.acme.wd1.example/en-US/careers/job/123/apply?token=abc123&email=wren%40example.com#step2";

function memoryStorage() {
  const data = {};
  return {
    data,
    get: vi.fn(async (k) => ({ [k]: data[k] })),
    set: vi.fn(async (o) => Object.assign(data, o)),
  };
}

describe("where it happened", () => {
  it("is the site and path, never the query or fragment", () => {
    expect(placeOf(PAGE)).toBe("acme.wd1.example/en-US/careers/job/123/apply");
    expect(placeOf("http://localhost:4000/lab/classic.html?x=1")).toBe("localhost/lab/classic.html");
    expect(placeOf("chrome://extensions")).toBe("");
    expect(placeOf("not a url")).toBe("");
    expect(placeOf("")).toBe("");
  });
});

describe("the owner's report", () => {
  it("is a Job Catcher bug with the page, the version and the note", () => {
    const body = ownerReport({
      what: "Résumé didn't attach\nThe drop zone stayed empty.",
      url: PAGE,
      version: "0.47.0",
      browser: "Chrome 142 (Windows)",
    });
    expect(body).toEqual({
      type: "bug",
      section: "job_catcher",
      title: "Résumé didn't attach",
      actual: "Résumé didn't attach\nThe drop zone stayed empty.",
      place: "acme.wd1.example/en-US/careers/job/123/apply",
      context: { job_catcher: "0.47.0", browser: "Chrome 142 (Windows)", device: "computer" },
      source: "owner",
    });
    expect(JSON.stringify(body)).not.toContain("token=");
    expect(JSON.stringify(body)).not.toContain("wren");
  });

  it("keeps the title to one short line and links to their site and path", () => {
    const long = "x".repeat(300);
    const body = ownerReport({ what: `\n\n  ${long}\nmore`, url: PAGE, version: "0.47.0" });
    expect(body.title).toHaveLength(140);
    expect(body.context).toEqual({ job_catcher: "0.47.0", device: "computer" });
    const linked = ownerReport({ what: "Broke on https://jobs.example/view/7?q=secret#top", url: PAGE, version: "1" });
    expect(linked.actual).toBe("Broke on jobs.example/view/7");
    expect(ownerReport({ what: "y".repeat(5000), url: PAGE, version: "1" }).actual).toHaveLength(2000);
  });
});

describe("Job Catcher's own failures", () => {
  it("skips saves that aren't failures: already saved, signed out", () => {
    expect(isSaveFailure("Already in your tracker")).toBe(false);
    expect(isSaveFailure("NOT_SIGNED_IN")).toBe(false);
    expect(isSaveFailure("Sign in to the Job Enhancer app to do this.")).toBe(false);
    expect(isSaveFailure("")).toBe(false);
    expect(isSaveFailure("title: String should have at most 300 characters")).toBe(true);
    expect(isSaveFailure("Failed to fetch")).toBe(true);
  });

  it("sends the kind, the page without its query, a short message and the version", () => {
    const body = caughtBody({ kind: "save_failed", url: PAGE, message: `Save failed at ${PAGE}\n${"z".repeat(400)}`, version: "0.47.0" });
    expect(body.section).toBe("job_catcher");
    expect(body.kind).toBe("save_failed");
    expect(body.place).toBe("acme.wd1.example/en-US/careers/job/123/apply");
    expect(body.message).toHaveLength(300);
    expect(body.message.startsWith("Save failed at acme.wd1.example/en-US/careers/job/123/apply z")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("?");
    expect(body.context).toEqual({ job_catcher: "0.47.0" });
    expect(shortMessage("  a\n\n b  ")).toBe("a b");
  });

  it("sends one per kind and page every 10 minutes", async () => {
    let t = 1_000_000;
    const send = vi.fn().mockResolvedValue(undefined);
    const storage = memoryStorage();
    const r = createCaughtReporter({ send, version: "0.47.0", now: () => t, storage });

    expect(await r.report("save_failed", PAGE, "Save failed")).toBe(true);
    expect(await r.report("save_failed", `${PAGE}&again=1`, "Save failed")).toBe(false); // same page
    expect(await r.report("resume_failed", PAGE, "The résumé didn't go in")).toBe(true); // another kind
    expect(await r.report("save_failed", "https://jobs.example/view/9", "Save failed")).toBe(true); // another page
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0]).toEqual(caughtBody({ kind: "save_failed", url: PAGE, message: "Save failed", version: "0.47.0" }));

    t += CAUGHT_EVERY_MS - 1;
    expect(await r.report("save_failed", PAGE, "Save failed")).toBe(false);
    t += 1;
    expect(await r.report("save_failed", PAGE, "Save failed")).toBe(true);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("remembers across a worker that slept (session storage)", async () => {
    const storage = memoryStorage();
    const send = vi.fn().mockResolvedValue(undefined);
    await createCaughtReporter({ send, version: "1", now: () => 5, storage }).report("fill_failed", PAGE, "No answer");
    const woke = createCaughtReporter({ send, version: "1", now: () => 6, storage });
    expect(await woke.report("fill_failed", PAGE, "No answer")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never throws, never retries, and leaves unknown kinds and non-web pages alone", async () => {
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    const storage = { get: vi.fn().mockRejectedValue(new Error("no storage")), set: vi.fn().mockRejectedValue(new Error("no storage")) };
    const r = createCaughtReporter({ send, version: "1", now: () => 10, storage });
    await expect(r.report("save_failed", PAGE, "Save failed")).resolves.toBe(false);
    await expect(r.report("save_failed", PAGE, "Save failed")).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(1); // the failed one waits its 10 minutes too
    expect(await r.report("crash", PAGE, "x")).toBe(false);
    expect(await r.report("fill_failed", "chrome://newtab", "x")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("which failed presses the owner hears about", () => {
  it("only Job Catcher's own: too slow, or no answer from a page whose reader was there", () => {
    expect(fillFailure({ problem: "slow", url: PAGE, hadForm: false })).toBe("Autofill took longer than 90 seconds on the page.");
    expect(fillFailure({ problem: "refresh", url: PAGE, hadForm: true })).toBe("Autofill got no answer from the page.");
    // No reader ever answered there (it can't run, or never loaded): not a bug.
    expect(fillFailure({ problem: "refresh", url: PAGE, hadForm: false })).toBeNull();
    expect(fillFailure({ problem: "signed_out", url: PAGE, hadForm: true })).toBeNull();
    expect(fillFailure({ problem: "asleep", url: PAGE, hadForm: true })).toBeNull();
  });

  it("never pages Chrome keeps extensions off: the Web Store, PDFs, browser pages", () => {
    for (const url of [
      "https://chromewebstore.google.com/detail/abc",
      "https://chrome.google.com/webstore/detail/abc",
      "https://microsoftedge.microsoft.com/addons/detail/abc",
      "https://acme.example/files/offer.pdf?dl=1",
      "chrome://extensions",
    ]) {
      expect(canRunHere(url)).toBe(false);
      expect(fillFailure({ problem: "slow", url, hadForm: true })).toBeNull();
    }
    expect(canRunHere("https://chrome.google.com/search")).toBe(true);
    expect(canRunHere(PAGE)).toBe(true);
  });
});
