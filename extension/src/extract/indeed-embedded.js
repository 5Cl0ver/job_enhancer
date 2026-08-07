// Indeed's most reliable data source: the JSON it embeds in the page, not CSS
// classes (which change and differ across Indeed's search / viewjob / home-feed
// layouts). Two shapes, per Indeed's own page data:
//   • job pages   → window._initialData.jobInfoWrapperModel.jobInfoModel
//   • search/feed → mosaic-provider-jobcards …results[] (open job = ?vjk= in URL)
//
// A content script (isolated world) can't read those runtime variables, so a
// MAIN-world bridge (bridge.entry.js) mirrors the fields we need onto
// <html data-je-embedded="…">. We read that first; if it's absent we fall back
// to scanning static <script> text (works on server-rendered pages).
import { clean, stripHtml, looksRemote, parseSalaryText, posSalary } from "./util.js";

// Turn ANY Indeed page url into the canonical /viewjob?jk= listing url, using the
// job key in the url (vjk on the home feed / search pane, jk on a job page).
// Home-feed ?vjk= urls redirect to Indeed's front page, so we always rewrite.
// Returns null if it's not an Indeed url or has no key.
export function canonicalIndeedUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (!/(^|\.)indeed\./i.test(u.hostname)) return null;
    if (u.pathname.includes("/viewjob")) return pageUrl; // already canonical
    const jk = u.searchParams.get("vjk") || u.searchParams.get("jk");
    return jk ? `https://www.indeed.com/viewjob?jk=${jk}` : null;
  } catch {
    return null;
  }
}

// Build the canonical Indeed LISTING url from a job key. Captures from the home
// feed have a page url like indeed.com/?vjk=… (the home page, not the job), so
// saving location.href sends you to the wrong place — we reconstruct the real
// /viewjob url from the key instead.
function indeedListingUrl(jobKey, url) {
  let jk = jobKey;
  if (!jk) {
    try {
      jk = new URL(url).searchParams.get("jk");
    } catch {
      jk = null;
    }
  }
  return jk ? `https://www.indeed.com/viewjob?jk=${jk}` : url;
}

function normalizeDetail(detail, url) {
  if (!detail?.jobTitle) return null;
  const description = stripHtml(detail.description || "");
  return {
    title: clean(detail.jobTitle),
    company: clean(detail.companyName),
    location: clean(detail.formattedLocation),
    description,
    // Structured signals only (location/title) — a description casually saying
    // "remote" must not flag an on-site job as Remote.
    is_remote: looksRemote(detail.formattedLocation, detail.jobTitle),
    url: indeedListingUrl(detail.jobKey, url),
  };
}

// Salary from the card's own data: Indeed's structured extractedSalary
// (min/max/type) first, else parse the visible "$80,299 - $104,389 a year" /
// "$50 - $100 an hour" snippet. Yearly and hourly both carry their period so
// the app can label them honestly.
function cardSalary(card) {
  const es = card?.extractedSalary;
  if (es && (posSalary(es.min) || posSalary(es.max))) {
    const type = (es.type || "yearly").toLowerCase();
    if (type.startsWith("year") || type.startsWith("hour")) {
      return {
        // posSalary drops Indeed's -1 "no max" sentinel.
        salary_min: posSalary(es.min),
        salary_max: posSalary(es.max),
        salary_period: type.startsWith("hour") ? "hourly" : "yearly",
      };
    }
  }
  return (
    parseSalaryText(card?.salarySnippet) || {
      salary_min: null,
      salary_max: null,
      salary_period: null,
    }
  );
}

function normalizeCard(card, url) {
  const title = card?.title || card?.displayTitle;
  if (!title) return null;
  const loc = clean(card.formattedLocation);
  return {
    title: clean(title),
    company: clean(card.company),
    location: loc,
    description: stripHtml(card.snippet || ""),
    // Indeed's own remoteLocation flag, or "Remote in …" in the location/title.
    // NOT the snippet — marketing copy mentioning "remote" isn't a remote job.
    is_remote: card.remoteLocation === true || looksRemote(loc, title),
    url: indeedListingUrl(card.jobkey, url),
    // "Part-time, Contract, Full-time" — straight from the card's own data.
    job_type: Array.isArray(card.jobTypes) ? clean(card.jobTypes.join(", ")).slice(0, 50) : "",
    ...cardSalary(card),
  };
}

// The OPEN job in a list+pane view is identified ONLY by ?vjk= (view-job-key).
// A dedicated /viewjob page has ?jk= (or none) and its _initialData IS that job.
function openCardKey(url) {
  try {
    return new URL(url).searchParams.get("vjk");
  } catch {
    return null;
  }
}

// ---- primary: the MAIN-world bridge attribute ----
function fromBridge(doc, url) {
  const raw = doc.documentElement?.getAttribute?.("data-je-embedded");
  if (!raw) return null;
  let b;
  try {
    b = JSON.parse(raw);
  } catch {
    return null;
  }

  const vjk = openCardKey(url);
  if (vjk) {
    // A card is open in the pane — the job MUST be the one keyed by vjk.
    const card = Array.isArray(b.cards) ? b.cards.find((c) => c.jobkey === vjk) : null;
    if (card) return normalizeCard(card, url);
    // Only trust _initialData if it's actually the same job.
    if (b.detail?.jobKey && b.detail.jobKey === vjk) return normalizeDetail(b.detail, url);
    return null; // don't guess — better to fail than save the wrong job
  }

  // No vjk → a dedicated job page; _initialData is the open job.
  return normalizeDetail(b.detail, url);
}

// ---- fallback: scan static <script> text (balanced-brace, not a fragile regex) ----
function balanced(str, start) {
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (--depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

// Scan every <script> for `marker`, brace-match the following object, and return
// the first one that satisfies `pick` (guards against unrelated `{` matches).
function scanScripts(doc, marker, pick) {
  for (const s of doc.querySelectorAll("script")) {
    const t = s.textContent || "";
    let idx = t.indexOf(marker);
    while (idx !== -1) {
      const start = t.indexOf("{", idx);
      if (start !== -1) {
        const json = balanced(t, start);
        if (json) {
          try {
            const got = pick(JSON.parse(json));
            if (got) return got;
          } catch {
            /* not the blob we want — keep scanning */
          }
        }
      }
      idx = t.indexOf(marker, idx + marker.length);
    }
  }
  return null;
}

function fromStatic(doc, url) {
  const vjk = openCardKey(url);
  if (vjk) {
    // A card is open — match it by vjk in the mosaic feed; never use _initialData.
    const results = scanScripts(doc, 'mosaic-provider-jobcards"]', (d) =>
      d?.metaData?.mosaicProviderJobCardsModel?.results || null,
    );
    const card = Array.isArray(results) ? results.find((c) => c.jobkey === vjk) : null;
    return card ? normalizeCard(card, url) : null;
  }

  const model = scanScripts(doc, "_initialData", (d) =>
    d?.jobInfoWrapperModel?.jobInfoModel ? d.jobInfoWrapperModel.jobInfoModel : null,
  );
  const h = model?.jobInfoHeaderModel;
  if (h?.jobTitle) {
    return normalizeDetail(
      {
        jobTitle: h.jobTitle,
        companyName: h.companyName,
        formattedLocation: h.formattedLocation,
        description: model?.sanitizedJobDescription?.content || "",
      },
      url,
    );
  }
  return null;
}

/** @returns {null | {title,company,location,description,is_remote,url}} */
export function extractIndeedEmbedded(doc, url) {
  return fromBridge(doc, url) || fromStatic(doc, url);
}
