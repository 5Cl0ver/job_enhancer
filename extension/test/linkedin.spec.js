// LinkedIn extraction — the page renders no JSON-LD and randomizes its CSS
// class names, so the <title> tag ("Job Title | Company | LinkedIn") is the only
// stable anchor. These tests lock that in against a synthetic fixture.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { extractLinkedIn, titleFromDocTitle } from "../src/extract/linkedin.js";
import { extractJob } from "../src/extract/index.js";

const here = dirname(fileURLToPath(import.meta.url));
function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const w = new Window();
  w.document.write(html);
  return w.document;
}

const URL = "https://www.linkedin.com/jobs/view/4200000000/";

describe("titleFromDocTitle", () => {
  it("parses 'Title | Company | LinkedIn' and drops the unread badge", () => {
    expect(titleFromDocTitle("(3) Senior Platform Engineer | Initech, Inc. | LinkedIn")).toEqual({
      title: "Senior Platform Engineer",
      company: "Initech, Inc.",
    });
  });

  it("returns empty for a non-job page so we never save garbage", () => {
    expect(titleFromDocTitle("Feed | LinkedIn")).toEqual({ title: "", company: "" });
    expect(titleFromDocTitle("(12) LinkedIn")).toEqual({ title: "", company: "" });
  });
});

describe("extractLinkedIn — stable against randomized classes", () => {
  it("reads title/company from the <title>, not the hashed classes", () => {
    const job = extractLinkedIn(docFrom("linkedin-jobview.html"), URL);
    expect(job.title).toBe("Senior Platform Engineer");
    expect(job.company).toBe("Initech, Inc.");
    expect(job.location).toBe("Austin, TX");
    expect(job.is_remote).toBe(true);
  });

  it("flows through the extractJob orchestrator for a linkedin host", () => {
    const job = extractJob(docFrom("linkedin-jobview.html"), URL);
    expect(job.title).toBe("Senior Platform Engineer");
    expect(job.company).toBe("Initech, Inc.");
  });
});
