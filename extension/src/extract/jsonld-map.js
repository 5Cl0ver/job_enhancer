// Pure schema.org JobPosting helpers — NO DOM. Shared by:
//   • jsonld.js        (reads <script> tags via querySelectorAll in the page)
//   • enrich.js        (parses raw HTML in the background worker, where there's
//                       no DOM) to backfill the full description/salary/type.
import { clean, stripHtml, looksRemote } from "./util.js";

/** Walk arbitrary JSON-LD shapes (object, array, @graph) collecting JobPosting nodes. */
export function collectJobPostings(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectJobPostings(n, out);
    return;
  }
  const type = node["@type"];
  const isJob = Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
  if (isJob) out.push(node);
  if (Array.isArray(node["@graph"])) collectJobPostings(node["@graph"], out);
}

function orgName(hiringOrganization) {
  if (!hiringOrganization) return "";
  if (typeof hiringOrganization === "string") return clean(hiringOrganization);
  if (Array.isArray(hiringOrganization)) return orgName(hiringOrganization[0]);
  return clean(hiringOrganization.name);
}

function numOrNull(n) {
  const v = typeof n === "string" ? parseInt(n.replace(/[^0-9]/g, ""), 10) : n;
  return Number.isFinite(v) ? v : null;
}

// schema.org baseSalary → { salary_min, salary_max } (best effort).
function salaryFrom(job) {
  const b = job.baseSalary;
  const v = b?.value;
  if (v && typeof v === "object") {
    return {
      salary_min: numOrNull(v.minValue ?? v.value),
      salary_max: numOrNull(v.maxValue ?? v.value),
    };
  }
  return { salary_min: numOrNull(v), salary_max: null };
}

function employmentType(job) {
  const t = job.employmentType;
  return clean(Array.isArray(t) ? t[0] : t);
}

function addressText(jobLocation) {
  const loc = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const addr = loc?.address;
  if (!addr) return "";
  if (typeof addr === "string") return clean(addr);
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
    .map((p) => (typeof p === "object" ? p?.name : p))
    .filter(Boolean);
  return clean(parts.join(", "));
}

/**
 * Map a schema.org JobPosting object to our job fields (pure).
 * @returns {null | {title,company,location,is_remote,url,description,job_type,salary_min,salary_max}}
 */
export function mapJobPosting(job, url) {
  const title = clean(job.title);
  if (!title) return null; // a JobPosting with no title isn't useful

  const location = addressText(job.jobLocation);
  const description = stripHtml(job.description);
  const remoteFlag =
    job.jobLocationType === "TELECOMMUTE" ||
    !!job.applicantLocationRequirements ||
    looksRemote(title, location, description);
  const { salary_min, salary_max } = salaryFrom(job);

  return {
    title,
    company: orgName(job.hiringOrganization),
    location,
    is_remote: remoteFlag,
    url: clean(job.url) || url,
    description,
    job_type: employmentType(job),
    salary_min,
    salary_max,
  };
}

/** Parse every application/ld+json <script> body out of raw HTML (worker-safe). */
export function jobPostingsFromHtml(html) {
  const postings = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      collectJobPostings(JSON.parse(m[1].trim()), postings);
    } catch {
      /* malformed block — skip */
    }
  }
  return postings;
}
