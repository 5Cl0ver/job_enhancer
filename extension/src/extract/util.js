// Small pure helpers shared by every extractor. No DOM globals beyond the
// `document` / `element` passed in, so these run identically in the browser
// (content script) and under vitest (happy-dom).

/** Collapse whitespace and trim. */
export function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** Strip HTML tags to plain text (JSON-LD descriptions are HTML). */
export function stripHtml(s) {
  return clean((s || "").replace(/<[^>]*>/g, " "));
}

/** Like clean, but keep paragraph breaks — for multi-line job descriptions. */
export function cleanMultiline(s) {
  return (s || "")
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

/** True if any of the given strings mention remote work. */
export function looksRemote(...parts) {
  return /\b(remote|work from home|wfh|telecommute|anywhere)\b/i.test(parts.filter(Boolean).join(" "));
}

const DESCRIPTION_HEADINGS = [
  /^full job description/i,
  /^job description/i,
  /^about the job/i,
  /^about the role/i,
];

/**
 * Description fallback that works on ANY layout: find the visible
 * "Full job description" (etc.) heading and capture the text that follows it.
 * Sites change their ids/classes constantly, but the heading the USER reads is
 * stable — if you can see the description, this can capture it.
 * Climbs up to two ancestors when the heading is alone in a wrapper div.
 */
export function descriptionByHeading(doc) {
  if (!doc?.querySelectorAll) return "";
  for (const h of doc.querySelectorAll("h1,h2,h3,h4,strong,b")) {
    const label = clean(h.textContent);
    if (!label || label.length > 60) continue;
    if (!DESCRIPTION_HEADINGS.some((re) => re.test(label))) continue;

    let node = h;
    for (let depth = 0; depth < 3 && node; depth++) {
      let text = "";
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        text += " " + stripHtml(sib.innerHTML || "");
      }
      const v = clean(text);
      if (v.length >= 200) return v; // a real description, not a stray label
      node = node.parentElement;
    }
  }
  return "";
}

/**
 * Merge partial jobs by field priority (first non-empty wins per field).
 * `is_remote` is OR-ed across all sources. Records which source supplied the
 * title in `_via` for debugging/telemetry.
 * @param {Array<{via:string, data:object}>} candidates ordered high→low priority
 */
export function mergeJob(candidates, url) {
  const out = {
    title: "", company: "", location: "", is_remote: false, url,
    description: "", job_type: "", salary_min: null, salary_max: null, _via: "",
  };
  for (const field of ["title", "company", "location", "job_type", "url"]) {
    for (const c of candidates) {
      const v = clean(c.data?.[field]);
      if (v) {
        out[field] = v;
        if (field === "title" && !out._via) out._via = c.via;
        break;
      }
    }
  }
  // Description: pick the FULLEST one (a card snippet is short; the page's own
  // description text is the whole thing), preserving paragraph breaks.
  for (const c of candidates) {
    const v = cleanMultiline(c.data?.description || "");
    if (v.length > out.description.length) out.description = v;
  }
  for (const field of ["salary_min", "salary_max"]) {
    for (const c of candidates) {
      const v = c.data?.[field];
      if (v != null) {
        // Sites list salaries with cents ("$80,708.90 a year"); the API stores
        // whole units. Round here so no capture path can ship decimals.
        out[field] = typeof v === "number" ? Math.round(v) : v;
        break;
      }
    }
  }
  out.is_remote = candidates.some((c) => c.data?.is_remote === true);
  if (!out.url) out.url = url;
  return out;
}
