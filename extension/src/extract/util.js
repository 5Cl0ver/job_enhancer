// Small pure helpers shared by every extractor. No DOM globals beyond the
// `document` / `element` passed in, so these run identically in the browser
// (content script) and under vitest (happy-dom).

// Coerce any value to a safe string before string ops. Sites' embedded JSON
// (esp. Indeed's) sometimes hands a field a number or an object where we expect
// text — calling .replace on that throws and crashes the whole content script.
// Primitives coerce; null/undefined/objects/arrays become "" (a malformed text
// field is skipped, letting a cleaner source win in mergeJob).
function asText(s) {
  if (typeof s === "string") return s;
  if (typeof s === "number" || typeof s === "boolean") return String(s);
  return "";
}

// Pages and job data hand titles over HTML-escaped ("Microsoft 365 &amp;
// Copilot"): decoded, twice at most for "&amp;amp;" (spec 023).
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s) {
  let out = s;
  for (let i = 0; i < 2 && /&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/i.test(out); i++) {
    out = out.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  return out;
}

/** Collapse whitespace and trim (HTML entities decoded). */
export function clean(s) {
  return decodeEntities(asText(s)).replace(/\s+/g, " ").trim();
}

/**
 * HTML → readable plain text (JSON-LD / embedded descriptions are HTML).
 * CRITICAL: drops <style>/<script> WITH their contents first — Indeed embeds a
 * <style> block inside its description HTML, and naive tag-stripping leaks the
 * CSS text into the saved description ("@layer htmlContent { … }" bug).
 * Block-level closers become newlines so paragraphs survive.
 */
export function stripHtml(s) {
  const text = asText(s)
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
  return cleanMultiline(text);
}

/**
 * Parse a visible salary string like "$80,299 - $104,389 a year" or
 * "$50 - $100 an hour" into numbers + period. Yearly and hourly are kept
 * (with the period label so the UI can display them honestly); monthly/
 * weekly/daily are skipped rather than stored ambiguously.
 * @returns {{salary_min:number|null, salary_max:number|null, salary_period:string} | null}
 */
export function parseSalaryText(text) {
  const t = clean(text);
  if (!t) return null;
  let period = null;
  if (/\b(a|an|per)\s+year\b|\byearly\b|\bannual|\/\s*(year|yr)\b/i.test(t)) period = "yearly";
  else if (/\b(a|an|per)\s+hour\b|\bhourly\b|\/\s*(hour|hr)\b/i.test(t)) period = "hourly";
  if (!period) return null;
  const nums = [...t.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)]
    .map((m) => Math.round(parseFloat(m[1].replace(/,/g, ""))))
    // Sanity floor per period: yearly figures are thousands, hourly single digits+.
    .filter((n) => Number.isFinite(n) && n >= (period === "yearly" ? 1000 : 2));
  if (!nums.length) return null;
  return { salary_min: nums[0], salary_max: nums[1] ?? null, salary_period: period };
}

/** Like clean, but keep paragraph breaks — for multi-line job descriptions. */
export function cleanMultiline(s) {
  return asText(s)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First element matching any selector whose text/title is non-empty. */
export function textFrom(root, selectors) {
  if (!root) return "";
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const t = el.getAttribute?.("content") || el.getAttribute?.("title") || el.textContent;
    const v = clean(t);
    if (v) return v;
  }
  return "";
}

/** First href among selectors, else the fallback url. */
export function hrefFrom(root, selectors, fallback) {
  if (root) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const h = el?.getAttribute?.("href") || el?.href;
      if (h) return absolutize(h, fallback);
    }
  }
  return fallback;
}

/** Resolve a possibly-relative href against the page url. */
export function absolutize(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return href || base;
  }
}

/**
 * A salary value the API can store, or null. Rounds cents and — crucially —
 * DROPS non-positive sentinels: Indeed uses -1 for "no max", which otherwise
 * saved and displayed as "$80,000 – -$1".
 */
export function posSalary(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n > 0 ? n : null;
}

/** True if any of the given strings mention remote work. */
export function looksRemote(...parts) {
  return /\b(remote|work from home|wfh|telecommute|anywhere)\b/i.test(parts.filter(Boolean).join(" "));
}

/**
 * Text that FOLLOWS a visible heading matching one of `patterns`. Sites change
 * their ids/classes constantly, but the headings the USER reads are stable —
 * if you can see the section, this can capture it. Climbs up to two ancestors
 * when the heading is alone in a wrapper div.
 */
export function textAfterHeading(doc, patterns, minLen) {
  if (!doc?.querySelectorAll) return "";
  for (const h of doc.querySelectorAll("h1,h2,h3,h4,strong,b")) {
    const label = clean(h.textContent);
    if (!label || label.length > 60) continue;
    if (!patterns.some((re) => re.test(label))) continue;

    let node = h;
    for (let depth = 0; depth < 3 && node; depth++) {
      let text = "";
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        text += "\n" + stripHtml(sib.innerHTML || "");
      }
      const v = cleanMultiline(text);
      if (v.length >= minLen) return v;
      node = node.parentElement;
    }
  }
  return "";
}

const DESCRIPTION_HEADINGS = [
  /^full job description/i,
  /^job description/i,
  /^about the job/i,
  /^about the role/i,
];

/** The full description anchored on its heading (min 200 chars = a real one). */
export function descriptionByHeading(doc) {
  return textAfterHeading(doc, DESCRIPTION_HEADINGS, 200);
}

const JOB_TYPE_WORDS = [
  "Full-time",
  "Part-time",
  "Contract",
  "Permanent",
  "Temporary",
  "Internship",
  "Apprenticeship",
  "Seasonal",
  "Freelance",
];

