// The user pressed an Apply that leaves for the company's application (spec
// 040). PURE but for the DOM it's given: unit-tested in
// test/files-and-tabs-040.spec.js.
//
// Only a hint: right after such a press on a saved job's own page, the side
// panel suggests that job on the next pages; its files are used only when
// the user picks them for a fill. Only the user's own clicks count
// (`isTrusted`), in the page itself (the background drops a frame's: an ad).

// The whole label, so "Apply filters" never counts: "Apply", "Apply now",
// "Apply on company website", "Apply on company site", "Apply for this job",
// "Apply externally", "Start application"; LinkedIn's aria-label "Apply to
// <job> on company website".
const APPLY = /^(apply( now| here| online| today)?|apply (for|to) (this|the) (job|position|role)|apply (on|at|via) (the )?(company|employer)('s)?( web)? ?site|apply on company|apply externally|apply to .{1,90} on (the )?company('s)? (web)?site|continue to (the )?(application|apply|company('s)? (web)?site)|start (your |an |the )?application|begin (your )?application|i'?m interested)$/i;
// Easy Apply stays on the board: nothing to carry.
const STAYS = /easy apply|quick apply/i;
// LinkedIn's "Share your profile?" dialog: its Continue opens the company's site.
const SHARE = /share (your )?profile/i;

/** Does this control's text say it's the Apply that leaves the board? */
export function applyLabel(text, { inShareDialog = false } = {}) {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[\s›>→↗»]+$/u, "")
    .trim();
  if (!t || t.length > 120 || STAYS.test(t)) return false;
  if (inShareDialog && /^continue$/i.test(t)) return true;
  return APPLY.test(t);
}

const CONTROL = "a, button, [role=button], [role=link], input[type=submit], input[type=button]";

/** The words a control shows and says. */
function labelsOf(el) {
  return [el.getAttribute("aria-label"), el.getAttribute("title"), el.tagName === "INPUT" ? el.value : el.textContent].filter(Boolean);
}

/** Was this event a press on an Apply that leaves? */
export function isApplyPress(event) {
  if (!event?.isTrusted) return false;
  // Inside a shadow root too: the first control on the click's path.
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  const el = path.find((n) => n?.nodeType === 1 && n.matches?.(CONTROL)) || event.target?.closest?.(CONTROL);
  if (!el) return false;
  const dialog = el.closest("[role=dialog], [role=alertdialog], dialog");
  const inShareDialog = !!dialog && SHARE.test(dialog.textContent || "");
  return labelsOf(el).some((t) => applyLabel(t, { inShareDialog }));
}

/** Tell the background about each Apply press in this frame. */
export function watchApplyPresses(doc, onPress) {
  const handler = (e) => {
    try {
      if (isApplyPress(e)) onPress();
    } catch {
      /* never in the page's way */
    }
  };
  // Capture: before the page's own handler opens the new tab or navigates.
  doc.addEventListener("click", handler, true);
  doc.addEventListener("auxclick", handler, true);
  return () => {
    doc.removeEventListener("click", handler, true);
    doc.removeEventListener("auxclick", handler, true);
  };
}
