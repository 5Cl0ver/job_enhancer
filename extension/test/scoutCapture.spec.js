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
  pageTitle,
} from "../src/scoutCapture.js";
import { MIN_DESCRIPTION } from "../src/backfill.js";
import { extractJob } from "../src/extract/index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

// Spec 012: company careers pages on hiring systems were never copied. These
// fixtures are the two kinds a Local companies run met: a Workday-style page
// that draws itself (no title tags) and an Oleeo (tal.net) page.
describe("hiring-system pages (spec 012)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = (name) => {
    const window = new Window();
    window.document.write(readFileSync(join(here, "fixtures", name), "utf8"));
    return window.document;
  };

  it("copies a Workday-style page with no title tags", () => {
    const url =
      "https://vellacor.wd1.myworkdayjobs.com/en-US/External/job/Springfield-IL/IT-Systems-Administrator_R-1042";
    const doc = fixture("workday-posting.html");
    const job = withPageFallback(doc, url, extractJob(doc, url));
    expect(job.title).toBe("IT Systems Administrator");
    expect(job.company).toBe("Vellacor");
    expect(job.location).toBe("Springfield, IL");
    expect(job.description).toContain("Manage laptops in Intune and keep them patched");
    expect(job.description).not.toContain("Sign In");
    const payload = scoutPayload(job);
    expect(payload).not.toBeNull();
    expect(payload.url).toBe(url);
  });

  it("copies an Oleeo (tal.net) page", () => {
    const url =
      "https://quillstone.tal.net/vx/lang-en-GB/mobile-0/appcentre-ext/brand-2/candidate/so/pm/1/pl/1/opp/2214-Help-Desk-Analyst/en-GB";
    const doc = fixture("oleeo-posting.html");
    const job = withPageFallback(doc, url, extractJob(doc, url));
    expect(job.title).toBe("Help Desk Analyst");
    expect(job.company).toBe("Quillstone Council"); // the title's other half
    expect(job.description).toContain("Reset accounts in Active Directory");
    expect(scoutPayload(job)).not.toBeNull();
  });

  it("names the company right on hiring systems, or not at all", () => {
    const blank = new Window().document;
    const name = (url) => siteName(blank, url, "Systems Administrator");
    expect(name("https://vellacor.wd1.myworkdayjobs.com/en-US/External/job/1")).toBe("Vellacor");
    expect(name("https://careers-brambleworks.icims.com/jobs/12/job")).toBe("Brambleworks");
    for (const url of [
      "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=1",
      "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1",
      "https://career4.successfactors.com/career?career_job_req_id=77",
      "https://recruiting2.ultipro.com/VEL1000/JobBoard/abc/OpportunityDetail?opportunityId=1",
    ]) {
      expect(name(url)).toBe("");
    }
    // The page title still names it.
    const titled = new Window();
    titled.document.write("<html><head><title>Systems Administrator | Brambleworks</title></head></html>");
    expect(siteName(titled.document, "https://workforcenow.adp.com/x", "Systems Administrator")).toBe("Brambleworks");
  });

  it("doesn't copy a hiring system's job list", () => {
    const window = new Window();
    window.document.write(
      "<html><body><main><h1>Search for jobs</h1><ul><li>IT Technician</li><li>Payroll Clerk</li></ul></main></body></html>",
    );
    const url = "https://vellacor.wd1.myworkdayjobs.com/en-US/External";
    const job = withPageFallback(window.document, url, { title: "", company: "", url });
    expect(scoutPayload(job)).toBeNull();
  });

  it("knows more hiring systems, and finds a title where there are no tags", () => {
    for (const url of [
      "https://quillstone.tal.net/vx/candidate/so/pm/1/pl/1/opp/2214-Help-Desk-Analyst/en-GB",
      "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1234",
      "https://career4.successfactors.com/career?career_job_req_id=77",
      "https://vellacor.wd1.myworkdaysite.com/recruiting/vellacor/External/job/1",
    ]) {
      expect(looksLikePosting(url, "")).toBe(true);
    }
    const window = new Window();
    window.document.write('<html><head><meta property="og:title" content="Field Technician"></head><body></body></html>');
    expect(pageTitle(window.document)).toBe("Field Technician");
  });
});
