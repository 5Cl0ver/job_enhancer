// Unit tests for the pure job extractors, run against saved HTML fixtures.
//
// This is the core of the extension's reliability story: extraction is a pure
// function of (Document, url), so we can prove it works deterministically without
// a browser, without hitting live job boards, and without any manual clicking.
//
// NOTE ON FIXTURES: the JSON-LD fixtures mirror the schema.org JobPosting
// contract the boards actually emit (trustworthy). The selector-only fixtures
// (indeed-no-jsonld) are a best-effort reconstruction of the live DOM — when we
// have a real saved page, drop it in test/fixtures/ and point a test at it to
// lock the selectors against reality.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { extractJob } from "../src/extract/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Build a real Document from a fixture file so extractors see the same API as in Chrome. */
function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const window = new Window();
  window.document.write(html);
  return window.document;
}

describe("extractJob — JSON-LD primary path", () => {
  it("reads a full Indeed JobPosting from JSON-LD", () => {
    const job = extractJob(docFrom("indeed-jsonld.html"), "https://www.indeed.com/viewjob?jk=abc123");
    expect(job.title).toBe("Senior Software Engineer");
    expect(job.company).toBe("Acme Corp");
    expect(job.location).toBe("Austin, TX, US");
    expect(job.is_remote).toBe(false);
    expect(job.url).toBe("https://www.indeed.com/viewjob?jk=abc123");
    expect(job.description).toContain("Build great things");
    expect(job._via).toBe("jsonld");
  });

  it("detects remote from jobLocationType TELECOMMUTE (LinkedIn)", () => {
    const job = extractJob(docFrom("linkedin-remote-jsonld.html"), "https://www.linkedin.com/jobs/view/123456");
    expect(job.title).toBe("Frontend Developer");
    expect(job.company).toBe("Globex");
    expect(job.is_remote).toBe(true);
    expect(job._via).toBe("jsonld");
  });

  it("walks @graph arrays (Greenhouse-style) with no dedicated site parser", () => {
    const job = extractJob(docFrom("greenhouse-graph.html"), "https://boards.greenhouse.io/hooli/jobs/999");
    expect(job.title).toBe("Backend Engineer");
    expect(job.company).toBe("Hooli");
    expect(job.location).toBe("Palo Alto, CA");
  });
});

describe("extractJob — per-site selector fallback (no JSON-LD)", () => {
  it("reads the Indeed detail header when JSON-LD is absent", () => {
    const job = extractJob(docFrom("indeed-no-jsonld.html"), "https://www.indeed.com/viewjob?jk=xyz");
    expect(job.title).toBe("Data Analyst");
    expect(job.company).toBe("Initech");
    expect(job.location).toBe("Remote");
    expect(job.is_remote).toBe(true);
    expect(job._via).toBe("indeed");
    // The full page description (#jobDescriptionText) is captured, not just a card snippet.
    expect(job.description).toContain("Analyze all the data");
  });
});

describe("extractJob — generic fallback", () => {
  it("captures a title from og:title on an unknown site", () => {
    const job = extractJob(docFrom("generic-og.html"), "https://jobs.umbrella.com/123");
    expect(job.title).toBe("Product Manager at Umbrella");
    expect(job.company).toBe(""); // never guessed from page chrome
    expect(job._via).toBe("generic");
  });
});

describe("extractJob — never captures page chrome", () => {
  it("returns an empty title on an Indeed SEARCH page (not a job)", () => {
    const job = extractJob(docFrom("indeed-search-noise.html"), "https://www.indeed.com/jobs?q=engineer");
    expect(job.title).toBe("");
  });
});
