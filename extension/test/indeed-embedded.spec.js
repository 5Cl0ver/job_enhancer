// Tests Indeed's embedded-JSON extraction — the reliable path across Indeed's
// search / viewjob / home-feed layouts, where CSS selectors differ or the data
// is loaded by JavaScript. Covers both the static <script> fallback and the
// MAIN-world bridge attribute.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { extractIndeedEmbedded } from "../src/extract/indeed-embedded.js";
import { extractJob } from "../src/extract/index.js";

const here = dirname(fileURLToPath(import.meta.url));
function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const w = new Window();
  w.document.write(html);
  return w.document;
}

describe("Indeed embedded JSON — static <script> fallback", () => {
  it("reads a job page from window._initialData", () => {
    const doc = docFrom("indeed-initialdata.html");
    const job = extractIndeedEmbedded(doc, "https://www.indeed.com/viewjob?jk=z1");
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.company).toBe("Globex");
    expect(job.location).toBe("Austin, TX");
    expect(job.description).toContain("Build APIs at scale");
  });

  it("reads the OPEN job from the mosaic feed via the ?vjk= key", () => {
    const doc = docFrom("indeed-mosaic.html");
    const job = extractIndeedEmbedded(doc, "https://www.indeed.com/?vjk=bbb222");
    expect(job.title).toBe("Product Manager");
    expect(job.company).toBe("Umbrella");
    expect(job.location).toBe("New York, NY");
  });

  it("picks the remote card and flags is_remote", () => {
    const doc = docFrom("indeed-mosaic.html");
    const job = extractIndeedEmbedded(doc, "https://www.indeed.com/?vjk=aaa111");
    expect(job.title).toBe("Data Analyst");
    expect(job.is_remote).toBe(true);
  });

  it("returns null when the open job key isn't in the feed", () => {
    const doc = docFrom("indeed-mosaic.html");
    expect(extractIndeedEmbedded(doc, "https://www.indeed.com/?vjk=nope")).toBeNull();
  });
});

describe("Indeed embedded JSON — MAIN-world bridge attribute", () => {
  function bridgeDoc(payload) {
    const doc = new Window().document;
    doc.documentElement.setAttribute("data-je-embedded", JSON.stringify(payload));
    return doc;
  }

  it("reads a dedicated job page from the bridged detail (no vjk)", () => {
    const doc = bridgeDoc({
      detail: {
        jobKey: "det1",
        jobTitle: ".Net Full stack Developer",
        companyName: "Infosys",
        formattedLocation: "United States",
        description: "<p>.NET role</p>",
      },
    });
    const job = extractJob(doc, "https://www.indeed.com/viewjob?jk=det1");
    expect(job.title).toBe(".Net Full stack Developer");
    expect(job.company).toBe("Infosys");
    expect(job._via).toBe("indeed-embedded");
  });

  it("saves the OPEN card (?vjk=), NOT the stale _initialData detail", () => {
    // Regression: the pane showed one job while _initialData still held another.
    const doc = bridgeDoc({
      detail: { jobKey: "topcard", jobTitle: "Contract Software Engineer", companyName: "DataAnnotation" },
      cards: [
        { jobkey: "topcard", title: "Contract Software Engineer", company: "DataAnnotation" },
        { jobkey: "open99", title: "Software Engineer II", company: "OpenEye", formattedLocation: "Liberty Lake, WA" },
      ],
    });
    const job = extractJob(doc, "https://www.indeed.com/?vjk=open99");
    expect(job.title).toBe("Software Engineer II");
    expect(job.company).toBe("OpenEye");
    // The apply/listing url must be the real /viewjob page, not the home feed.
    expect(job.url).toBe("https://www.indeed.com/viewjob?jk=open99");
  });

  it("returns no title when the open vjk job isn't available (won't save the wrong one)", () => {
    const doc = bridgeDoc({
      detail: { jobKey: "topcard", jobTitle: "Contract Software Engineer", companyName: "DataAnnotation" },
      cards: [{ jobkey: "topcard", title: "Contract Software Engineer", company: "DataAnnotation" }],
    });
    const job = extractJob(doc, "https://www.indeed.com/?vjk=missing");
    expect(job.title).toBe(""); // better to fail than save the wrong job
  });
});
