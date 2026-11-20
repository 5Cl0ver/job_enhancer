// Claude Scout page copy — the decision logic, kept pure for unit tests.
//
// While a Claude Scout run is open in the app, Claude in Chrome opens job pages
// in this browser. The content script reads each one with the same tested
// extractJob() the Save button uses and sends it up, so the app saves the
// posting word for word instead of Claude retyping it. Nothing is sent when no
// run is open (the background checks), and only real postings are sent.
import { MIN_DESCRIPTION } from "./backfill.js";

/**
 * The capture to send for this job, or null when the page doesn't show a full
 * posting yet (still loading, a snippet, or not a job page).
 * @param {import("./extract/index.js").CapturedJob & Record<string, unknown>} job
 */
export function scoutPayload(job) {
  if (!job?.title || !job?.company || !job?.url) return null;
  if ((job.description || "").length < MIN_DESCRIPTION) return null;
  return {
    url: job.url,
    title: job.title,
    company: job.company,
    location: job.location || null,
    is_remote: !!job.is_remote,
    description: job.description,
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    salary_period: job.salary_period || null,
    job_type: job.job_type || null,
    via: job._via || null,
  };
}

/** Failed sends of one job before the page stops trying it. */
export const SCOUT_MAX_FAILS = 3;

/**
 * Should the content script stop trying this job? Yes once the app stored it,
 * or once an open run turned it down (not a posting link). No while no run is
 * open, so a run that starts later still gets it, and no after an app error
 * (a cold start), so the next sync sends it again.
 * @param {{active?: boolean, stored?: boolean, failed?: boolean} | undefined} res
 */
export function scoutDone(res) {
  return !!res?.active && !res.failed;
}

// ---- Company sites (Claude Scout's "Local companies" and "Google Jobs") ----
// A company's own job page often has no JobPosting data, so the shared
// extractor finds a title but no company or description. While a run is open,
// fill those from the page itself: the site's name, and the page's main text
// word for word. Only on a page that looks like a job, so ordinary browsing
// isn't copied.

const JOBBY_PATH = /career|job|position|opening|employ|vacanc|requisition|apply|hiring|recruit|join-?us/i;
const APPLY_WORD = /\bapply\b|\bapplication\b/i;
const POSTING_WORD = /\b(responsibilities|qualifications|requirements|duties|what you.ll do)\b/i;
const BLOCK = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "TD",
  "TH", "TABLE", "SECTION", "ARTICLE", "BR", "DT", "DD", "DL", "BLOCKQUOTE", "PRE",
]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "NAV", "HEADER", "FOOTER", "FORM", "ASIDE", "BUTTON", "IFRAME"]);
const MAX_TEXT = 30000;

/** The page's text with line breaks between blocks (no layout needed). */
export function pageText(root) {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      out.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag) || node.getAttribute?.("aria-hidden") === "true") return;
    const block = BLOCK.has(tag);
    if (block) out.push("\n");
    for (const child of node.childNodes) walk(child);
    if (block) out.push("\n");
  };
  walk(root);
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT);
}

function meta(doc, selector) {
  return (doc.querySelector(selector)?.getAttribute("content") || "").trim();
}

/** The company a site belongs to: its declared name, else its domain's. */
export function siteName(doc, url, title = "") {
  const named = meta(doc, 'meta[property="og:site_name"]') || meta(doc, 'meta[name="application-name"]');
  if (named) return named;
  // "IT Systems Administrator | Brambleworks": the part that isn't the job.
  const parts = (doc.title || "").split(/\s+[|–—-]\s+/).map((p) => p.trim()).filter(Boolean);
  const other = parts.filter((p) => p.toLowerCase() !== title.toLowerCase());
  if (parts.length > 1 && other.length) return other[other.length - 1];
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  const label = host.split(".").slice(-2, -1)[0] || "";
  return label ? label[0].toUpperCase() + label.slice(1) : "";
}

/** Does this page look like one job posting (not a homepage or article)? */
export function looksLikePosting(url, text) {
  let path = "";
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    return false;
  }
  return JOBBY_PATH.test(path) || (APPLY_WORD.test(text) && POSTING_WORD.test(text));
}

/**
 * The extracted job, with its company and description filled from the page
 * when the extractor found none. Unchanged when the page doesn't look like a
 * posting or already had both.
 */
export function withPageFallback(doc, url, job) {
  if (!job?.title || (job.company && job.description)) return job;
  const main =
    doc.querySelector("main, [role='main'], article, #content, .content, #main") || doc.body;
  if (!main) return job;
  const text = pageText(main);
  if (!looksLikePosting(url, text)) return job;
  return {
    ...job,
    company: job.company || siteName(doc, url, job.title),
    description: job.description || text,
  };
}
