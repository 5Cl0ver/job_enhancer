// Apply with Claude (spec 022), the page side's pure helpers: which button is
// an application's final Submit (blocked until the user's OK), where to stop
// to photograph a long page, and every question on the page with its answer.

// A final send, in the words sites use. Never a step button ("Next",
// "Continue", "Save and continue", "Review") and never a sub-form's own
// ("Save", "Add", "Submit" on a search box is ruled out by context below).
// Never "Apply" / "Apply now": that's the button that OPENS an application.
const FINAL = /^(?:submit|submit (?:my |your |this )?application|submit & (?:apply|finish)|send (?:my |your )?application|complete (?:my |your )?application|finish (?:and|&) submit|submit and finish)$/i;
const STEP = /\b(?:next|continue|save|review|back|previous|add|upload|search|sign in|log in|create account|verify)\b/i;

// "Submit Application ›", "Submit →": the words, without the arrows.
function words(el) {
  const text = el.tagName === "INPUT" ? el.value : el.textContent;
  return (text || el.getAttribute?.("aria-label") || "")
    .replace(/[^\p{L}\p{N}&' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A sign-in or verification form's own "Submit" (a password or one-time code
// box in it) is never the application's.
const SECRET_BOX = "input[type='password'], input[autocomplete='one-time-code']";

/** The clicked element's button, if it is an application's final Submit. */
export function finalSubmitButton(target) {
  const el = target?.closest?.("button, [role='button'], a, input[type='submit'], input[type='button']");
  if (!el) return null;
  const label = words(el);
  if (!label || label.length > 40 || STEP.test(label) || !FINAL.test(label)) return null;
  // A search or sign-in box's own button is never the application's.
  if (el.closest?.("[role='search'], form[role='search'], form[action*='search' i]")) return null;
  if ((el.form || el.closest?.("form"))?.querySelector?.(SECRET_BOX)) return null;
  return el;
}

/** The form's own submit (Enter in a box): its submitter, if it's a final one. */
export function finalSubmitOfForm(event) {
  const by = event.submitter;
  if (by) return finalSubmitButton(by);
  // Enter with no button named: only a form whose sole submit button is final.
  const buttons = [...(event.target?.querySelectorAll?.("button:not([type]), button[type='submit'], input[type='submit']") || [])];
  return buttons.length === 1 ? finalSubmitButton(buttons[0]) : null;
}

/** Where to scroll to photograph a page top to bottom: at most `max` screens,
 * each overlapping the last a little so no line is cut in half. */
export function shotPlan(height, view, max = 8) {
  if (!(view > 0)) return [0];
  const step = Math.max(1, Math.floor(view * 0.9));
  const last = Math.max(0, height - view);
  const out = [];
  for (let y = 0; y < last && out.length < max - 1; y += step) out.push(y);
  out.push(last);
  return [...new Set(out)].slice(0, max);
}

const PRIVATE = /password|passcode|\bpin\b|social security|\bssn\b|\bsin\b|social insurance|security (?:question|answer|code)|one[- ]time|\botp\b|verification code|\bcvv\b|card number/i;

/**
 * Every question on the page with what's in it now, for the review: what the
 * user will check before anything is sent. Passwords and codes are never read.
 * @param {Array<{question:string, kind:string, el?:Element, hints?:object}>} fields
 * @param {(field:object) => unknown} read  the widget reader
 */
export function pageAnswers(fields, read) {
  const out = [];
  const seen = new Set();
  for (const f of fields || []) {
    const q = (f.question || "").replace(/\s+/g, " ").trim();
    if (!q || PRIVATE.test(q) || f.hints?.type === "password" || f.hints?.autocomplete === "one-time-code") continue;
    let a;
    try {
      a = read(f);
    } catch {
      a = "";
    }
    if (f.kind === "file") a = f.el?.files?.[0]?.name || "";
    if (Array.isArray(a)) a = a.join(", ");
    if (typeof a === "boolean") a = a ? "Yes" : "No";
    a = String(a ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
    const key = `${q}\u0000${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ q: q.slice(0, 300), a });
    if (out.length >= 120) break;
  }
  return out;
}

/** Does a page's host belong to the run (its own host or a sub-host)? */
export function onRunHost(host, hosts) {
  const h = (host || "").toLowerCase().replace(/^www\./, "");
  return (hosts || []).some((x) => h === x || h.endsWith(`.${x}`));
}

/** A page that doesn't scroll itself but holds its form in one tall box
 * (html/body fixed height, a main pane that scrolls): that box, or null. */
export function scrollerOf(doc, win) {
  let best = null;
  for (const el of doc.querySelectorAll("main, form, section, div, [role='main']")) {
    if (el.scrollHeight <= el.clientHeight + 4 || el.clientHeight < win.innerHeight * 0.4) continue;
    if (!/(auto|scroll)/.test(win.getComputedStyle(el).overflowY)) continue;
    if (!best || el.scrollHeight > best.scrollHeight) best = el;
  }
  return best;
}
