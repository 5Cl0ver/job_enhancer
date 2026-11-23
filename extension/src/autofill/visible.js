// Is a control on screen for a person (spec 017, research R1–R2)? Judged by
// RENDERING only, the way Chrome's own autofill does — never by accessibility
// attributes. aria-hidden means "hide from screen readers", and pop-up
// libraries (MUI v4's ModalManager, the aria-hidden package) put it on the
// pop-up's own ancestors while it's open: reading it as "invisible" made the
// scanner blind to every field of Paycom's "Getting You Started" pop-up.
// DOM only: unit-tested under happy-dom in test/never-blind.spec.js.

/** Why a control isn't on screen, or "" when it is. */
export function hiddenReason(el) {
  if (!el?.isConnected) return "detached";
  // A control a library keeps in sync behind a drawn one (MUI's native
  // select input): hidden from screen readers AND out of the tab order.
  if (el.getAttribute?.("aria-hidden") === "true" && el.getAttribute?.("tabindex") === "-1") return "proxy";
  if (typeof el.checkVisibility === "function") {
    // display:none on it or an ancestor, content-visibility:hidden, visibility:hidden.
    if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return "not_rendered";
  } else {
    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) return "not_rendered";
    if (el.closest?.("[hidden]") && !el.getClientRects?.().length) return "not_rendered";
  }
  const rects = el.getClientRects?.();
  if (rects && rects.length === 0) return "no_size";
  return "";
}

export const isOnScreen = (el) => hiddenReason(el) === "";
