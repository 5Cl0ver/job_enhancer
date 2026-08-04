// Tests the background-worker enrichment: pull the FULL description + salary +
// job type out of a listing page's raw HTML (no DOM). Verified separately that
// a real Indeed /viewjob fetch contains this JSON-LD.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { enrichFromHtml } from "../src/enrich.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixtures", "indeed-viewjob.html"), "utf8");

describe("enrichFromHtml", () => {
  it("extracts the full description, salary range, and job type from raw HTML", () => {
    const out = enrichFromHtml(html, "https://www.indeed.com/viewjob?jk=x");
    expect(out.description).toContain("Design and build Java/J2EE applications on AWS");
    expect(out.description).toContain("5+ years experience");
    expect(out.salary_min).toBe(101994);
    expect(out.salary_max).toBe(162831);
    expect(out.job_type).toBe("FULL_TIME");
  });

  it("returns an empty object when there's no JobPosting JSON-LD", () => {
    expect(enrichFromHtml("<html><body>nothing here</body></html>", "https://x")).toEqual({});
    expect(enrichFromHtml("", "https://x")).toEqual({});
  });
});
