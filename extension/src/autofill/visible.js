// Is a control on screen for a person (spec 017, research R1–R2)? Judged by
// RENDERING, the way Chrome's own autofill does. aria-hidden / inert on an
// ancestor still count — the page behind a pop-up, an off-canvas drawer and
// spam traps live there — EXCEPT inside an open pop-up: pop-up libraries
// (MUI v4's ModalManager, the aria-hidden package) put aria-hidden on the
// pop-up's own ancestors while it's open. Reading that as "invisible" made
// the scanner blind to every field of Paycom's "Getting You Started" pop-up.
// DOM only: unit-tested in test/never-blind.spec.js.

/** An open pop-up: what a person is looking at, whatever its ancestors say. */
export const POPUP = 'dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"], mat-dialog-container, sdf-dialog, sdf-modal';

const CHOICE = /^(radio|checkbox|file)$/i;

/** Why a control isn't on screen for a person, or "" when it is. */
export function hiddenReason(el) {
  if (!el?.isConnected) return "detached";
  const type = el.getAttribute?.("type") || "";
  const typed = (el.tagName === "INPUT" && !CHOICE.test(type)) || el.tagName === "TEXTAREA";
  // A control a library keeps in sync behind a drawn one (MUI's native
  // select input): hidden from screen readers AND out of the tab order.
  if (el.getAttribute?.("aria-hidden") === "true" && el.getAttribute?.("tabindex") === "-1") return "proxy";
  if (el.closest?.("[aria-hidden=true], [inert]") && !el.closest?.(POPUP)) return "hidden_from_page";
  const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return "not_rendered";
  if (typeof el.checkVisibility === "function") {
    // display:none on an ancestor, content-visibility:hidden, visibility:hidden.
    if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return "not_rendered";
    // A see-through box to type in (a radio or checkbox drawn over its icon
    // is judged by its label instead, in scan.js).
    if (typed && !el.checkVisibility({ opacityProperty: true })) return "see_through";
  } else if (el.closest?.("[hidden]") && !el.getClientRects?.().length) {
    return "not_rendered";
  }
  const rects = el.getClientRects?.();
  if (rects && rects.length === 0) return "no_size";
  // Spam traps ("honeypots") only bots fill: parked far off the page, a
  // speck of a box, or a box to type in that's out of the tab order.
  // Filling one can get an application thrown out.
  const r = el.getBoundingClientRect?.();
  if (r) {
    // Page coordinates, with room for scrolled boxes: a long pop-up that
    // scrolls inside itself puts its top boxes above the view — those are real.
    const view = el.ownerDocument?.defaultView;
    const x = view?.scrollX || 0;
    const y = view?.scrollY || 0;
    const width = Math.max(el.ownerDocument?.documentElement?.scrollWidth || 0, view?.innerWidth || 0);
    if (r.right + x < -500 || r.left + x > width + 500 || r.bottom + y < -5000) return "off_page";
    if (typed && r.width > 0 && r.height > 0 && r.width <= 2 && r.height <= 2) return "speck";
  }
  if (typed && el.getAttribute?.("tabindex") === "-1") return "trap";
  return "";
}

export const isOnScreen = (el) => hiddenReason(el) === "";
