// Primary extractor: schema.org JobPosting embedded as JSON-LD.
// Indeed, LinkedIn, Glassdoor, Greenhouse, Lever, Workday and thousands of other
// boards emit <script type="application/ld+json"> with @type "JobPosting". This
// is a stable, documented contract — far less brittle than CSS selectors — so we
// try it first and fall back to per-site selectors only when it's missing.
import { clean, stripHtml, looksRemote } from "./util.js";

/** Walk arbitrary JSON-LD shapes (object, array, @graph) collecting JobPosting nodes. */
function collectJobPostings(node, out) {
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
 * @returns {null | {title,company,location,is_remote,url,description}}
 */
export function extractFromJsonLd(doc, url) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const postings = [];
  for (const s of scripts) {
    let parsed;
    try {
      parsed = JSON.parse(s.textContent);
    } catch {
      continue; // malformed block — skip, don't blow up the whole capture
    }
    collectJobPostings(parsed, postings);
  }
  if (!postings.length) return null;

  const job = postings[0];
  const title = clean(job.title);
  if (!title) return null; // a JobPosting with no title isn't useful

  const location = addressText(job.jobLocation);
  const description = stripHtml(job.description);
  const remoteFlag =
    job.jobLocationType === "TELECOMMUTE" ||
    !!job.applicantLocationRequirements ||
    looksRemote(title, location, description);

  return {
    title,
    company: orgName(job.hiringOrganization),
    location,
    is_remote: remoteFlag,
    url: clean(job.url) || url,
    description,
  };
}
