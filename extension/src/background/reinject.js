// Updates never strand open tabs (spec 015). Chrome only runs content scripts
// in pages loaded AFTER the extension (re)starts: an update used to leave every
// open tab with an orphaned copy until the user refreshed it — the reason a
// Claude Scout run could copy none of its jobs. On install/update the background
// injects the current scripts into the tabs already open; each script's own
// claim (orphan.js) retires the old copy.
//
// The page-world bridge (Indeed) is skipped: it never talks to the extension,
// so the copy already in the page keeps working.

/** Does `url` match a manifest match pattern ("https://*.indeed.com/*", "<all_urls>")? */
export function matchesPattern(url, pattern) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (pattern === "<all_urls>") return /^(https?|file|ftp):$/.test(u.protocol);
  const m = /^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  const [, scheme, hostPat, pathPat] = m;
  const proto = u.protocol.slice(0, -1);
  if (scheme === "*" ? !/^https?$/.test(proto) : scheme !== proto) return false;
  const host = u.hostname;
  if (hostPat !== "*") {
    if (hostPat.startsWith("*.")) {
      const base = hostPat.slice(2);
      if (host !== base && !host.endsWith("." + base)) return false;
    } else if (host !== hostPat) {
      return false;
    }
  }
  const pathRe = new RegExp(
    "^" + pathPat.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
  );
  return pathRe.test(u.pathname + u.search);
}

/**
 * The isolated-world content scripts that would run on `url`, from the
 * manifest's content_scripts (honouring exclude_matches; MAIN-world skipped).
 * @returns {Array<{files: string[], allFrames: boolean}>}
 */
export function scriptsForUrl(contentScripts, url) {
  const out = [];
  for (const cs of contentScripts || []) {
    if (cs.world === "MAIN") continue;
    if (!(cs.matches || []).some((p) => matchesPattern(url, p))) continue;
    if ((cs.exclude_matches || []).some((p) => matchesPattern(url, p))) continue;
    out.push({ files: cs.js || [], allFrames: !!cs.all_frames });
  }
  return out;
}

/** Inject the current content scripts into every open tab they belong in. */
export async function reinjectOpenTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts || [];
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return 0;
  }
  let injected = 0;
  await Promise.all(
    tabs.map(async (tab) => {
      // tab.url is only visible for sites we have host access to; discarded
      // tabs reload (and get the scripts) when the user returns to them.
      if (!tab.id || !tab.url || tab.discarded) return;
      for (const { files, allFrames } of scriptsForUrl(scripts, tab.url)) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, files });
          injected++;
        } catch {
          /* a page we may not script (Web Store, error page) — skip it */
        }
      }
    }),
  );
  return injected;
}
