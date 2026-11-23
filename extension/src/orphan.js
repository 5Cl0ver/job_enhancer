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
  return () => document.documentElement.getAttribute(attr) === token;
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
 * Remove elements left by older copies now, and again over the next few
 * seconds — an orphaned copy can redraw once more before its own timer
 * notices it's dead and stops.
 * @param {string} selectors
 */
export function sweepLegacy(selectors) {
  const sweep = () => {
    for (const el of document.querySelectorAll(selectors)) el.remove();
  };
  sweep();
  for (const ms of [1000, 2500, 5000]) setTimeout(sweep, ms);
}
