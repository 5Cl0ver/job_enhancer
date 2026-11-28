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

/** The Job Catcher in this very browser: its version and browser name, as
 * it reports them to the app ("Chrome 142 (Windows)"). */
export interface HereJobCatcher {
  version: string;
  browser: string;
}

/**
 * Ask the Job Catcher in this very browser which version it is (spec 040).
 * Null when there's none here, or it's too old to say (before 0.50.0).
 */
export function askHere(timeoutMs = 1500): Promise<HereJobCatcher | null> {
  const rt = runtime();
  if (!rt) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      rt.sendMessage(JOB_CATCHER_ID, { type: "version" }, (reply) => {
        clearTimeout(timer);
        if (rt.lastError) return resolve(null);
        const r = (reply ?? {}) as { version?: unknown; browser?: unknown };
        const ok = typeof r.version === "string" && /^\d+(\.\d+){1,3}$/.test(r.version);
        resolve(ok ? { version: r.version as string, browser: typeof r.browser === "string" ? r.browser.slice(0, 64) : "" } : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Seen recently: an old copy someone removed long ago doesn't count. */
export const RECENT_MS = 30 * 24 * 3600 * 1000;

/** "Chrome 131 (Windows)" → "Chrome (Windows)": the browser and system, without the version. */
export function browserLabel(browser?: string | null): string {
  return (browser || "")
    .replace(/\s+[\d.]+(?=\s*\(|\s*$)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface OutdatedJobCatcher {
  version: string;
  latest: string;
  /** Where it is ("Chrome (Windows)"), when the user has Job Catcher on more than one computer or browser. */
  where: string;
}

/** "Chrome 131 (Windows)" → "Windows"; "" when it doesn't say. */
const platformOf = (browser?: string | null) => /\(([^)]*)\)\s*$/.exec(browser || "")?.[1].trim() ?? "";
/** "Chrome 131 (Windows)" → "Chrome". */
const brandOf = (browser?: string | null) => browserLabel(browser).replace(/\s*\([^)]*\)\s*$/, "");

type Install = { install_id?: string; version: string; browser: string | null; last_seen_at: string };

/**
 * The Job Catcher that's behind (spec 034): one install (one browser on one
 * computer) seen in the last 30 days on this account, older than the newest
 * release. Each install is its own: an up-to-date copy on another computer
 * never hides an old one — but a current copy on the SAME browser and system
 * seen after it does (Job Catcher was removed and added again: a new install).
 * An old copy that didn't name its system (before 0.38) is replaced by a
 * current copy of the same browser seen after it (spec 040). `here` is the
 * Job Catcher in this very browser, when it said its version: it counts as
 * seen now. The newest-seen behind one is named. Null when every recent one
 * is current, or nothing is known.
 */
export function outdatedJobCatcher(
  installs: Install[] | undefined,
  latest: string | null | undefined,
  now = Date.now(),
  here?: HereJobCatcher | null,
): OutdatedJobCatcher | null {
  if (!latest) return null;
  const all: Install[] = [
    ...(installs ?? []),
    ...(here
      ? [{ version: here.version, browser: here.browser || null, last_seen_at: new Date(now).toISOString() }]
      : []),
  ];
  if (!all.length) return null;
  const seen = (i: { last_seen_at: string }) => new Date(i.last_seen_at).getTime();
  const recent = all.filter((i) => now - seen(i) < RECENT_MS);
  const sameComputer = (a: Install, b: Install) => {
    const pa = platformOf(a.browser);
    const pb = platformOf(b.browser);
    if (pa && pb) return pa === pb && !!browserLabel(a.browser) && browserLabel(a.browser) === browserLabel(b.browser);
    return !!brandOf(a.browser) && brandOf(a.browser) === brandOf(b.browser);
  };
  const replaced = (i: Install) =>
    recent.some((o) => o !== i && !isOlder(o.version, latest) && sameComputer(o, i) && seen(o) >= seen(i));
  const one = recent
    .filter((i) => isOlder(i.version, latest) && !replaced(i))
    .sort((a, b) => seen(b) - seen(a))[0];
  if (!one) return null;
  // Named only when the user has more than one computer or browser: each
  // computer counted once, by its newest copy.
  const computers = recent.filter((i) => !recent.some((o) => o !== i && sameComputer(o, i) && seen(o) > seen(i)));
  return { version: one.version, latest, where: computers.length > 1 ? browserLabel(one.browser) : "" };
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
