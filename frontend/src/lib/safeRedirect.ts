/**
 * Where to go after signing in — only ever a page inside this app.
 *
 * Sign-in links carry `?redirect=` (the Claude connector approval, Connect Job
 * Catcher…). Anything that could leave the app is refused: absolute URLs,
 * protocol-relative `//host`, backslashes (browsers read `/\host` as `//host`),
 * encoded slashes or backslashes, `javascript:` and other schemes, control
 * characters. Falls back to `/`.
 */
export function safeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string" || !target) return fallback;
  let decoded = target;
  try {
    // Decode twice: `%252f` → `%2f` → `/`.
    decoded = decodeURIComponent(decodeURIComponent(target));
  } catch {
    return fallback;
  }
  for (const s of [target, decoded]) {
    if (!s.startsWith("/")) return fallback;
    if (s.startsWith("//")) return fallback;
    if (s.includes("\\")) return fallback;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(s)) return fallback;
    if (/^\/+[a-z][a-z0-9+.-]*:/i.test(s)) return fallback;
  }
  // The browser's own reading must stay on this origin.
  try {
    const base = window.location.origin;
    const url = new URL(target, base);
    if (url.origin !== base) return fallback;
    // After the browser tidies it ("/.//evil.com" → "//evil.com"), it must
    // still be a plain path: never "//host", never a backslash.
    if (url.pathname.startsWith("//") || url.pathname.includes("\\")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

const KEY = "je.redirect";

/** Keep the target across a GitHub sign-in round trip. */
export function rememberRedirect(target: string): void {
  try {
    sessionStorage.setItem(KEY, safeRedirect(target));
  } catch {
    // private mode: the round trip just lands on the start page
  }
}

/** The target kept for after a GitHub sign-in. Every GitHub sign-in from
 *  Login sets it first, so an old value is never reused by mistake. */
export function takeRememberedRedirect(): string {
  try {
    return safeRedirect(sessionStorage.getItem(KEY));
  } catch {
    return "/";
  }
}
