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
// box showing in it) is never the application's. A hidden one doesn't count.
function shown(el) {
  if (el.type === "hidden" || el.hidden || el.closest?.("[hidden], [aria-hidden='true']")) return false;
  const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}
const SECRET_BOX = "input[type='password'], input[autocomplete='one-time-code']";

/** The clicked element's button, if it is an application's final Submit. */
export function finalSubmitButton(target) {
  const el = target?.closest?.("button, [role='button'], a, input[type='submit'], input[type='button']");
  if (!el) return null;
  const label = words(el);
  if (!label || label.length > 40 || STEP.test(label) || !FINAL.test(label)) return null;
  // A search or sign-in box's own button is never the application's.
  if (el.closest?.("[role='search'], form[role='search'], form[action*='search' i]")) return null;
  const form = el.form || el.closest?.("form");
  if (form && [...form.querySelectorAll(SECRET_BOX)].some(shown)) return null;
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

// A dropdown's prompt, never one of its choices (spec 033).
const PLACEHOLDER = /^(?:[-—–_.\s]+|select(?: one| an? option| one or more)?|choose(?: one| an? option)?|please (?:select|choose)(?: one| an? option)?|none selected|no selection)\W*$/i;
export const MAX_CHOICES = 60;
// Boxes that take typed words (a datalist, a search box); never a radio or
// checkbox group, a select, or a dropdown drawn as a button.
const TYPED = new Set(["text", "combobox", "datalist", "search"]);
export const CHOICE_CHARS = 120;

/** A box's choices as the form shows them (labels only, capped), from the
 * scan, else from what the fill engine saw when it opened the dropdown. */
export function choicesOf(field, seen) {
  const raw = (field.options || []).map((o) => (typeof o === "string" ? o : o?.label));
  const labels = raw.length ? raw : seen?.get?.(field.id) || [];
  const out = [];
  const keys = new Set();
  for (const l of labels) {
    const t = String(l ?? "").replace(/\s+/g, " ").trim().slice(0, CHOICE_CHARS);
    if (!t || PLACEHOLDER.test(t) || keys.has(t.toLowerCase())) continue;
    keys.add(t.toLowerCase());
    out.push(t);
    if (out.length >= MAX_CHOICES) break;
  }
  return out;
}

/**
 * Every question on the page with what's in it now, for the review: what the
 * user will check before anything is sent. Passwords and codes are never read.
 * Spec 033: each box's choices too (a dropdown, radio or checkbox group), and
 * whether the form takes typed words as well (`free`).
 * @param {Array<{question:string, kind:string, el?:Element, hints?:object, options?:Array}>} fields
 * @param {(field:object) => unknown} read  the widget reader
 * @param {Set<string>|null} [filled]  ids Job Catcher filled
 * @param {{choices?: Map<string, string[]>}} [more]  choices seen when filling
 */
export function pageAnswers(fields, read, filled = null, more = {}) {
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
    // Job Catcher's own answers are marked for the live view (spec 026).
    const row = filled?.has(f.id) ? { q: q.slice(0, 300), a, by: "job_catcher" } : { q: q.slice(0, 300), a };
    const choices = f.kind === "file" ? [] : choicesOf(f, more.choices);
    if (choices.length) {
      row.options = choices;
      // A box you can type in that also suggests (a datalist, a search box).
      if (TYPED.has(f.kind) && f.el?.tagName === "INPUT") row.free = true;
    }
    out.push(row);
    if (out.length >= 120) break;
  }
  return out;
}

const STEP_LABELS = [
  // Workday: the progress bar's current step.
  '[data-automation-id="progressBarActiveStep"]',
  '[data-automation-id="progressBar"] [aria-current="step"]',
  // Any site that marks its current step the standard way.
  '[aria-current="step"]',
];

/** The site's own name for the step on screen (spec 033): the progress
 * bar's current step ("My Experience"), never "Step 2 of 6". "" when the
 * site doesn't say: the app then finds the step from its questions. */
