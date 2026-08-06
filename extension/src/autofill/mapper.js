// ATS form mapper — PURE (no chrome.*), unit-tested against saved form HTML.
//
// Detect which ATS a page belongs to, then map every fillable control to a
// profile-vault key by reading what the USER reads: labels first, then
// placeholder/name/id. Label-driven mapping survives markup changes the same
// way heading-anchored capture does — the words shown to humans are stable.

/** Which ATS rents this page its application form? */
export function detectAts(url) {
  let host = "", path = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname;
  } catch {
    return null;
  }
  if (/(^|\.)greenhouse\.io$/i.test(host)) return "greenhouse";
  if (/(^|\.)lever\.co$/i.test(host) && /\/(apply|application)/i.test(path)) return "lever";
  if (/(^|\.)lever\.co$/i.test(host)) return "lever"; // posting page w/ inline form
  return null;
}

/** The human-visible text describing a control: label > aria > placeholder > name/id. */
export function labelTextFor(el, doc) {
  const parts = [];
  if (el.id) {
    const esc = globalThis.CSS?.escape ? globalThis.CSS.escape(el.id) : el.id;
    const label = doc.querySelector(`label[for="${esc}"]`);
    if (label) parts.push(label.textContent);
  }
  const wrapping = el.closest?.("label");
  if (wrapping) parts.push(wrapping.textContent);
  parts.push(el.getAttribute?.("aria-label"));
  parts.push(el.getAttribute?.("placeholder"));
  parts.push(el.getAttribute?.("name"));
  parts.push(el.id);
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// Ordered rules: FIRST match wins, so specific beats generic ("first name"
// must be checked before the bare "name" rule Lever uses for full name).
const RULES = [
  { key: "first_name", re: /first[\s_-]*name/i },
  { key: "last_name", re: /last[\s_-]*name|surname|family[\s_-]*name/i },
  { key: "full_name", re: /full[\s_-]*name|your[\s_-]*name|^name$/i },
  { key: "email", re: /e-?mail/i },
  { key: "phone", re: /phone|mobile/i },
  { key: "linkedin_url", re: /linked[\s_-]*in/i },
  { key: "github_url", re: /git[\s_-]*hub/i },
  { key: "portfolio_url", re: /portfolio|personal[\s_-]*(web)?site|website/i },
  { key: "location", re: /location|current[\s_-]*city|^city$/i },
  { key: "authorized_to_work", re: /authorized[\s\S]*work|work[\s_-]*authorization|legally[\s\S]*work/i },
  { key: "requires_sponsorship", re: /sponsor/i },
  { key: "willing_to_relocate", re: /relocat/i },
  { key: "desired_salary", re: /salary|compensation[\s_-]*expect/i },
  { key: "notice_period", re: /notice[\s_-]*period|start[\s_-]*date/i },
];

// Controls we must never touch: cover letters, free-text essays, hidden/meta.
const SKIP = /cover[\s_-]*letter|why[\s\S]*(join|work|interested)|additional[\s_-]*info|comments|token|captcha/i;

/** Map one control to a vault key (or null when we honestly don't know). */
export function keyFor(el, doc) {
  const type = (el.getAttribute?.("type") || el.tagName || "").toLowerCase();
  if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return null;

  const text = labelTextFor(el, doc);
  if (!text || SKIP.test(text)) return null;

  if (type === "file") {
    return /resume|cv\b/i.test(text) ? "resume_file" : null;
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.key;
  }
  return null;
}

/**
 * Every mappable control on the page.
 * @returns {Array<{el: Element, key: string}>}
 */
export function collectFields(doc) {
  const out = [];
  const seen = new Set();
  for (const el of doc.querySelectorAll("input, select, textarea")) {
    const key = keyFor(el, doc);
    if (!key) continue;
    // One control per key (forms sometimes duplicate, e.g. mobile/desktop).
    if (key !== "resume_file" && seen.has(key)) continue;
    seen.add(key);
    out.push({ el, key });
  }
  return out;
}
