// Read the applications off Indeed's "My jobs" page (myjobs.indeed.com). Each
// application is an `.atw-AppCard` carrying its own status tag, title (whose
// href is the real viewjob link), and a company/location line — so we can sync
// every one to the right pipeline stage. PURE (Document in, data out) → unit-
// tested against a saved fixture.
import { clean } from "./util.js";

// The board's status badge → the tracker pipeline stage it belongs in. Anything
// unknown defaults to "Applied" (this list is the "Applied" tab, after all).
const STATUS_TO_STAGE = [
  [/not selected|rejected|no longer|not moving forward/i, "Rejected"],
  [/interview/i, "Interview"],
  [/offer/i, "Offer"],
  [/hired/i, "Offer"],
  // "Applied", "Application viewed", "Application submitted", "Job closed or
  // expired" — the user applied; keep them in Applied.
  [/applied|application|submitted|viewed|closed|expired/i, "Applied"],
];

export function statusToStage(status) {
  const s = clean(status);
  for (const [re, stage] of STATUS_TO_STAGE) if (re.test(s)) return stage;
  return "Applied";
}

/** The visible job title, without the screen-reader-only helper text Indeed
 *  appends inside the link ("…opens in a new window"). */
function titleText(anchor) {
  // Prefer the anchor's direct text nodes (the visible label); fall back to
  // textContent with the known a11y suffix stripped.
  const direct = [...anchor.childNodes]
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent)
    .join(" ");
  const t = clean(direct);
  if (t) return t;
  return clean(anchor.textContent).replace(/job description opens in a new window/i, "").trim();
}

/**
 * @param {Document} doc
 * @returns {Array<{title,company,location,status,stage,url,jobKey}>}
 */
export function readApplications(doc) {
  if (!doc?.querySelectorAll) return [];
  const out = [];
  const seen = new Set();
  for (const card of doc.querySelectorAll(".atw-AppCard")) {
    const anchor = card.querySelector(".atw-JobInfo-jobTitle");
    if (!anchor) continue;
    const title = titleText(anchor);
    if (!title) continue;

    const spans = card.querySelectorAll(".atw-JobInfo-companyLocation span");
    const company = clean(spans[0]?.textContent || "");
    const location = clean(spans[1]?.textContent || "");

    const status = clean(
      card.querySelector(".atw-StatusTag-description")?.textContent ||
        card.querySelector(".atw-StatusTag span")?.textContent ||
        "",
    );

    // Indeed's viewjob link (href on the title), used as the listing URL when we
    // import an application the user never saved.
    let url = anchor.getAttribute("href") || "";
    try {
      if (url) url = new URL(url, "https://www.indeed.com").href;
    } catch {
      /* keep as-is */
    }
    const jobKey = card.getAttribute("data-jobkey") || card.getAttribute("data-id") || "";

    // De-dupe if the same card is rendered twice (responsive layouts).
    const key = jobKey || `${title}|${company}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ title, company, location, status, stage: statusToStage(status), url, jobKey });
  }
  return out;
}
