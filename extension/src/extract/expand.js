// Opens a job description that hides its end behind a "See more" / "Show
// more" / "… more" button, so a Save reads the whole posting. Self-contained
// (no imports, no outside names): the panel injects it into any page with
// chrome.scripting, and the board content script calls it before a Save.
//
// Only presses buttons that sit next to a long block of text (a description),
// never links that go somewhere, and never one already open. Returns how many
// it pressed; the caller waits a moment and reads the page again.
export function expandMore(root = document) {
  const MORE = /^(?:…|\.\.\.)?\s*(?:(?:see|show|read|view)\s+(?:more|full(?:\s+job)?\s+description|the\s+full\s+description|all)|more(?:\s+details)?)\s*(?:…|\.\.\.)?$/i;
  const words = (el) => (el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
  const opensInPlace = (el) => {
    if (el.tagName !== "A") return true;
    const href = (el.getAttribute("href") || "").trim();
    return !href || href === "#" || /^javascript:/i.test(href);
  };
  // A description's own button: it says it opens something, or it sits inside
  // a block named for the description, beside a long text. A "Show more" under
  // a list of people or skills (which may open a dialog) is left alone.
  const DESCRIPTION = /description|job-?details|jobdetails|posting|about-?the-?job/i;
  const named = (node) =>
    DESCRIPTION.test(
      [node.id, node.getAttribute?.("class"), node.getAttribute?.("data-testid"), node.getAttribute?.("aria-label")]
        .filter(Boolean)
        .join(" "),
    );
  const nextToText = (el) => {
    const says = el.getAttribute("aria-expanded") === "false" || DESCRIPTION.test(el.getAttribute("aria-label") || "");
    let long = false;
    let inDescription = named(el);
    for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (!long && depth < 4 && (node.textContent || "").length >= 300) long = true;
      if (named(node)) inDescription = true;
    }
    return long && (says || inDescription);
  };
  let pressed = 0;
  const seen = root.querySelectorAll("button, [role='button'], a");
  for (const el of seen) {
    if (pressed >= 3) break;
    const label = words(el);
    if (!label || label.length > 40 || !MORE.test(label)) continue;
    if (el.getAttribute("aria-expanded") === "true" || el.disabled) continue;
    if (!opensInPlace(el) || !nextToText(el)) continue;
    try {
      el.click();
      pressed++;
    } catch {
      /* a page's own handler threw: leave it */
    }
  }
  return pressed;
}
