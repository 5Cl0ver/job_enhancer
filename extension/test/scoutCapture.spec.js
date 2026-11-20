// Claude Scout page copy: what gets sent, and when the page stops trying.
import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import {
  looksLikePosting,
  pageText,
  scoutDone,
  scoutPayload,
  siteName,
  withPageFallback,
} from "../src/scoutCapture.js";
import { MIN_DESCRIPTION } from "../src/backfill.js";

const job = {
  title: "IT Systems Administrator",
  company: "Brambleworks",
  location: "Springfield, IL",
  is_remote: false,
  url: "https://www.linkedin.com/jobs/view/4012345678/",
  description: "About the job ".repeat(30),
  salary_min: 72000,
  salary_max: 85000,
  salary_period: "yearly",
  job_type: "",
  _via: "linkedin",
};

describe("scoutPayload", () => {
  it("sends the posting exactly as extracted", () => {
    const p = scoutPayload(job);
    expect(p.description).toBe(job.description);
    expect(p).toMatchObject({
      url: job.url,
      title: job.title,
      company: job.company,
      salary_min: 72000,
      salary_period: "yearly",
      job_type: null,
      via: "linkedin",
    });
  });

  it("waits while the description is still a snippet or missing", () => {
    expect(scoutPayload({ ...job, description: "x".repeat(MIN_DESCRIPTION - 1) })).toBeNull();
    expect(scoutPayload({ ...job, description: undefined })).toBeNull();
  });

  it("needs a title, company and link", () => {
    expect(scoutPayload({ ...job, title: "" })).toBeNull();
    expect(scoutPayload({ ...job, company: "" })).toBeNull();
    expect(scoutPayload({ ...job, url: "" })).toBeNull();
  });
});

describe("scoutDone", () => {
  it("keeps trying while no run is open, so a run that starts later still gets it", () => {
    expect(scoutDone({ active: false })).toBe(false);
    expect(scoutDone(undefined)).toBe(false);
  });

  it("stops once an open run has answered", () => {
    expect(scoutDone({ active: true, stored: true })).toBe(true);
    expect(scoutDone({ active: true, stored: false })).toBe(true);
  });

  it("tries again when the app errored (a cold start), so the copy isn't lost", () => {
    expect(scoutDone({ active: true, stored: false, failed: true })).toBe(false);
  });
});

describe("company sites (Local companies / Google Jobs)", () => {
  const POST = `
    <html><head><title>IT Systems Administrator | Brambleworks</title></head><body>
      <nav><a href="/">Home</a><a href="/about">About</a></nav>
      <main>
        <h1>IT Systems Administrator</h1>
        <p>Brambleworks is hiring an IT Systems Administrator for our Springfield office.</p>
        <h2>Responsibilities</h2>
        <ul><li>Run Microsoft 365 and Entra ID for 400 staff</li><li>Automate onboarding with PowerShell</li></ul>
        <h2>Qualifications</h2>
        <ul><li>3+ years administering Microsoft 365</li></ul>
        <p>To apply, send your resume to our hiring team.</p>
        <script>window.tracking = 1;</script>
      </main>
      <footer>© Brambleworks</footer>
    </body></html>`;

  function docOf(html) {
    const window = new Window();
    window.document.write(html);
    return window.document;
  }

  const url = "https://brambleworks.example/careers/it-systems-administrator";

  it("fills the company and the page's own text when the extractor found none", () => {
    const doc = docOf(POST);
    const job = withPageFallback(doc, url, { title: "IT Systems Administrator", company: "", url });
    expect(job.company).toBe("Brambleworks");
    expect(job.description).toContain("Run Microsoft 365 and Entra ID for 400 staff\nAutomate onboarding");
    expect(job.description).not.toContain("tracking");
    expect(job.description).not.toContain("About");
    expect(scoutPayload(job)).not.toBeNull();
  });

  it("leaves a page that doesn't look like a job alone", () => {
    const doc = docOf("<html><head><title>Our story | Brambleworks</title></head><body><main><h1>Our story</h1><p>" +
      "We started in a garage. ".repeat(20) + "</p></main></body></html>");
    const job = { title: "Our story", company: "", url: "https://brambleworks.example/about" };
    expect(withPageFallback(doc, job.url, job)).toBe(job);
  });

  it("keeps what the extractor already had", () => {
    const job = { title: "T", company: "Vellacor", description: "From JSON-LD", url };
    expect(withPageFallback(docOf(POST), url, job)).toBe(job);
  });

  it("names the site from its own name, the title, or the domain", () => {
    const named = docOf('<html><head><meta property="og:site_name" content="Vellacor Health"></head><body></body></html>');
    expect(siteName(named, url)).toBe("Vellacor Health");
    expect(siteName(docOf("<html><head><title>Help Desk Technician – Quillstone</title></head></html>"), url, "Help Desk Technician")).toBe("Quillstone");
    expect(siteName(docOf("<html><head><title>Jobs</title></head></html>"), "https://www.quillstone.example/jobs/1")).toBe("Quillstone");
  });

  it("tells a posting from other pages", () => {
    expect(looksLikePosting("https://a.example/careers/123", "")).toBe(true);
    expect(looksLikePosting("https://a.example/jobs/123", "")).toBe(true);
    expect(looksLikePosting("https://a.example/employment", "")).toBe(true);
    expect(
      looksLikePosting("https://a.example/p?id=9", "Apply now. Responsibilities: … Qualifications: …"),
    ).toBe(true);
    expect(looksLikePosting("https://a.example/blog/news", "Read our news")).toBe(false);
    // Not a job: a loan form, a staff portal, one stray "requirements".
    expect(looksLikePosting("https://bank.example/loans/apply", "")).toBe(false);
    expect(looksLikePosting("https://a.example/employee/portal", "")).toBe(false);
    expect(looksLikePosting("https://a.example/p", "Apply for a permit. Requirements: ID")).toBe(false);
    expect(looksLikePosting("https://a.example/steve-jobs-biography", "")).toBe(false);
    // Small companies' hiring systems and page names.
    for (const url of [
      "https://acme.applytojob.com/apply/AbC123/IT-Technician",
      "https://jobs.lever.co/acme/0b1c2d3e-4f50-6789-abcd-ef0123456789",
      "https://apply.workable.com/acme/j/ABC123/",
      "https://acme.example/JobDetails.aspx?id=1",
      "https://acme.example/job_details/12",
      "https://careers.acme.example/123",
    ]) {
      expect(looksLikePosting(url, "")).toBe(true);
    }
  });

  it("reads text with breaks between blocks", () => {
    const doc = docOf("<html><body><div><p>One  two</p><p>three</p></div></body></html>");
    expect(pageText(doc.body)).toBe("One two\nthree");
  });
});
