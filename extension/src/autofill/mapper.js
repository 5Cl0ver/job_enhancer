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

// The HTML `autocomplete` attribute is the standardized, most reliable signal —
// Amazon/Workday/most modern forms set it, so this works site-agnostically.
const AUTOCOMPLETE_MAP = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "street-address": "address_line1",
  "address-line1": "address_line1",
  "address-line2": "address_line2",
  "address-level2": "city", // city/locality
  "address-level1": "state", // state/province
  "postal-code": "postal_code",
  country: "country",
  "country-name": "country",
  url: "portfolio_url",
};

// Ordered label rules: FIRST match wins, so specific beats generic ("first name"
// before the bare "name"; "address line 2" before "address line 1";
// "Country/Region" before "state" so the /region/ alias doesn't steal it).
const RULES = [
  { key: "first_name", re: /first[\s_-]*name|given[\s_-]*name/i },
  { key: "last_name", re: /last[\s_-]*name|surname|family[\s_-]*name/i },
  { key: "full_name", re: /full[\s_-]*name|your[\s_-]*name|^name$/i },
  { key: "email", re: /e-?mail/i },
  { key: "phone", re: /phone|mobile|telephone/i },
  { key: "linkedin_url", re: /linked[\s_-]*in/i },
  { key: "github_url", re: /git[\s_-]*hub/i },
  { key: "portfolio_url", re: /portfolio|personal[\s_-]*(web)?site|website/i },
  // A single combined "location" field (Greenhouse/Lever) — checked before the
  // granular address rules so it wins over the discrete city/state of forms
  // like Amazon (whose "City" field has no "location" in its text).
  { key: "location", re: /location/i },
  { key: "address_line2", re: /address[\s_-]*line[\s_-]*2|apartment|apt\b|unit\b|suite/i },
  { key: "address_line1", re: /address[\s_-]*line[\s_-]*1|street[\s_-]*address|^street|^address\b/i },
  { key: "city", re: /\bcity\b|town/i },
  { key: "postal_code", re: /postal|zip/i },
  { key: "country", re: /country/i },
  { key: "state", re: /\bstate\b|province|region/i },
  { key: "authorized_to_work", re: /authorized[\s\S]*(work|employ)|work[\s_-]*authorization|legally[\s\S]*(work|employ)|eligib[\s\S]*(work|employ|begin)/i },
  { key: "requires_sponsorship", re: /sponsor/i },
  { key: "willing_to_relocate", re: /relocat/i },
  { key: "desired_salary", re: /salary|compensation[\s_-]*expect/i },
  { key: "notice_period", re: /notice[\s_-]*period|start[\s_-]*date/i },
  { key: "today_date", re: /today['’]?s?[\s_-]*date|current[\s_-]*date|date[\s_-]*signed|signature[\s_-]*date|date[\s_-]*today/i },
];

// Controls we must never touch: cover letters, free-text essays, hidden/meta.
const SKIP = /cover[\s_-]*letter|why[\s\S]*(join|work|interested)|additional[\s_-]*info|comments|token|captcha/i;

// Page widgets that are NOT application questions — never fill OR learn these
// (e.g. Amazon's "Choose your AI preference" personalization/consent banner).
const NOISE = /preference|personaliz|cookie|consent|newsletter|subscrib|marketing|notification/i;

// Protected self-identification (EEO / voluntary disclosure). We NEVER auto-fill,
// learn, or let the AI guess these — ethnicity, race, gender, veteran, and
// disability status are the user's to answer, always. Matching by the visible
// question text, so it works on any ATS (Workday, Greenhouse, …).
export const SELF_ID =
  /ethnic|\brace\b|racial|gender|hispanic|latin[ox]|veteran|disab(?:led|ilit)|sexual orientation|lgbtq?|\bpronoun/i;

/** Map one control to a vault key (or null when we honestly don't know). */
export function keyFor(el, doc) {
  const type = (el.getAttribute?.("type") || el.tagName || "").toLowerCase();
  if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return null;

  // 1) autocomplete attribute — standardized and site-agnostic; trust it first.
  const ac = (el.getAttribute?.("autocomplete") || "").toLowerCase().trim();
  if (ac && ac !== "off" && ac !== "on") {
    for (const token of ac.split(/\s+/)) {
      if (AUTOCOMPLETE_MAP[token]) return AUTOCOMPLETE_MAP[token];
    }
  }

  const text = labelTextFor(el, doc);
  if (type === "file") {
    // A résumé upload isn't always labelled "resume" — Indeed's file input has
    // NO label; its identity is in `accept` (pdf/word/rtf) and data-testid. Any
    // document-accepting file input on an application IS the résumé upload.
    const accept = (el.getAttribute?.("accept") || "").toLowerCase();
    const testid = (el.getAttribute?.("data-testid") || el.id || el.name || "").toLowerCase();
    const docLike = /pdf|msword|officedocument|rtf|\.doc/.test(accept);
    if (/resume|cv\b/i.test(text) || /resume|cv/.test(testid) || docLike) return "resume_file";
    return null;
  }
  // 2) label / placeholder / name regex.
  return keyForText(text);
}

/** The profile key for a piece of TEXT (a label or a radio-group question). */
export function keyForText(text) {
  if (!text || SKIP.test(text)) return null;
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.key;
  }
  return null;
}

// Profile keys that are yes/no — the ones a radio group can answer.
const BOOL_KEYS = new Set([
  "authorized_to_work",
  "requires_sponsorship",
  "willing_to_relocate",
]);

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

// --- Learn-as-you-go: questions the profile can't map -----------------------

const UNFILLABLE = new Set([
  "hidden", "submit", "button", "checkbox", "radio", "file", "password", "search",
]);

/** The human-visible question ONLY (label/aria/placeholder) — deliberately
 *  excludes name/id, which differ across sites and would break reuse. */
export function visibleLabelFor(el, doc) {
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
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Normalize a question into a stable match key (case/punctuation-insensitive). */
export function normalizeQuestion(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\(required\)|\(optional\)|required|optional/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

/**
 * Every fillable control we did NOT map to a profile key — the custom/
 * job-specific questions we can learn answers for.
 * @returns {Array<{el: Element, questionText: string, questionKey: string}>}
 */
export function collectUnmapped(doc) {
  const out = [];
  const seen = new Set();
  for (const el of doc.querySelectorAll("input, textarea, select")) {
    const type = (el.getAttribute?.("type") || el.tagName || "").toLowerCase();
    if (UNFILLABLE.has(type)) continue;
    if (keyFor(el, doc)) continue; // handled by the profile mapper
    const questionText = visibleLabelFor(el, doc);
    if (!questionText || NOISE.test(questionText)) continue; // skip consent/marketing widgets
    if (SELF_ID.test(questionText)) continue; // never learn/fill protected self-ID
    const questionKey = normalizeQuestion(questionText);
    if (questionKey.length < 3) continue;
    if (seen.has(questionKey)) continue;
    seen.add(questionKey);
    out.push({ el, questionText, questionKey });
  }
  return out;
}

/** The question text for a radio group (fieldset legend, else the smallest
 *  container around the options minus the option labels). */
function groupQuestion(els, options, doc) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 500);

  // 1) A <fieldset><legend> — the cleanest source.
  const legend = els[0].closest?.("fieldset")?.querySelector?.("legend");
  if (legend?.textContent?.trim()) return clean(legend.textContent);

  // 2) An explicit aria label on the radiogroup.
  const grp = els[0].closest?.('[role="radiogroup"]');
  if (grp?.getAttribute?.("aria-label")?.trim()) return clean(grp.getAttribute("aria-label"));
  const lb = grp?.getAttribute?.("aria-labelledby");
  if (lb) {
    const t = lb
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
    if (t) return clean(t);
  }

  // 3) Walk UP from the smallest container of the radios until an ancestor's
  //    text (minus the option labels) actually holds the question. Amazon puts
  //    "Are you a veteran?" in a <label> OUTSIDE the radios' immediate box, so
  //    stopping at that box gave an empty question and the group was dropped.
  let a = els[0];
  while (a && !els.every((e) => a.contains?.(e))) a = a.parentElement;
  for (let hops = 0; a && hops < 5; hops++, a = a.parentElement) {
    let text = clean(a.textContent);
    for (const o of options) if (o.label) text = text.split(o.label).join(" ");
    text = clean(text);
    if (text.length >= 6) return text;
  }
  return "";
}

/**
 * Radio groups (yes/no questions) mapped to a profile bool key, or left as a
 * custom question we can learn. Checkboxes are intentionally excluded (never
 * auto-agree to legal terms).
 * @returns {Array<{question, questionKey, key: string|null, options: Array<{el, label}>}>}
 */
export function collectRadioGroups(doc) {
  const byName = new Map();
  for (const el of doc.querySelectorAll('input[type="radio"]')) {
    const name = el.getAttribute("name");
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(el);
  }
  const out = [];
  for (const els of byName.values()) {
    if (els.length < 2) continue; // a real choice needs >=2 options
    const options = els.map((el) => ({ el, label: visibleLabelFor(el, doc) || el.value || "" }));
    const question = groupQuestion(els, options, doc);
    if (NOISE.test(question)) continue; // skip consent/marketing widgets (not app questions)
    if (SELF_ID.test(question)) continue; // never auto-answer protected self-ID
    const questionKey = normalizeQuestion(question);
    if (questionKey.length < 3) continue;
    const k = keyForText(question);
    out.push({ question, questionKey, key: BOOL_KEYS.has(k) ? k : null, options });
  }
  return out;
}

/** Find a learned answer for a question: exact key, else fuzzy token overlap. */
export function matchAnswer(questionKey, answers) {
  if (!answers?.length) return null;
  const exact = answers.find((a) => a.question_key === questionKey);
  if (exact) return exact;
  const qTokens = new Set(questionKey.split(" ").filter((t) => t.length > 2));
  if (qTokens.size < 2) return null;
  let best = null;
  let bestScore = 0;
  for (const a of answers) {
    const aTokens = new Set((a.question_key || "").split(" ").filter((t) => t.length > 2));
    if (!aTokens.size) continue;
    let shared = 0;
    for (const t of qTokens) if (aTokens.has(t)) shared++;
    const score = shared / new Set([...qTokens, ...aTokens]).size; // Jaccard
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return bestScore >= 0.6 ? best : null;
}