/** Known job-type words present in a text block ("Permanent, Full-time"). */
export function parseJobTypes(text) {
  const t = clean(text);
  if (!t) return "";
  const found = JOB_TYPE_WORDS.filter((w) =>
    new RegExp(`\\b${w.replace("-", "[-\\s]?")}\\b`, "i").test(t),
  );
  return found.join(", ").slice(0, 50);
}

// The job boards' own names: not a company when a page's own text says so (a
// page with no employer name otherwise saves "ZipRecruiter" as the company).
// Structured posting data (JSON-LD, Indeed's own data) is trusted: LinkedIn
// and Indeed hire people too.
const BOARD_NAME = /^(indeed(\.com)?|linkedin|ziprecruiter|glassdoor|dice|monster|simplyhired|built ?in|careerbuilder)$/i;
const TRUSTED = new Set(["jsonld", "indeed-embedded"]);
const BOARD_TAIL = /\s*[-–—|·]\s*(indeed(\.com)?|linkedin|ziprecruiter|glassdoor|dice(\.com)?|monster|simplyhired|built ?in|careerbuilder)\s*$/i;
// "Systems Engineer - Clackamas, OR 97015" / "… - Remote": the tab title's place.
const PLACE_TAIL = /\s+[-–—|]\s+([Rr]emote|[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3},\s*[A-Z]{2}(?:\s+\d{5})?)\s*$/;
// The expand/collapse buttons' own words that land at the end of a description.
const BUTTON_LINE = /^(?:…|\.\.\.)?\s*(?:(?:see|show|read|view)\s+(?:more|less)(?:\s+details)?|(?:…|\.\.\.)\s*more|more|less|show all)\s*$/i;
const BUTTON_TAIL = /\s*(?:…|\.\.\.)\s*(?:see |show |read )?more\s*$/i;

/** A board's name, or nothing that could be a company. */
export function isBoardName(s) {
  return BOARD_NAME.test(clean(s));
}

/**
 * A job title without the site's name or the tab's place: "Systems Engineer -
 * Clackamas, OR 97015 - Indeed.com" → "Systems Engineer". The place is only
 * cut when a board's name was there too (a real title may name a town).
 */
export function cleanTitle(s) {
  let t = clean(s);
  if (!BOARD_TAIL.test(t)) return t;
  t = t.replace(BOARD_TAIL, "");
  for (let i = 0; i < 2 && PLACE_TAIL.test(t); i++) t = t.replace(PLACE_TAIL, "");
  return t.trim();
}

/** A description without the "… more" / "Show less" button text at its end. */
export function cleanDescription(s) {
  const lines = cleanMultiline(s).split("\n");
  while (lines.length && BUTTON_LINE.test(lines[lines.length - 1].trim())) lines.pop();
  if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(BUTTON_TAIL, "");
  return cleanMultiline(lines.join("\n"));
}

/** "careers-nscglobal" (a hiring site's address) → "nscglobal". */
function siteless(company) {
  return clean(company).replace(/^(careers?|jobs?)-(?=\w)/i, "").replace(/-careers?$/i, "");
}

/** The same tidy-up on a whole job, for readers outside mergeJob (the panel). */
export function tidyJob(job) {
  if (!job) return job;
  const out = { ...job };
  out.title = cleanTitle(out.title);
  if (isBoardName(out.company)) out.company = "";
  out.company = siteless(out.company);
  out.description = cleanDescription(out.description);
  return out;
}

/**
 * Merge partial jobs by field priority (first non-empty wins per field).
 * `is_remote` is OR-ed across all sources. Records which source supplied the
 * title in `_via` for debugging/telemetry. A board's name is never the
 * company, and a title that is just the company's name yields to a real one.
 * @param {Array<{via:string, data:object}>} candidates ordered high→low priority
 */
export function mergeJob(candidates, url) {
  const out = {
    title: "", company: "", location: "", is_remote: false, url,
    description: "", job_type: "", salary_min: null, salary_max: null,
    salary_period: null, _via: "",
  };
  let companyTitle = null;
  for (const field of ["company", "title", "location", "job_type", "url"]) {
    for (const c of candidates) {
      let v = clean(c.data?.[field]);
      if (field === "company") v = TRUSTED.has(c.via) ? v : isBoardName(v) ? "" : siteless(v);
      if (field === "title") {
        v = cleanTitle(v);
        if (v && out.company && v.toLowerCase() === out.company.toLowerCase()) {
          companyTitle ??= c;
          v = "";
        }
      }
      if (v) {
        out[field] = v;
        if (field === "title" && !out._via) out._via = c.via;
        break;
      }
    }
  }
  // Only the company's name was offered as a title: keep it rather than nothing
  // (the user can fix it), but any real title above wins.
  if (!out.title && companyTitle) {
    out.title = out.company;
    out._via = companyTitle.via;
  }
  // Description: pick the FULLEST one (a card snippet is short; the page's own
  // description text is the whole thing), preserving paragraph breaks.
  for (const c of candidates) {
    const v = cleanDescription(c.data?.description || "");
    if (v.length > out.description.length) out.description = v;
  }
  for (const field of ["salary_min", "salary_max"]) {
    for (const c of candidates) {
      const v = posSalary(c.data?.[field]);
      if (v != null) {
        out[field] = v;
        break;
      }
    }
  }
  for (const c of candidates) {
    if (c.data?.salary_period) {
      out.salary_period = c.data.salary_period;
      break;
    }
  }
  out.is_remote = candidates.some((c) => c.data?.is_remote === true);
  if (!out.url) out.url = url;
  return out;
}
