// Opens a job description that hides its end behind a "See more" / "Show
// more" / "… more" button, so a Save reads the whole posting. Self-contained
// (no imports, no outside names): the panel injects it into any page with
// chrome.scripting, and the board content script calls it before a Save.
//
// Careful by design: presses at most ONE button (two toggles wired to the same
// description would open and close it again), only one whose words say it
// shows more of a text, sitting in a description block or saying it expands a
// long text next to it. Never menus, dialogs, page headers or navigation,
// never a form's submit button, never a link that goes somewhere, never a
// hidden one, and nothing at all while the user has text highlighted (their
// highlight is the description they chose). Returns how many it pressed (0 or
// 1); the caller waits a moment and reads the page again.
export function expandMore(root = document) {
  const win = root.defaultView || (typeof window !== "undefined" ? window : null);
  const highlighted = (win?.getSelection?.()?.toString() || "").trim();
  if (highlighted.length > 40) return 0;

  const MORE = /^(?:…|\.\.\.)?\s*(?:(?:see|show|read|view)\s+(?:more|full(?:\s+job)?\s+description|the\s+full\s+description)(?:\s+details)?|(?:…|\.\.\.)\s*more)\s*(?:…|\.\.\.)?$/i;
  const DESCRIPTION = /(?:job|posting)[-_]?description|jobs-description|jobdescription|description[-_]?(?:text|content|body)|about-?the-?job/i;
  // Page-level only: a description's own "See more" often sits in a small
  // <footer> inside the description (LinkedIn's jobs-description__footer).
  const AWAY = "body > header, body > footer, [role='banner'], [role='contentinfo'], nav, [role='menu'], [role='menubar'], [role='dialog'], [role='navigation'], [role='listbox'], [aria-modal='true']";
  const laidOut = (root.body?.getClientRects?.().length || 0) > 0;

  const words = (el) => (el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
  const named = (node) =>
    DESCRIPTION.test(
      [node.id, node.getAttribute?.("class"), node.getAttribute?.("data-testid")].filter(Boolean).join(" "),
    );
  const hidden = (el) => {
    if (el.closest("[hidden], [aria-hidden='true']")) return true;
    const cs = win?.getComputedStyle?.(el);
    if (cs && (cs.display === "none" || cs.visibility === "hidden")) return true;
    return laidOut && !el.getClientRects().length;
  };
  const safe = (el) => {
    const popup = el.getAttribute("aria-haspopup");
    if (el.disabled || (popup && popup !== "false") || el.closest(AWAY)) return false;
    if (el.tagName === "A") {
      const href = (el.getAttribute("href") || "").trim();
      return !href || href === "#" || /^javascript:/i.test(href);
    }
    // A <button> in a form submits it unless it says otherwise.
    if (el.tagName === "BUTTON" && el.form && (el.getAttribute("type") || "submit").toLowerCase() === "submit") return false;
    return true;
  };
  // The long text it opens: its aria-controls target, or a text right around it.
  const opensText = (el) => {
    const target = el.getAttribute("aria-controls");
    const controlled = target && root.getElementById?.(target);
    if (controlled && (controlled.textContent || "").length >= 300) return true;
    for (let node = el.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
      if ((node.textContent || "").length >= 300) return true;
    }
    return false;
  };
  const inDescription = (el) => {
    for (let node = el, depth = 0; node && depth < 7; node = node.parentElement, depth++) {
      if (named(node)) return true;
    }
    return /description/i.test(el.getAttribute("aria-label") || "");
  };

  const candidates = [];
  for (const el of root.querySelectorAll("button, [role='button'], a")) {
    const label = words(el);
    if (!label || label.length > 40 || !MORE.test(label)) continue;
    if (el.getAttribute("aria-expanded") === "true" || !safe(el) || hidden(el) || !opensText(el)) continue;
    const described = inDescription(el);
    if (!described && el.getAttribute("aria-expanded") !== "false") continue;
    candidates.push({ el, described });
  }
  const pick = candidates.find((c) => c.described) || candidates[0];
  if (!pick) return 0;
  try {
    pick.el.click();
    return 1;
  } catch {
    return 0; // the page's own handler threw: leave it
  }
}
