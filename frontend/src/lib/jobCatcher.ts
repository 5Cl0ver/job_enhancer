/**
 * Job Catcher, from the app's side (spec 019): where to download it, and how
 * the /connect page asks the Job Catcher in this same Chrome for its proof.
 *
 * Job Catcher's id is pinned by the "key" in its manifest, so it's the same on
 * every computer. The page can only reach it because Job Catcher lists this
 * app's address as allowed to (`externally_connectable`), and it only answers
 * with the proof for a Connect it started itself with exactly this code.
 */

export const JOB_CATCHER_ID: string =
  import.meta.env.VITE_JOB_CATCHER_ID || "jihebibpgbfpmponcpphjbgnppodffed";

export const DOWNLOAD_URL =
  "https://github.com/5Cl0ver/job_enhancer/releases/latest/download/job-catcher.zip";

type ChromeRuntime = {
  sendMessage: (
    id: string,
    message: unknown,
    callback: (reply: unknown) => void,
  ) => void;
  lastError?: { message?: string };
};

function runtime(): ChromeRuntime | null {
  const chrome = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome;
  return chrome?.runtime?.sendMessage ? chrome.runtime : null;
}

/**
 * The proof from the Job Catcher in this browser for the Connect showing
 * `code`, or null when there's no such Job Catcher here (another browser, not
 * installed, or a link someone else sent).
 */
export function askProof(code: string, timeoutMs = 3000): Promise<string | null> {
  const rt = runtime();
  if (!rt) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      rt.sendMessage(JOB_CATCHER_ID, { type: "connectProof", code }, (reply) => {
        clearTimeout(timer);
        if (rt.lastError) return resolve(null);
        const proof = (reply as { proof?: unknown } | undefined)?.proof;
        resolve(typeof proof === "string" && proof.length >= 20 ? proof : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Seen recently: an old copy someone removed long ago doesn't count. */
export const RECENT_MS = 30 * 24 * 3600 * 1000;

/** "Chrome 131" → "Chrome": the browser, without its version. */
export function browserLabel(browser?: string | null): string {
  return (browser || "").replace(/\s+[\d.]+$/, "").trim();
}

export interface OutdatedJobCatcher {
  version: string;
  latest: string;
  /** Where it is ("Chrome"), when the user has Job Catcher on more than one browser. */
  where: string;
}

/**
 * The Job Catcher that's behind (spec 034): one seen in the last 30 days on
 * this account, older than the newest release — unless that browser has
 * since said hello with an up-to-date one (it was updated or re-added).
 * Null when every recent one is current, or nothing is known.
 */
export function outdatedJobCatcher(
  installs: { version: string; browser: string | null; last_seen_at: string }[] | undefined,
  latest: string | null | undefined,
  now = Date.now(),
): OutdatedJobCatcher | null {
  if (!latest || !installs?.length) return null;
  const seen = (i: { last_seen_at: string }) => new Date(i.last_seen_at).getTime();
  const recent = installs.filter((i) => now - seen(i) < RECENT_MS);
  const behind = recent
    .filter((i) => isOlder(i.version, latest))
    .filter(
      (i) =>
        !recent.some(
          (o) => o !== i && !isOlder(o.version, latest) && browserLabel(o.browser) === browserLabel(i.browser) && seen(o) >= seen(i),
        ),
    )
    .sort((a, b) => seen(b) - seen(a));
  const one = behind[0];
  if (!one) return null;
  const browsers = new Set(recent.map((i) => browserLabel(i.browser) || "?"));
  return { version: one.version, latest, where: browsers.size > 1 || recent.length > 1 ? browserLabel(one.browser) : "" };
}

/** "0.34.1" is older than "0.35.0". */
export function isOlder(have?: string | null, latest?: string | null): boolean {
  const parse = (v?: string | null) =>
    v && /^\d+(\.\d+){1,3}$/.test(v) ? v.split(".").map(Number) : null;
  const a = parse(have);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0;
  }
  return false;
}
