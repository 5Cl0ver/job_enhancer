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
import { clean, stripHtml, looksRemote } from "./util.js";

function normalizeDetail(detail, url) {
  if (!detail?.jobTitle) return null;
  const description = stripHtml(detail.description || "");
  return {
    title: clean(detail.jobTitle),
    company: clean(detail.companyName),
    location: clean(detail.formattedLocation),
    description,
    is_remote: looksRemote(detail.formattedLocation, detail.jobTitle, description),
    url,
  };
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
    is_remote: card.remoteLocation === true || looksRemote(loc, title, card.snippet),
    url,
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
