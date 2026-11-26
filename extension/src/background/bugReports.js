// Bugs & ideas (spec 032) from Job Catcher:
//
// - The owner's "Report a problem here" (`ownerReport`): what happened, the
//   page it happened on (its site and path, never the query or fragment, where
//   searches, tokens and names live) and Job Catcher's version.
// - Job Catcher's own failures (`createCaughtReporter`): a save that failed
//   (not "already saved" or "signed out"), a résumé that didn't attach, a fill
//   that got no answer. Only the kind, the page's site and path, a short
//   message Job Catcher wrote itself (never what's in the page's boxes, never
//   the user's details) and the version. At most one per kind and page every
//   10 minutes; sending never throws and is never retried.
//
// Pure, apart from what's passed in, so it's unit-tested (test/bug-reports.spec.js).

export const TITLE_MAX = 140;
export const ACTUAL_MAX = 2000;
export const MESSAGE_MAX = 300;
export const CAUGHT_EVERY_MS = 10 * 60_000;
export const CAUGHT_KINDS = ["save_failed", "resume_failed", "fill_failed"];
const SENT_KEY = "je_caught_sent";

/** A page as its site and path: no query, no fragment, no "www.". "" for non-web pages. */
export function placeOf(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return `${u.hostname.replace(/^www\./, "")}${u.pathname}`.slice(0, 300);
  } catch {
    return "";
  }
}

/** Any web address in a text as its site and path only. */
function withoutQueries(text) {
  return String(text || "").replace(/\bhttps?:\/\/[^\s'"<>()]+/gi, (m) => placeOf(m) || "[link]");
}

/** One short line of Job Catcher's own words. */
export function shortMessage(text) {
  return withoutQueries(text).replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX);
}

/**
 * The owner's report from the panel, for POST /v1/admin/bugs.
 * @param {{what: string, url: string, version: string, browser?: string}} r
 */
export function ownerReport({ what, url, version, browser = "" }) {
  const text = withoutQueries(what).trim().slice(0, ACTUAL_MAX);
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
  return {
    type: "bug",
    section: "job_catcher",
    title: first.slice(0, TITLE_MAX),
    actual: text,
    place: placeOf(url),
    context: {
      job_catcher: String(version || "").slice(0, 80),
      ...(browser ? { browser: String(browser).slice(0, 80) } : {}),
      device: "computer",
    },
    source: "owner",
  };
}

/** A save that failed for a reason worth the owner's look (not "already saved", not signed out). */
export function isSaveFailure(message) {
  const m = String(message || "");
  return !!m && !/already in your tracker|already saved|NOT_SIGNED_IN|not signed in|sign in/i.test(m);
}

/** The body for POST /v1/bugs/caught. */
export function caughtBody({ kind, url, message, version }) {
  return {
    section: "job_catcher",
    kind,
    place: placeOf(url),
    message: shortMessage(message),
    context: { job_catcher: String(version || "").slice(0, 80) },
  };
}

/**
 * @param {{
 *   send: (body: object) => Promise<unknown>,
 *   version: string,
 *   now?: () => number,
 *   storage?: { get: (k: string) => Promise<Record<string, any>>, set: (o: Record<string, any>) => Promise<void> } | null,
 * }} deps
 *   send: posts one body (with the user's token); may throw or fail, never retried.
 *   storage: chrome.storage.session, so a worker that slept still remembers.
 */
export function createCaughtReporter({ send, version, now = () => Date.now(), storage = null }) {
  const sent = new Map(); // kind|place -> when last sent

  async function remembered() {
    if (!storage) return {};
    try {
      return (await storage.get(SENT_KEY))?.[SENT_KEY] || {};
    } catch {
      return {};
    }
  }

  /**
   * Report one failure. True when it was sent now; false when it was held
   * back (sent in the last 10 minutes, unknown kind, no page). Never throws.
   */
  async function report(kind, url, message) {
    try {
      if (!CAUGHT_KINDS.includes(kind)) return false;
      const body = caughtBody({ kind, url, message, version });
      if (!body.place) return false;
      const key = `${kind}|${body.place}`;
      const t = now();
      const held = { ...(await remembered()) };
      const last = Math.max(sent.get(key) || 0, held[key] || 0);
      if (last && t - last < CAUGHT_EVERY_MS) return false;
      // Noted before sending: two at once send one, and a failed send waits
      // its 10 minutes like a sent one (never a loop).
      sent.set(key, t);
      for (const [k, at] of Object.entries(held)) if (t - at >= CAUGHT_EVERY_MS) delete held[k];
      held[key] = t;
      try {
        await storage?.set({ [SENT_KEY]: held });
      } catch {
        /* kept in memory still */
      }
      await send(body);
      return true;
    } catch {
      return false;
    }
  }

  return { report };
}
