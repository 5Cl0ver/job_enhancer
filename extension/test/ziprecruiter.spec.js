// ZipRecruiter extraction — the search page's list + right-pane view. The page's
// h1/og:title/JSON-LD all describe the SEARCH, so before this extractor existed
// a save captured "63 It jobs in Beaverton, OR" from "ZipRecruiter". These tests
// lock in reading the open job from the pane instead, against a sanitized
// capture of a real page.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { extractZipRecruiter } from "../src/extract/ziprecruiter.js";
import { extractJob } from "../src/extract/index.js";
import { parseSalaryText } from "../src/extract/util.js";

const here = dirname(fileURLToPath(import.meta.url));
function docFrom(html) {
  const w = new Window();
  w.document.write(html);
  return w.document;
}
const SERP = readFileSync(join(here, "fixtures", "ziprecruiter-serp.html"), "utf8");
const URL = "https://www.ziprecruiter.com/Jobs/IT/-in-Beaverton,OR";

describe("extractJob on a ZipRecruiter search page", () => {
  const job = extractJob(docFrom(SERP), URL);

  it("reads the OPEN job from the right pane, not the search heading", () => {
    expect(job._via).toBe("ziprecruiter");
    expect(job.title).toBe("Data Reporting Specialist");
    expect(job.company).toBe("RR Donnelley");
    expect(job.location).toBe("Portland, OR");
    expect(job.job_type).toBe("Full-time");
    expect(job.is_remote).toBe(false);
  });

  it("links to the job's own page (from the ItemList), not the search", () => {
    expect(job.url).toMatch(/^https:\/\/www\.ziprecruiter\.com\/c\/.+\/Job\/Data-Reporting-Specialist\//);
  });

  it("captures the full description and none of the pane's chrome", () => {
    expect(job.description).toContain("RRD is a leading global provider");
    expect(job.description).toContain("Must be able to work weekends and holidays.");
    expect(job.description.length).toBeGreaterThan(1500);
    // Later siblings of the description: the Report button and Breakroom reviews.
    expect(job.description).not.toMatch(/employees say|Breakroom|Share this job/);
    // The other results in the list must not leak in.
    expect(job.description).not.toContain("MSP IT Technician");
  });

  it("parses the hourly pay range from the description", () => {
    expect(job.salary_period).toBe("hourly");
    expect(job.salary_min).toBe(23); // $22.72, rounded like every other source
    expect(job.salary_max).toBe(28); // $28.40
  });
});

describe("no job open", () => {
  it("returns null without a right pane", () => {
    expect(extractZipRecruiter(docFrom("<html><body><h1>x</h1></body></html>"), URL)).toBeNull();
  });

  it("never saves the search heading as a job title", () => {
    const doc = docFrom(SERP);
    doc.querySelector('[data-testid="right-pane"]').remove();
    expect(extractJob(doc, URL).title).toBe("");
  });
});

describe("parseSalaryText slash periods", () => {
  it("reads /hour and /yr", () => {
    expect(parseSalaryText("$22.72 - $28.40/hour")).toEqual({
      salary_min: 23,
      salary_max: 28,
      salary_period: "hourly",
    });
    expect(parseSalaryText("$90,000 - $110,000/yr")?.salary_period).toBe("yearly");
  });
});
