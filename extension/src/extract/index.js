// Orchestrator: turn a job page (Document + url) into a single CapturedJob.
//
// Strategy — try the most reliable source first, then fill gaps:
//   1. JSON-LD JobPosting  (standardized; best when present)
//   2. per-site selectors  (Indeed / LinkedIn detail pages)
//   3. generic og:title/h1 (any other site)
// Fields are merged first-non-empty-wins in that priority order, so a site
// parser can supply a company that JSON-LD omitted, etc.
//
// This module is PURE (no chrome.* / window globals) so it is unit-tested
// directly against saved HTML fixtures under test/fixtures/.
import { extractFromJsonLd } from "./jsonld.js";
import { extractIndeedEmbedded, canonicalIndeedUrl } from "./indeed-embedded.js";
import { extractIndeed, extractIndeedApply } from "./indeed.js";
import { extractLinkedIn } from "./linkedin.js";
import { extractGeneric } from "./generic.js";
import { mergeJob } from "./util.js";

/** @typedef {{title:string,company:string,location:string,is_remote:boolean,url:string,description?:string,_via:string}} CapturedJob */

function siteExtractor(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (host.includes("indeed.")) return { via: "indeed", fn: extractIndeed };
  if (host.includes("linkedin.")) return { via: "linkedin", fn: extractLinkedIn };
  return null;
}

/**
 * @param {Document} doc
 * @param {string} url
 * @returns {CapturedJob}  (title may be "" if nothing usable was found)
 */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function extractJob(doc, url) {
  const candidates = [];

  // Indeed's embedded JSON is the most reliable source across its layouts
  // (search / viewjob / home feed) — try it first on Indeed.
  if (hostOf(url).includes("indeed.")) {
    const embedded = extractIndeedEmbedded(doc, url);
    if (embedded) candidates.push({ via: "indeed-embedded", data: embedded });
    // The Quick-Apply flow has no embedded JSON / viewjob markup — read the
    // full posting off its apply-card. No-op (null) on normal Indeed pages.
    const apply = extractIndeedApply(doc, url);
    if (apply) candidates.push({ via: "indeed-apply", data: apply });
  }

  const jsonld = extractFromJsonLd(doc, url);
  if (jsonld) candidates.push({ via: "jsonld", data: jsonld });

  const site = siteExtractor(url);
  if (site) candidates.push({ via: site.via, data: site.fn(doc, url) });

  candidates.push({ via: "generic", data: extractGeneric(doc, url) });

  const result = mergeJob(candidates, url);

  // Canonicalize Indeed links in ONE place, whatever extraction path won — a
  // home-feed ?vjk= url redirects to Indeed's front page instead of the job.
  if (hostOf(url).includes("indeed.")) {
    result.url = canonicalIndeedUrl(result.url) || canonicalIndeedUrl(url) || result.url;
  }

  return result;
}
