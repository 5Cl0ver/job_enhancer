// Updates without a refresh (spec 015). When the extension updates, the
// background injects the new content scripts into tabs that are already open
// (background/reinject.js). The OLD copies keep running there — orphaned, with
// a dead chrome.runtime — so two things keep them out of the way:
//
// 1. Each copy claims the page with a fresh token on <html>. A copy whose token
//    was replaced has been superseded and must stop touching the page.
// 2. The on-page elements of copies from before this existed (0.27 and older)
//    used other ids; the new copy removes them so their dead "Refresh page"
//    buttons never show next to the working ones.

/**
 * Claim the page for this copy of a content script.
 * @param {string} scope  one per script ("content", "autofill", "scoutpage")
 * @returns {() => boolean}  true while this copy is still the current one
 */
export function claimPage(scope) {
  const attr = `data-je-${scope}`;
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  document.documentElement.setAttribute(attr, token);
  let superseded = false;
  return () => {
    if (superseded) return false; // once replaced, never current again
    const root = document.documentElement;
    const held = root?.getAttribute(attr);
    if (held == null) {
      // A page that wiped the attribute (re-rendered <html>, document.write)
      // doesn't silence the live copy: it claims the page again. A dead copy
      // (its extension updated away) never does.
      if (runtimeGone()) return false;
      root?.setAttribute(attr, token);
      return true;
    }
    if (held !== token) superseded = true;
    return !superseded;
  };
}

/** True when this script lost its extension (updated or removed). */
export function runtimeGone() {
  try {
    return !chrome.runtime?.id;
  } catch {
    return true;
  }
}

/**
 * Get rid of elements drawn by copies from 0.27 and older. Some of those copies
 * keep redrawing on every page change and never notice they're dead, so the
 * elements are removed now AND hidden for good by a style rule (a redraw then
 * stays invisible).
 * @param {string} selectors
 */
export function sweepLegacy(selectors) {
  for (const el of document.querySelectorAll(selectors)) el.remove();
  const id = "jec-legacy-hide";
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    (document.head || document.documentElement).appendChild(style);
  }
  const rule = `${selectors} { display: none !important; }`;
  if (!style.textContent.includes(rule)) style.textContent += rule + "\n";
}
