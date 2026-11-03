// ZipRecruiter extractor — the search page's list + right-pane view.
//
// ZipRecruiter's search page (/Jobs/..., /jobs-search?...) shows the OPEN job in
// a right pane, but the page's only JSON-LD is an ItemList of all 20 results and
// its <h1>/og:title are the SEARCH ("63 It jobs in Beaverton, OR"). So the
// generic fallback saved the search heading as the title, "ZipRecruiter" as the
// company, and the whole results list as the description. This reads the pane
// instead, anchored on ZipRecruiter's stable data-testid hooks (its CSS classes
// are Tailwind utilities, which are not stable). PURE (DOM only) — unit-tested
// against test/fixtures/ziprecruiter-serp.html.
//
// A job's own page (/c/Company/Job/...) carries a JobPosting JSON-LD, which the
// JSON-LD extractor already handles; this returns null there (no right pane).
import { clean, stripHtml, looksRemote, parseJobTypes, parseSalaryText } from "./util.js";

const PANE = '[data-testid="right-pane"]';

/**
 * The open job's stable URL. The pane has no permalink of its own, but the
 * page's ItemList JSON-LD lists every result as {name, url:/c/Company/Job/...},
 * so match on the title. Falls back to the page URL.
 */
export function zipJobUrl(doc, title, fallback) {
  if (!title) return fallback;
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(s.textContent);
    } catch {
      continue;
    }
    const items = Array.isArray(data?.itemListElement) ? data.itemListElement : [];
    const hit = items.find((i) => clean(i?.name || i?.item?.name) === title);
    const url = hit?.url || hit?.item?.url;
    if (typeof url === "string" && url.startsWith("http")) return url;
  }
  return fallback;
}

/** The first pay range in the description ("$22.72 - $28.40/hour"). */
function salaryFrom(text) {
  const m = text.match(
    /\$\s?[\d,]+(?:\.\d+)?(?:\s*(?:-|–|—|to)\s*\$?\s?[\d,]+(?:\.\d+)?)?\s*(?:\/\s*(?:hour|hr|year|yr)\b|(?:a|an|per)\s+(?:hour|year)\b|hourly|annually)/i,
  );
  return m ? parseSalaryText(m[0]) : null;
}

/**
 * @param {Document} doc
 * @param {string} url
 * @returns {object|null} a partial job, or null when no job pane is open
 */
export function extractZipRecruiter(doc, url) {
  const pane = doc.querySelector(PANE);
  if (!pane) return null;

  const head = pane.querySelector('[data-testid="serp-job-details-title"]');
  const title = clean(head?.querySelector("h1, h2")?.textContent);
  if (!title) return null;
  // Location is the block right after the title ("Portland, OR").
  const location = clean(head.nextElementSibling?.querySelector("p")?.textContent);

  const employer = pane.querySelector('[data-testid="employer-details-section"]');
  const company = clean(
    employer?.querySelector('[data-testid="employer-details-header"] span')?.textContent,
  );
  // "Full-time" / benefits / posted date sit in the block right after the
  // employer name — read job types from there only, not the whole pane (the
  // description and title can mention "contract" etc. in passing).
  // (Per <p> — raw textContent runs them together: "Full-timeMedical, …".)
  const facts = [...(employer?.nextElementSibling?.querySelectorAll("p") || [])];
  const job_type = parseJobTypes(facts.map((p) => p.textContent).join(", "));

  // The description is the element right after the "Job description" heading.
  // Its later siblings (Report button, Breakroom employee reviews) are page chrome.
  const h = [...pane.querySelectorAll("h2, h3")].find((e) =>
    /^job description$/i.test(clean(e.textContent)),
  );
  const description = stripHtml(h?.nextElementSibling?.innerHTML || "");

  return {
    title,
    company,
    location,
    job_type,
    description,
    is_remote: looksRemote(title, location),
    url: zipJobUrl(doc, title, url),
    ...(salaryFrom(description) || {}),
  };
}
