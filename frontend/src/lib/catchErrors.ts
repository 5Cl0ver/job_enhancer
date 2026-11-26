/**
 * The app catches its own crashes (spec 032, research R6). A page that breaks
 * (the router's crash screen) and any error nothing else caught
 * (`window.onerror`, a promise nobody handled) go to `POST /v1/bugs/caught`,
 * so the owner sees them in Bugs & ideas without anyone writing them up.
 *
 * - Only when signed in, and never who: where (the page, no query), the
 *   error's words (the server scrubs them too), device, browser, theme and
 *   the app's version.
 * - Never a loop: nothing is reported while a report is being sent, and
 *   sending never throws.
 * - Never a flood: the same words at most once a minute.
 * - Not noise: the ResizeObserver warning, cancelled requests, network blips,
 *   being signed out (401), server errors (the server keeps those itself) and
 *   errors from other browser extensions' scripts.
 */
import { APP_VERSION } from "@/lib/appVersion";
import { API_BASE, getAccessToken } from "@/lib/api";
import { browserName } from "@/lib/bugs";

export type CaughtKind = "crash" | "other";

const ONCE_A_MINUTE = 60_000;
const MESSAGE_MAX = 300;
const NOISE = [
  /ResizeObserver loop/i,
  /\bAbortError\b/,
  /\b(aborted|the user aborted|signal is aborted)\b/i,
  /^Script error\.?$/i,
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i,
  /\b401\b|Not authenticated|Unauthorized/i,
  /(chrome|moz|safari(-web)?)-extension:\/\//i,
];

let installed = false;
let sending = false;
const lastSent = new Map<string, number>();

/** For tests: forget what was sent and whether listeners are on. */
export function resetCaught(): void {
  installed = false;
  sending = false;
  lastSent.clear();
}

/** An error as one line of words: "TypeError: x is undefined". */
export function errorWords(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return `${name}${error.message}`.trim() || error.name || "Error";
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** True for errors that aren't the app's bugs. */
export function isNoise(error: unknown, words: string, source = ""): boolean {
  const e = error as { name?: string; status?: number; stack?: string } | null;
  if (e?.name === "AbortError") return true;
  if (e?.status === 401) return true;
  // The server keeps its own errors (it caught them first).
  if (e?.name === "ApiError" && (e.status ?? 0) >= 500) return true;
  const where = `${source} ${e?.stack ?? ""}`;
  if (/(chrome|moz|safari(-web)?)-extension:\/\//i.test(where)) return true;
  return NOISE.some((re) => re.test(words));
}

function context() {
  const phone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px)").matches;
  return {
    device: phone ? "phone" : "computer",
    browser: browserName(navigator.userAgent),
    theme: document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
    app_version: APP_VERSION,
  };
}

/**
 * Send one caught error, if it's worth it. Never throws and never waits on
 * the user: a failure to send is dropped.
 */
export async function reportCaught(
  error: unknown,
  { kind = "other", source = "" }: { kind?: CaughtKind; source?: string } = {},
): Promise<boolean> {
  if (sending) return false;
  const words = errorWords(error).replace(/\s+/g, " ").trim();
  if (!words || isNoise(error, words, source)) return false;
  const now = Date.now();
  const last = lastSent.get(words);
  if (last !== undefined && now - last < ONCE_A_MINUTE) return false;
  sending = true;
  try {
    const token = await getAccessToken().catch(() => null);
    if (!token) return false;
    lastSent.set(words, now);
    const res = await fetch(`${API_BASE}/v1/bugs/caught`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        section: "app",
        kind,
        place: window.location.pathname,
        message: words.slice(0, MESSAGE_MAX),
        context: context(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    sending = false;
  }
}

/** Listen for errors nothing else caught. Once, however often it's called. */
export function installErrorCatcher(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev: ErrorEvent) => {
    void reportCaught(ev.error ?? ev.message, { source: ev.filename ?? "" });
  });
  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    void reportCaught(ev.reason);
  });
}
