// Tests Indeed's embedded-JSON extraction — the reliable path across Indeed's
// search / viewjob / home-feed layouts, where CSS selectors differ or the data
// is loaded by JavaScript. Covers both the static <script> fallback and the
// MAIN-world bridge attribute.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { extractIndeedEmbedded, canonicalIndeedUrl } from "../src/extract/indeed-embedded.js";
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

describe("home-feed pane (regression: full description IS on screen — capture it)", () => {
  it("captures the full description via the 'Full job description' heading", () => {
    // The home-feed pane doesn't use #jobDescriptionText; the mosaic card only
    // has a snippet. The visible heading is the anchor.
    const doc = docFrom("indeed-pane-feed.html");
    const job = extractJob(doc, "https://www.indeed.com/?vjk=pane1");
    expect(job.title).toBe("Fabulous Junior IT Solutions Engineer");
    expect(job.company).toBe("Squeeze Technology, Inc.");
    expect(job.description).toContain("highly respected, fast-growing IT and AI");
    expect(job.description.length).toBeGreaterThan(400); // the whole thing, not the snippet
    expect(job.description).not.toContain("@layer"); // embedded <style> stays out
    expect(job.salary_min).toBe(60000); // salary comes from the card's own data
    expect(job.salary_max).toBe(70000);
    expect(job.url).toBe("https://www.indeed.com/viewjob?jk=pane1");
  });
});

describe("canonical Indeed url (fixes 'View listing' → home page)", () => {
  it("rewrites a home-feed ?vjk= url to a real /viewjob link", () => {
    expect(canonicalIndeedUrl("https://www.indeed.com/?vjk=abc123")).toBe(
      "https://www.indeed.com/viewjob?jk=abc123",
    );
  });
  it("leaves an existing /viewjob url alone", () => {
    expect(canonicalIndeedUrl("https://www.indeed.com/viewjob?jk=xyz")).toBe(
      "https://www.indeed.com/viewjob?jk=xyz",
    );
  });
  it("returns null for non-Indeed urls", () => {
    expect(canonicalIndeedUrl("https://www.linkedin.com/jobs/view/1")).toBeNull();
  });
  it("extractJob canonicalizes even when a non-embedded path wins", () => {
    // indeed-no-jsonld.html has no embedded/mosaic data → the selector path wins
    // and would otherwise keep the home-feed url.
    const doc = docFrom("indeed-no-jsonld.html");
    const job = extractJob(doc, "https://www.indeed.com/?vjk=abc123");
    expect(job.url).toBe("https://www.indeed.com/viewjob?jk=abc123");
  });
});

describe("Indeed embedded JSON — MAIN-world bridge attribute", () => {
  function bridgeDoc(payload) {
    const doc = new Window().document;
    doc.documentElement.setAttribute("data-je-embedded", JSON.stringify(payload));
    return doc;
  }

  it("strips Indeed's embedded <style> block out of descriptions (CSS-leak regression)", () => {
    // Indeed's new renderer puts a <style> tag INSIDE the description HTML;
    // naive tag-stripping saved the raw CSS as the job description.
    const doc = bridgeDoc({
      detail: {
        jobKey: "css1",
        jobTitle: "Full Stack Engineer - OE",
        companyName: "Infosys",
        formattedLocation: "Pomona, CA",
        description:
          "<style>@layer htmlContent { #react-native-html-content p { margin: 8px; } }</style>" +
          "<p>Contribute to the requirements elicitation process by documenting assigned parts.</p>" +
          "<p>Facilitate software application design discussions and document design decisions.</p>",
      },
    });
    const job = extractJob(doc, "https://www.indeed.com/viewjob?jk=css1");
    expect(job.description).toContain("requirements elicitation");
    expect(job.description).not.toContain("@layer");
    expect(job.description).not.toContain("react-native-html-content");
  });

  it("reads salary, period, and job types from the open card's own data", () => {
    const doc = bridgeDoc({
      cards: [
        {
          jobkey: "sal1",
          title: "Full Stack Engineer - OE",
          company: "Infosys",
          formattedLocation: "Pomona, CA",
          extractedSalary: { min: 80299, max: 104389, type: "yearly" },
        },
        {
          jobkey: "sal2",
          title: "Backend Engineer",
          company: "TextCo",
          salarySnippet: "$90,000 - $120,000 a year",
        },
        {
          jobkey: "sal3",
          title: "Staff Software Engineer - AI Trainer",
          company: "DataAnnotation",
          salarySnippet: "$50 - $100 an hour",
          jobTypes: ["Part-time", "Contract", "Full-time"],
        },
      ],
    });
    const structured = extractJob(doc, "https://www.indeed.com/?vjk=sal1");
    expect(structured.salary_min).toBe(80299);
    expect(structured.salary_max).toBe(104389);
    expect(structured.salary_period).toBe("yearly");

    const parsed = extractJob(doc, "https://www.indeed.com/?vjk=sal2");
    expect(parsed.salary_min).toBe(90000);
    expect(parsed.salary_max).toBe(120000);
    expect(parsed.salary_period).toBe("yearly");

    // Hourly pay is captured WITH its period (never stored as fake-yearly).
    const hourly = extractJob(doc, "https://www.indeed.com/?vjk=sal3");
    expect(hourly.salary_min).toBe(50);
    expect(hourly.salary_max).toBe(100);
    expect(hourly.salary_period).toBe("hourly");
    expect(hourly.job_type).toBe("Part-time, Contract, Full-time");
  });

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