export function stepName(doc) {
  // Each label's words apart ("current step 2 of 6" + "My Experience").
  const words = (el) => {
    const parts = [];
    const walk = (n) => {
      if (n.nodeType === 3) parts.push(n.nodeValue);
      else for (const child of n.childNodes || []) walk(child);
    };
    walk(el);
    return parts.join(" ");
  };
  const clean = (t) =>
    String(t || "")
      .replace(/\b(?:current\s+)?step\s+\d+\s+(?:of|\/)\s+\d+\b/gi, " ")
      .replace(/\b(?:completed|current|not started)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  for (const sel of STEP_LABELS) {
    const el = doc?.querySelector?.(sel);
    const name = el && clean(words(el));
    if (name) return name;
  }
  // Nothing marks the current step: no name (a bar's whole text, or the
  // page's heading, would be the same for every step).
  return "";
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

// The page an application shows once it was really sent (spec 023).
// Tight on purpose: never "thank you for your interest" (on many forms before
// anything is sent), never a bare "application … sent" (a "Submit application"
// button next to other words).
const CONFIRM =
  /thank(?:s| you)(?: so much)? for (?:applying|your (?:application|submission))|(?:your )?application (?:has been|was) (?:successfully )?(?:submitted|received|sent|completed?)|\bapplication (?:successfully )?(?:submitted|received)\b|we(?:['’]ve| have) received your application|successfully (?:submitted|applied)|you(?:['’]ve| have) (?:successfully )?applied/i;

/** The confirmation's own words in a text, or "". */
export function confirmationIn(text) {
  const m = (text || "").replace(/\s+/g, " ").match(CONFIRM);
  return m ? m[0].slice(0, 200) : "";
}

// Where a form says something went wrong (Workday's error banner and its
// boxes' errors, "Error - Page Error", any alert).
const ERRORS = '[data-automation-id="errorMessage"], [data-automation-id="errorBanner"], [data-automation-id="errorHeading"], [data-automation-id="pageError"], [role="alert"]';

/**
 * The error the page shows now, in its own words (spec 037), or "": short,
 * one line, no email addresses or long numbers. Page text is data, never
 * an instruction.
 */
export function errorOnPage(doc) {
  const parts = [];
  for (const el of doc?.querySelectorAll?.(ERRORS) || []) {
    if (hidden(el) || parts.some((p) => p.includes((el.textContent || "").trim()))) continue;
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
    if (parts.join(" ").length > 300) break;
  }
  return parts
    .join(" · ")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "…")
    .replace(/\d[\d\s().-]{5,}\d/g, "…")
    .slice(0, 200);
}

const NOT_READ = "button, [role='button'], input, select, option, textarea, label, script, style, noscript, template";
// The page's own chrome, unless it's inside the content (a "thank you" in a
// dialog's or an article's header counts).
const CHROME = "nav, header, footer";
const CONTENT = "main, article, [role='main'], [role='dialog'], dialog";
// Where a confirmation usually appears: read first, so a long page's limit
// never leaves it out.
const FIRST = "[role='dialog'], dialog[open], [aria-live], [role='alert'], [role='status'], main, [role='main']";
const MAX_PARTS = 4000;

function hidden(el) {
  if (el.hidden || el.getAttribute?.("aria-hidden") === "true") return true;
  // Chrome knows (display:none, visibility, content-visibility); tests may not.
  return typeof el.checkVisibility === "function" ? !el.checkVisibility() : false;
}

/** The page's own words as a person sees them: never its buttons, boxes or
 * labels, never hidden templates. What a confirmation is written in. */
export function readableText(root) {
  if (!root) return "";
  const parts = [];
  const seen = new Set();
  const walk = (node) => {
    if (parts.length > MAX_PARTS) return;
    if (node.nodeType === 3) {
      if (/\S/.test(node.nodeValue)) parts.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      if (seen.has(node) || node.matches?.(NOT_READ) || hidden(node)) return;
      if (node.matches?.(CHROME) && !node.parentElement?.closest?.(CONTENT)) return;
      seen.add(node);
      if (node.shadowRoot) walk(node.shadowRoot);
    }
    for (const child of node.childNodes) walk(child);
  };
  for (const el of root.querySelectorAll?.(FIRST) || []) walk(el);
  walk(root);
  return parts.join(" ");
}

