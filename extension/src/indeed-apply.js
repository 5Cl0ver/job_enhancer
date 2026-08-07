// Detects Indeed's Quick-Apply flow so we can auto-track it — no manual
// "Mark applied" click. PURE (DOM in, data out) so it's unit-tested.
//
// Two things to read off the apply pages:
//   1. The job identity — a compact "Title / Company - Location" card is shown
//      on each apply step (location, resume, questions). We stash it as the
//      user progresses.
//   2. The submission confirmation — "Your application was submitted to X".
//      When that appears, we mark the stashed job applied.
import { clean } from "./extract/util.js";

/** Is this an Indeed application flow (not a job listing / search page)? */
export function isIndeedApplyUrl(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)smartapply\.indeed\.com$/i.test(u.hostname)) return true;
    // "applystart", "indeedapply", "/apply" — listing urls (/viewjob, /?vjk=)
    // don't contain "apply".
    return /(^|\.)indeed\./i.test(u.hostname) && /apply/i.test(u.pathname);
  } catch {
    return false;
  }
}

// Company is captured up to the end of the line/sentence — NOT across the
// whole page (the next line is usually the email confirmation).
const SUBMITTED_RE = /your application (?:was|has been) submitted(?:\s+to\s+([^\n.!]+))?/i;

export function submittedCompany(doc) {
  const body = doc?.body?.textContent || "";
  const m = SUBMITTED_RE.exec(body);
  if (!m) return null;
  return m[1] ? clean(m[1]).slice(0, 120) : "";
}

export function isSubmitted(doc) {
  return submittedCompany(doc) !== null;
}

// A "Company - Location" line: "Align Communications - Los Angeles, CA 90640".
const CO_LOC_RE = /^(.{2,80}?)\s+[-–·•]\s+(?:remote|[A-Za-z .'&]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i;

/** Nearest short heading/bold text before `el` — the job title. */
function nearestTitle(el) {
  let node = el;
  for (let hops = 0; hops < 6 && node; hops++) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      const t = clean(sib.textContent);
      if (t && t.length <= 120 && !CO_LOC_RE.test(t)) return t;
    }
    node = node.parentElement;
  }
  return "";
}

/**
 * The job identity from the apply flow's compact card.
 * @returns {{title:string, company:string} | null}
 */
export function scrapeApplyHeader(doc) {
  if (!doc?.querySelectorAll) return null;
  for (const el of doc.querySelectorAll("h1,h2,h3,h4,p,span,div,a")) {
    if (el.querySelector?.("*")) continue; // leaf line only ("Company - Location")
    const t = clean(el.textContent);
    const m = CO_LOC_RE.exec(t);
    if (!m) continue;
    const company = clean(m[1]);
    const title = nearestTitle(el);
    if (company) return { title, company };
  }
  return null;
}
