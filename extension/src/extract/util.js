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

/**
 * Merge partial jobs by field priority (first non-empty wins per field).
 * `is_remote` is OR-ed across all sources. Records which source supplied the
 * title in `_via` for debugging/telemetry.
 * @param {Array<{via:string, data:object}>} candidates ordered high→low priority
 */
export function mergeJob(candidates, url) {
  const out = { title: "", company: "", location: "", is_remote: false, url, description: "", _via: "" };
  for (const field of ["title", "company", "location", "description", "url"]) {
    for (const c of candidates) {
      const v = clean(c.data?.[field]);
      if (v) {
        out[field] = v;
        if (field === "title" && !out._via) out._via = c.via;
        break;
      }
    }
  }
  out.is_remote = candidates.some((c) => c.data?.is_remote === true);
  if (!out.url) out.url = url;
  return out;
}
