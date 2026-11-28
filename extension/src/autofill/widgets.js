// Write a value into a field the way a person would, so the page's own code
// (React, Vue, Workday...) registers it — then READ IT BACK. A field counts as
// filled only when the page holds the value (spec 015, FR-003).
//
// Each kind has: write(field, candidates) → {ok, actual, reason?},
// read(field), snapshot(field), restore(field, snap) (for Undo).
// DOM only; happy-dom covers the simple kinds (test/fill-engine.spec.js), the
// browser lab covers the rest (e2e/autofill-*.spec.js).
import { isPlaceholderOption, matchOption } from "./classify/answers.js";
import { untouchableChoice } from "./classify/profileKeys.js";
import { PROMPT_BOX, comboBox, textOf } from "./scan.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+@.]+/g, " ")
    .trim();

// ---- Job Catcher writing ----------------------------------------------------
// While Job Catcher writes into the page (and a moment after), what the page
// does is Job Catcher's doing — even TRUSTED events: moving focus fires a real
// blur/focusout on the box before. The page script asks `writingNow()` before
// taking anything as the user's own edit, and compares with what Job Catcher
// last left in a box (`writtenValue`), so its fills and Undos never count.

let writes = 0;
let quietUntil = 0;
const lastShown = new WeakMap();

/** Is Job Catcher writing into the page right now (or just was)? */
export function writingNow() {
  return writes > 0 || Date.now() < quietUntil;
}

/** What Job Catcher last left in a box (its fill or its Undo), as `shownValue` reads it. */
export function writtenValue(el) {
  return lastShown.get(el);
}

/** What a box shows, the same way for every kind ("Yes"/"No" for a tick box). */
export function shownValue(el) {
  if (!el) return "";
  if (el.type === "checkbox" || el.type === "radio") return el.checked ? "Yes" : "No";
  if (el.tagName === "BUTTON" || el.isContentEditable) return (el.textContent || "").trim();
  return String(el.value ?? "").trim();
}

/** Run a write as Job Catcher's (field: the box it writes; its result is remembered). */
export async function asWriter(field, fn) {
  writes++;
  try {
    return await fn();
  } finally {
    writes--;
    quietUntil = Date.now() + 150;
    for (const el of [field?.el, ...(field?.options || []).map((o) => o.el)]) {
      if (el?.isConnected) lastShown.set(el, shownValue(el));
    }
  }
}

// ---- Events ---------------------------------------------------------------

/** The window an element belongs to (its event classes and prototypes). */
const win = (el) => el?.ownerDocument?.defaultView || globalThis;

/** Fire an event built from the element's own window's classes. */
export function fire(el, kind, type, opts = {}) {
  const W = win(el);
  const C = W[kind] || W.Event || Event;
  return el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, composed: true, ...opts }));
}

function nativeSetter(el) {
  const W = win(el);
  const proto =
    el.tagName === "TEXTAREA"
      ? W.HTMLTextAreaElement?.prototype
      : el.tagName === "SELECT"
        ? W.HTMLSelectElement?.prototype
        : W.HTMLInputElement?.prototype;
  return proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
}

/** Set a value through the native setter (frameworks track the property),
 *  then fire what typing fires, so the page's state updates. */
export function setNativeValue(el, value, { blur = true } = {}) {
  try {
    el.focus?.({ preventScroll: true });
  } catch {
    /* not focusable */
  }
  const setter = nativeSetter(el);
  if (setter) setter.call(el, value);
  else el.value = value;
  fire(el, "Event", "input");
  fire(el, "Event", "change");
  if (blur) {
    fire(el, "FocusEvent", "blur", { bubbles: false });
    fire(el, "FocusEvent", "focusout");
  }
}

/** A real-looking click: pointer + mouse down/up, then click. */
export function pointerClick(el) {
  const opts = { button: 0 };
  const P = win(el).PointerEvent ? "PointerEvent" : "MouseEvent";
  fire(el, P, "pointerdown", opts);
  fire(el, "MouseEvent", "mousedown", opts);
  fire(el, P, "pointerup", opts);
  fire(el, "MouseEvent", "mouseup", opts);
  fire(el, "MouseEvent", "click", opts);
}

function key(el, k) {
  fire(el, "KeyboardEvent", "keydown", { key: k, code: k });
  fire(el, "KeyboardEvent", "keyup", { key: k, code: k });
}

const digits = (s) => String(s ?? "").replace(/\D/g, "");
export const same = (actual, wanted) => {
  const a = norm(actual);
  const w = norm(wanted);
  if (!a) return false;
  // A phone box that shows "(555) 010-4477" for "555-010-4477".
  const ad = digits(actual);
  if (ad.length >= 7 && ad === digits(wanted)) return true;
  return a === w || a.includes(w) || (a.length >= 3 && w.includes(a));
};

// ---- Text, text areas, editable boxes ------------------------------------

function writeText(field, [value]) {
  const el = field.el;
  if (field.kind === "editable") {
    el.focus();
    try {
      el.ownerDocument.execCommand("selectAll");
      if (!el.ownerDocument.execCommand("insertText", false, value)) throw new Error("no execCommand");
    } catch {
      el.textContent = value;
      fire(el, "InputEvent", "input", { data: value });
    }
  } else {
    // Respect a field's max length (a phone box that takes 10 digits...).
    const max = field.hints?.maxLength || 0;
    let v = String(value);
    if (max && v.length > max && /^[\d\s()+.-]+$/.test(v)) v = v.replace(/\D/g, "").slice(-max);
    setNativeValue(el, max ? v.slice(0, max) : v);
  }
  const actual = readField(field);
  // A rich-text box drops paragraph breaks from its text: compare without
  // any spacing at all, so a letter pasted whole counts as taken (spec 031).
  const squash = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
  const kept = field.kind === "editable" && squash(value).length > 0 && squash(actual) === squash(value);
  return { ok: kept || same(actual, value) || (field.hints?.maxLength && !!actual), actual };
}

// ---- Dates ---------------------------------------------------------------

function toDate(value, now = new Date()) {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(`${s.slice(0, 10)}T12:00:00`);
  // A notice period ("2 weeks", "30 days", "1 month", "immediately") → the date.
  if (/^(immediately|asap|now|right away)$/i.test(s)) return now;
  const m = /^(\d+)\s*(day|week|month)s?\b/i.exec(s);
  if (m) {
    const d = new Date(now);
    const n = Number(m[1]);
    if (/day/i.test(m[2])) d.setDate(d.getDate() + n);
    else if (/week/i.test(m[2])) d.setDate(d.getDate() + 7 * n);
    else d.setMonth(d.getMonth() + n);
    return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function writeDate(field, [value]) {
  const d = toDate(value);
  if (!d) return { ok: false, reason: "no_data" };
  const p2 = (n) => String(n).padStart(2, "0");
  const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const v = field.kind === "month" ? iso.slice(0, 7) : iso;
  setNativeValue(field.el, v);
  const actual = readField(field);
  return { ok: actual === v, actual };
}

/**
 * Workday's month / year date parts (role=spinbutton): its own way to commit
 * a value is one below, then ArrowUp (it counts up and keeps it). If the page
 * didn't take that, set it like typing. Read back: the number must be there.
 * (job_app_filler's commit trick, research R4.)
 */
function writeSpin(field, [value]) {
  const el = field.el;
  const want = String(value ?? "").trim();
  const n = Number.parseInt(want, 10);
  if (!Number.isFinite(n)) return { ok: false, reason: "no_data" };
  const num = () => Number.parseInt(el.value || "", 10);
  try {
    el.focus?.({ preventScroll: true });
  } catch {
    /* not focusable */
  }
  const setter = nativeSetter(el);
  if (setter) setter.call(el, String(n - 1));
  else el.value = String(n - 1);
  key(el, "ArrowUp");
  el.click?.();
  if (num() !== n) setNativeValue(el, want, { blur: false });
  fire(el, "FocusEvent", "blur", { bubbles: false });
  fire(el, "FocusEvent", "focusout");
  return { ok: num() === n, actual: el.value || "" };
}

/**
 * A search prompt's chips: add each item (skills) one at a time. A prompt
 * that answers ONE question ("How did you hear about us?", spec 036) takes
 * the first of the answer's wordings the site offers, and only that one.
 */
async function writeChips(field, items) {
  homeOf(field.el);
  try {
    return await writeChipsNow(field, items);
  } finally {
    field.el = liveBox(field.el);
  }
}

async function writeChipsNow(field, items) {
  if (field.single) {
    const have = chipsOf(field.el);
    const hit = items.find((it) => have.some((c) => norm(c) === norm(String(it).split(">").pop())));
    if (hit) return { ok: true, already: true, actual: have.join(", ") };
    for (const item of items.slice(0, 4)) {
      const res = await searchPick(field.el, item);
      if (res.ok) return { ok: true, actual: chipsOf(field.el).join(", ") };
    }
    return { ok: false, reason: "no_option", actual: chipsOf(field.el).join(", ") };
  }
  // Skills (spec 037): only the site's own entry for each one (exact, or the
  // same but for case, spaces and punctuation, or a known other name), never a
  // longer one that starts the same; at most ~30 s for the whole box. What
  // the site doesn't offer is said (`notAdded`), never dropped silently.
  const end = Date.now() + CHIP_WAITS.budgetMs;
  let added = 0;
  let had = 0;
  const skipped = [];
  for (const item of items) {
    const name = String(item ?? "").trim();
    if (!name) continue;
    if (Date.now() > end) {
      skipped.push(name);
      continue;
    }
    const got = await pickSkill(field.el, name, end);
    if (got === "added") added++;
    else if (got === "already") had++;
    else skipped.push(name);
  }
  const actual = chipsOf(field.el).join(", ");
  const more = skipped.length ? { notAdded: skipped } : {};
  if (added) return { ok: true, actual, ...more };
  if (had) return { ok: true, already: true, actual, ...more };
  return { ok: false, reason: "no_option", actual, ...more };
}

/** How long a skill search waits for the site's results, and the whole box (tests shorten them). */
export const CHIP_WAITS = { resultsMs: 2500, budgetMs: 30_000 };

// The same skill, said another way (both ways round).
const SKILL_ALIASES = [
  ["M365", "Microsoft 365"],
  ["O365", "Office 365"],
  ["AD", "Active Directory"],
  // Workday's own names for them (spec 040).
  [".NET", ".NET Framework"],
  ["Azure", "Microsoft Azure"],
  ["AKS", "Azure Kubernetes Service"],
  ["K8s", "Kubernetes"],
  ["JS", "JavaScript"],
  ["TS", "TypeScript"],
  ["GCP", "Google Cloud Platform"],
  ["AWS", "Amazon Web Services"],
  ["SQL Server", "Microsoft SQL Server"],
];
// Letters and digits of any language (and + #: "C++", "C#"), nothing else.
const squash = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, "");

/** The ways a label names a skill: itself, without a trailing "(qualifier)"
 * ("Python (Programming Language)"), and the acronym in its brackets
 * ("Amazon Web Services (AWS)"). Never an empty one. */
function skillForms(label) {
  const t = String(label ?? "").trim();
  const forms = [t];
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(t);
  if (m) {
    forms.push(m[1]);
    if (/^[\p{Lu}\p{N}.+#&-]{2,10}$/u.test(m[2].trim())) forms.push(m[2]);
  }
  return forms.map(squash).filter(Boolean);
}

/** Do a skill and a site's entry name the same thing (spec 037)? */
export function sameSkill(a, b) {
  const fb = skillForms(b);
  return skillForms(a).some((x) => fb.includes(x));
}

/**
 * The ways to look a skill up: itself and its other names; then, for
 * "Windows 10/11" (a shared start, then one part or the other), each part
 * on its own ("Windows 10", "Windows 11"). "TCP/IP" and "CI/CD" stay whole.
 * @returns {{names: string[], parts: string[]}}
 */
export function skillWordings(skill) {
  const s = String(skill ?? "").trim();
  const names = [s];
  for (const pair of SKILL_ALIASES) {
    const i = squash(s) ? pair.findIndex((a) => squash(a) === squash(s)) : -1;
    if (i >= 0 && !names.includes(pair[1 - i])) names.push(pair[1 - i]);
  }
  const m = /^(.*\s)([\w.+#]+)\s*\/\s*([\w.+#]+)$/.exec(s);
  const parts = m && m[1].trim() ? [`${m[1]}${m[2]}`, `${m[1]}${m[3]}`] : [];
  return { names, parts };
}

/** One skill: "added", "already" (a chip already), or "" (not offered). */
async function pickSkill(input, skill, end) {
  const { names, parts } = skillWordings(skill);
  const has = (n) => chipsOf(input).some((c) => sameSkill(n, c));
  if (names.some(has)) return "already";
  const wait = () => Math.max(0, Math.min(CHIP_WAITS.resultsMs, end - Date.now()));
  for (const name of names) {
    if (Date.now() > end) return "";
    const res = await searchPick(input, name, { wait: wait(), strict: true, also: names });
    if (res.ok) return res.already ? "already" : "added";
  }
  let any = "";
  for (const part of parts) {
    if (Date.now() > end) break;
    if (has(part)) {
      any ||= "already";
      continue;
    }
    const res = await searchPick(input, part, { wait: wait(), strict: true });
    if (res.ok) any = "added";
  }
  return any;
}

// ---- Native dropdowns ----------------------------------------------------

function writeSelect(field, candidates) {
  const el = field.el;
  const options = [...el.options].map((o) => ({ label: o.textContent.trim(), value: o.value }));
  const i = firstMatch(candidates, options);
  if (i < 0) return { ok: false, reason: "no_option" };
  const setter = nativeSetter(el);
  if (setter) setter.call(el, options[i].value);
  else el.value = options[i].value;
  fire(el, "Event", "input");
  fire(el, "Event", "change");
  fire(el, "FocusEvent", "focusout");
  const actual = readField(field);
  return { ok: actual === options[i].label, actual };
}

/** Every way of saying the answer EXACTLY first, then the looser matches. */
function firstMatch(candidates, options) {
  for (const strict of [true, false]) {
    for (const c of candidates) {
      const i = matchOption(c, options, { strict });
      if (i >= 0) return i;
    }
  }
  return -1;
}

// ---- Choices: radios, checkbox lists, pressable buttons -------------------

function clickChoice(el) {
  if (el.tagName === "INPUT") el.click();
  else pointerClick(el);
}

function writeChoice(field, candidates) {
  const options = field.options || [];
  if (field.kind === "checkbox_list") {
    // "LinkedIn, Referral" → tick each; leave others as they are. Never an
    // agreement or a self-ID answer, whatever was asked (spec 034 review).
    const want = candidates[0].split(/\s*[,;]\s*/).filter(Boolean);
    const picks = want.map((w) => matchOption(w, options)).filter((i) => i >= 0 && !untouchableChoice(options[i].label, "checkbox_list", field.question));
    if (!picks.length) return { ok: false, reason: "no_option" };
    for (const i of picks) if (!options[i].el.checked) clickChoice(options[i].el);
    const actual = readField(field);
    return { ok: picks.every((i) => options[i].el.checked), actual };
  }
  if (field.kind === "checkbox") {
    const yes = /^(yes|true|checked|1)$/i.test(String(candidates[0]).trim());
    if (field.el.checked !== yes) clickChoice(field.el);
    return { ok: field.el.checked === yes, actual: field.el.checked ? "Yes" : "No" };
  }
  const i = firstMatch(candidates, options);
  if (i < 0) return { ok: false, reason: "no_option" };
  if (untouchableChoice(options[i].label, field.kind, field.question)) return { ok: false, reason: "consent" };
  clickChoice(options[i].el);
  const actual = readField(field);
  return { ok: same(actual, options[i].label), actual };
}

function pressed(el) {
  return (
    el.getAttribute("aria-pressed") === "true" ||
    el.getAttribute("aria-checked") === "true" ||
    el.getAttribute("data-state") === "on" ||
    el.getAttribute("data-selected") === "true" ||
    /\b(selected|active|checked|is-selected)\b/.test(el.className || "")
  );
}

// ---- Search-style dropdowns (react-select, Workday, typeaheads) -----------
// One list at a time (spec 020, US3): close any list left open, open this
// one, choose, check the choice took, close it and make sure it closed —
// only then the next. Never the "first option" as a guess. (Event orders and
// Workday's popup markup from working open-source fillers: research R5.)

/** Lists a page has open right now: Workday's active popups, expanded controls' lists. */
const POPUPS = '[data-automation-activepopup="true"], [data-automation-id="activeListContainer"]';
const EXPANDED = '[aria-expanded="true"]:is([aria-haspopup], [role="combobox"], input[aria-autocomplete])';

const shown = (el) => !el.getClientRects || el.getClientRects().length > 0;

function openPopups(doc) {
  return [...doc.querySelectorAll(POPUPS)].filter(shown);
}

function expandedControls(doc) {
  return [...doc.querySelectorAll(EXPANDED)].filter(shown);
}

/** How many dropdown lists are open on the page (tests and the lab check it's never 2). */
export function openPopupCount(doc) {
  return Math.max(openPopups(doc).length, expandedControls(doc).length);
}

// Every dropdown waits for the one before it: two are never open together.
let comboChain = Promise.resolve();
function oneAtATime(fn) {
  const run = comboChain.then(fn, fn);
  comboChain = run.catch(() => {});
  return run;
}

// The application's own pop-up window (LinkedIn Easy Apply, Paycom's "Getting
// You Started", a Bootstrap .modal): never closed by closing a list. Inside
// one, nothing is ever clicked but the list's own button — a click on the
// pop-up, its wrapper or its backdrop can dismiss it and lose the application.
const DIALOG = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

const inDialog = (el) => !!el?.closest?.(DIALOG);

/** Where a click closes a list without closing anything else: the page's main area — never inside a pop-up. */
function neutralSpot(doc) {
  const spot = doc.querySelector('[data-automation-id="mainContent"]') || doc.body;
  return inDialog(spot) ? null : spot;
}

/** Lists this driver opened (control → the options that were showing before), until closed. */
const ours = new Map();

/**
 * Shut one list we opened. Outside an application pop-up: Escape, leave the
 * box, a click on the page, the list's own button. Inside one: only leave the
 * box or press the list's own button again — if it still won't close, it's
 * left open (reported) rather than risk the pop-up.
 */
async function shut(field, isOpen) {
  const el = field.el;
  const doc = el.ownerDocument;
  const closed = () => !isOpen();
  if (closed()) return true;
  const inside = inDialog(el);
  if (!inside) {
    key(el, "Escape");
    if (await until(closed, 200)) return true;
  }
  if (el.tagName === "INPUT") {
    fire(el, "FocusEvent", "blur", { bubbles: false });
    fire(el, "FocusEvent", "focusout");
    el.blur?.();
    if (await until(closed, 200)) return true;
  }
  if (!inside) {
    const spot = neutralSpot(doc);
    if (spot) {
      pointerClick(spot);
      if (await until(closed, 200)) return true;
    }
  }
  // Its own toggle button: press it once more — only while open.
  if (el.tagName !== "INPUT" && !closed()) pointerClick(el);
  return until(closed, 300);
}

/**
 * Before opening a list: close the lists THIS driver left open, and on a
 * Workday page Workday's own open list (its stacked lists are the bug) unless
 * it sits inside a pop-up. Never anything else the page has open.
 */
async function closeOpenLists(doc, quiet = 400) {
  const mine = () => [...ours].filter(([el, before]) => el.isConnected && listOpen({ el }, before));
  const workday = () => openPopups(doc).filter((p) => !inDialog(p));
  const open = () => mine().length + workday().length > 0;
  for (let round = 0; round < 3 && open(); round++) {
    for (const [el, before] of mine()) await shut({ el }, () => listOpen({ el }, before));
    if (workday().length) {
      for (const c of expandedControls(doc)) if (c.matches('button[aria-haspopup="listbox"]') && !inDialog(c)) key(c, "Escape");
      if (!(await until(() => !workday().length, 150))) {
        const spot = neutralSpot(doc);
        if (spot) pointerClick(spot);
        await until(() => !workday().length, 150);
      }
    }
  }
  for (const [el, before] of [...ours]) if (!el.isConnected || !listOpen({ el }, before)) ours.delete(el);
  return !open() || (await until(() => !open(), quiet));
}

/** Is a list we opened still open: its control says so, or its options still show. */
function listOpen(field, before) {
  const el = field.el;
  if (el.getAttribute("aria-expanded") === "true") return true;
  // A search box we typed in, still focused, with Workday's (maybe empty) result list up.
  if (el.tagName === "INPUT" && el.ownerDocument.activeElement === el && openPopups(el.ownerDocument).length) return true;
  return visibleOptions(field, before).length > 0;
}

async function until(test, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (test()) return true;
    if (Date.now() > end) return false;
    await sleep(40);
  }
}

/** Where this dropdown's options are: its own list, else the open popup, else the page. */
function optionScopes(field) {
  const el = field.el;
  const root = el.getRootNode?.() || el.ownerDocument;
  const doc = el.ownerDocument;
  const owned = [el.getAttribute("aria-controls"), el.getAttribute("aria-owns")]
    .flatMap((v) => String(v || "").split(/\s+/))
    .filter(Boolean)
    .map((id) => root.getElementById?.(id) || doc.getElementById(id))
    .filter(Boolean);
  if (owned.length) return { scopes: owned, owned: true };
  const pops = openPopups(doc);
  if (pops.length) return { scopes: pops, owned: true };
  return { scopes: [root, ...(root !== doc ? [doc] : [])], owned: false };
}

/** The options a dropdown is showing right now (minus `before`: options
 *  that were already open elsewhere on the page before we opened this one).
 *  Each: {el, label, click} — `click` is Workday's leaf node when there is one. */
export function visibleOptions(field, before = null) {
  const { scopes, owned } = optionScopes(field);
  const seen = new Set();
  const out = [];
  for (const scope of scopes) {
    for (const o of scope.querySelectorAll('[role="option"], [data-automation-id="promptOption"], [data-automation-id="promptLeafNode"]')) {
      // One option drawn as li > promptOption > promptLeafNode counts once.
      const top = o.closest('[role="option"]') || o.closest('[data-automation-id="promptOption"]') || o;
      if (seen.has(top) || top.getAttribute("aria-disabled") === "true") continue;
      if (before?.has(top) && !owned) continue;
      if (!shown(top)) continue; // a closed menu's options
      seen.add(top);
      // Click the innermost part that listens: Workday's leaf node, else its option body.
      const leaf = top.matches('[data-automation-id="promptLeafNode"]') ? top : top.querySelector('[data-automation-id="promptLeafNode"]');
      const body = leaf || top.querySelector('[data-automation-id="promptOption"]') || top;
      const label = (top.getAttribute("data-automation-label") || textOf(body)).trim();
      if (label && !isPlaceholderOption(label)) out.push({ el: top, label, click: body });
    }
  }
  return out;
}

async function waitForOptions(field, ms, before = null) {
  const end = Date.now() + ms;
  for (;;) {
    const opts = visibleOptions(field, before);
    if (opts.length || Date.now() > end) return opts;
    await sleep(60);
  }
}

function openCombo(field) {
  const el = field.el;
  try {
    el.focus?.({ preventScroll: true });
  } catch {
    /* fine */
  }
  if (el.tagName === "INPUT") {
    // react-select opens on a mousedown on its control; plain comboboxes on
    // ArrowDown.
    pointerClick(comboBox(el) === el ? el : comboBox(el));
    key(el, "ArrowDown");
  } else {
    pointerClick(el);
  }
}

/** Is THIS dropdown's list still open? */
function stillOpen(field, before) {
  const el = field.el;
  const doc = el.ownerDocument;
  if (el.getAttribute("aria-expanded") === "true") return true;
  if (openPopups(doc).length) return true;
  return visibleOptions(field, before).length > 0;
}

/** Close this dropdown and make sure it closed (true when it did). */
async function closeCombo(field, before) {
  const el = field.el;
  if (el.tagName === "INPUT" && el.value && !readField(field)) setNativeValue(el, "", { blur: false });
  // Most close by themselves after a pick.
  const ok = (await until(() => !stillOpen(field, before), 250)) || (await shut(field, () => stillOpen(field, before)));
  if (ok) ours.delete(el);
  return ok;
}

/** The scrolling box of a long list that draws only what's in view. */
function scroller(opts) {
  let n = opts[0]?.el.parentElement;
  for (let i = 0; n && i < 5; i++, n = n.parentElement) {
    if (n.matches('[role="listbox"], [data-automation-id="activeListContainer"], .ReactVirtualized__Grid') || n.scrollHeight > n.clientHeight + 4) return n;
  }
  return opts[0]?.el.parentElement || null;
}

/** Look further down a long (virtualised) list for a match: -1 if none. */
async function scrollForMatch(field, pick, before) {
  let opts = visibleOptions(field, before);
  const box = scroller(opts);
  if (!box) return { i: -1, opts };
  const seen = new Set(opts.map((o) => o.label));
  let stale = 0;
  for (let step = 0; step < 80 && stale < 3; step++) {
    const top = box.scrollTop;
    box.scrollTop = top + Math.max(120, (box.clientHeight || 0) * 0.8);
    fire(box, "Event", "scroll", { bubbles: false });
    await sleep(80);
    opts = visibleOptions(field, before);
    const i = pick(opts);
    if (i >= 0) return { i, opts };
    const fresh = opts.filter((o) => !seen.has(o.label));
    fresh.forEach((o) => seen.add(o.label));
    stale = fresh.length ? 0 : stale + 1;
    if (box.scrollTop === top) break; // the end of the list
  }
  return { i: -1, opts };
}

function writeCombo(field, candidates, opts = {}) {
  return oneAtATime(() => writeComboNow(field, candidates, opts));
}

async function writeComboNow(field, candidates, { wait = 2500 } = {}) {
  const el = field.el;
  const doc = el.ownerDocument;
  const typed = el.tagName === "INPUT";
  const pick = field.pick || ((o) => firstMatch(candidates, o));
  // Already showing the answer: leave it closed.
  const current = readField(field);
  if (current && (field.pick ? field.pick([{ label: current }]) === 0 : candidates.some((c) => matchOption(String(c), [{ label: current }], { strict: true }) === 0))) {
    return { ok: true, actual: current, already: true };
  }
  // 1) Nothing else may be open (a list left open is never mistaken for this one's).
  await closeOpenLists(doc);
  const before = new Set(visibleOptions(field).map((o) => o.el));
  openCombo(field);
  ours.set(el, before);
  let opts = await waitForOptions(field, typed ? 600 : wait, before);
  let i = pick(opts);
  // 2) A typeahead: type each candidate until a matching option shows.
  if (i < 0 && typed && !field.pick) {
    for (const c of candidates.slice(0, 3)) {
      setNativeValue(el, String(c), { blur: false });
      opts = await waitForOptions(field, wait, before);
      i = firstMatch([c, ...candidates], opts);
      if (i >= 0) break;
    }
  }
  // 3) A long list that draws only what's in view: scroll for it.
  if (i < 0 && !typed && opts.length) ({ i, opts } = await scrollForMatch(field, pick, before));
  if (i < 0) {
    await closeCombo(field, before);
    return { ok: false, reason: "no_option" };
  }
  const label = opts[i].label;
  opts[i].click.scrollIntoView?.({ block: "nearest" });
  pointerClick(opts[i].click);
  await sleep(80);
  const closed = await closeCombo(field, before);
  const actual = readField(field);
  // The choices it offered: Fix in the panel shows them.
  field.options = opts.map((o) => ({ el: o.el, label: o.label }));
  return { ok: same(actual, label), actual: actual || label, ...(closed ? {} : { left_open: true }) };
}

/** Peek at a dropdown's options without choosing (for the AI's question). */
export function peekOptions(field) {
  if (field.kind !== "combobox") return Promise.resolve((field.options || []).map((o) => o.label));
  return oneAtATime(() => asWriter(null, async () => {
    await closeOpenLists(field.el.ownerDocument);
    const before = new Set(visibleOptions(field).map((o) => o.el));
    openCombo(field);
    ours.set(field.el, before);
    const opts = await waitForOptions(field, 1500, before);
    await closeCombo(field, before);
    return opts.map((o) => o.label).slice(0, 60);
  }));
}

// ---- Search prompts: Workday's multi-select (skills, schools, fields) -----

const CHIP = '[data-automation-id="selectedItem"], ul[data-automation-id="selectedItemList"] > li';

// Workday draws a search prompt again when a chip is added (spec 040): the
// box we held is then gone from the page, typing into it does nothing, and
// every skill after the first was "not added". The box is found again each
// time: by its id, else by its field's own name; never another box.
const SEARCH_INPUT = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])";
const homes = new WeakMap();

/** Remember where a search prompt's box lives (while it's on the page). */
export function homeOf(input) {
  if (!input?.isConnected) return homes.get(input) || null;
  let home = homes.get(input);
  if (!home) {
    const field = input.closest?.('[data-automation-id^="formField-"]');
    home = { doc: input.ownerDocument, id: input.id || "", field: field?.getAttribute("data-automation-id") || "" };
    homes.set(input, home);
  }
  return home;
}

/** The search prompt's box as the page has it now: the same one, or the one drawn in its place. */
export function liveBox(input) {
  if (!input || input.isConnected) return input;
  const home = homes.get(input);
  if (!home) return input;
  let found = home.id ? home.doc.getElementById(home.id) : null;
  if (found && !found.matches?.(SEARCH_INPUT)) found = null;
  if (!found && home.field) {
    const fields = [...home.doc.querySelectorAll("[data-automation-id]")].filter((b) => b.getAttribute("data-automation-id") === home.field);
    const inputs = fields.length === 1 ? [...fields[0].querySelectorAll(SEARCH_INPUT)] : [];
    found = inputs.length === 1 ? inputs[0] : null;
  }
  if (!found) return input;
  homes.set(found, home);
  return found;
}

/** The box holding a search prompt's chosen items ("chips"). */
export function promptBox(input) {
  input = liveBox(input);
  return input.closest(`${PROMPT_BOX}, [data-automation-id^="formField-"]`) || input.parentElement;
}

/** The items chosen in a search prompt, as text. */
export function chipsOf(input) {
  return [...promptBox(input).querySelectorAll(CHIP)].map((c) => textOf(c).trim()).filter(Boolean);
}

/**
 * Add one item to a search prompt: type it, Enter, choose the matching result
 * (Workday also picks a single match by itself), check a chip appeared, close.
 * Never the first result as a guess; a term with no match is cleared and left.
 * A result that is a category (Workday's "Social Media", spec 036) opens its
 * own list: the item is chosen there. "Social Media > LinkedIn" says both:
 * the item is searched first, else the category, then the item in it.
 * `strict` (skills, spec 037): only an entry that IS the term (case, spaces
 * and punctuation aside, or one of `also`, its other names), at every level;
 * the wait ends as soon as the results show without it ("No Items"); a chip
 * Workday adds by itself that isn't the term is taken off again.
 * @returns {Promise<{ok: boolean, already?: boolean, reason?: string, actual?: string}>}
 */
export function searchPick(input, term, { wait = 1500, strict = false, also = [] } = {}) {
  homeOf(input);
  const box = () => liveBox(input);
  return oneAtATime(async () => {
    const doc = input.ownerDocument;
    const path = String(term || "")
      .split(/\s+>\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const want = path[path.length - 1] || "";
    if (!want) return { ok: false, reason: "no_data" };
    if (chipsOf(input).some((c) => norm(c) === norm(want))) return { ok: true, already: true, actual: want };
    await closeOpenLists(doc);
    const count = () => chipsOf(input).length;
    const had = count();
    const chipsBefore = chipsOf(input);
    // Strict: the entry is the term itself (or one of its other names).
    const same = (label, name) => [name, ...also].some((n) => sameSkill(n, label));
    const match = (name, opts) => (strict ? opts.findIndex((o) => same(o.label, name)) : firstMatch([name], opts));
    const field = {
      get el() {
        return box();
      },
    };
    const before = new Set(visibleOptions(field).map((o) => o.el));
    // Typed only into the prompt's own box, found again each time (spec 040).
    const search = (text) => {
      const el = box();
      if (!el.isConnected) return;
      try {
        el.focus?.({ preventScroll: true });
      } catch {
        /* fine */
      }
      pointerClick(el);
      setNativeValue(el, text, { blur: false });
      key(el, "Enter");
      ours.set(el, before);
    };
    // Choose each name in turn, one level of the list at a time (a category,
    // then its item). A match that opens a list instead of becoming a chip is
    // a category: its item is looked for there (at most 3 levels).
    const choose = async (names) => {
      let seen = new Set();
      const fresh = () => visibleOptions(field, before).filter((o) => !seen.has(o.el));
      for (let level = 0; level < 3; level++) {
        const name = names[Math.min(level, names.length - 1)];
        let opts = [];
        let i = -1;
        const end = Date.now() + wait;
        let shownAt = 0;
        while (Date.now() < end && count() === had) {
          opts = fresh();
          i = opts.length ? match(name, opts) : -1;
          if (i >= 0) break;
          // Strict: the results are in and it isn't there (or Workday says
          // "No Items"): stop looking.
          if (strict && noItems(doc)) break;
          if (strict && opts.length) {
            shownAt ||= Date.now();
            if (Date.now() - shownAt > 300) break;
          }
          await sleep(60);
        }
        if (count() > had) return i >= 0 ? opts[i].label : want; // Workday chose a single match itself
        if (i < 0) return "";
        seen = new Set(visibleOptions(field, before).map((o) => o.el));
        const label = opts[i].label;
        pointerClick(opts[i].click);
        const moved = await until(() => count() > had || fresh().length > 0, 800);
        if (count() > had) return label;
        if (!moved) return "";
      }
      return "";
    };
    search(want);
    let picked = await choose([want]);
    if (!picked && count() === had && path.length > 1) {
      // Not found by its own name: its category first, then it.
      await closeOpenLists(doc, 300);
      search(path[0]);
      picked = await choose(path);
    }
    let ok = count() > had;
    // Strict: a chip that isn't the term (Workday chose a lone result by
    // itself: "Microsoft 365 Copilot for Sales" for "Microsoft 365") comes off.
    if (strict && ok) {
      const added = chipsOf(input).filter((c) => !chipsBefore.includes(c));
      const right = added.filter((c) => same(c, want));
      if (right.length < added.length) await removeChips(input, [...chipsBefore, ...right]);
      ok = right.length > 0;
      picked = ok ? right[0] : "";
    }
    // Text left in the box (no match, or a page that keeps it) is cleared.
    if (box().value) setNativeValue(box(), "", { blur: false });
    await closeOpenLists(doc, 300);
    return ok ? { ok: true, actual: picked || want } : { ok: false, reason: "no_option" };
  });
}

/** Workday's "No Items" (or a site's "No results") in an open result list. */
function noItems(doc) {
  return openPopups(doc).some((p) => /\bno (items|results|matches)\b/i.test(p.textContent || ""));
}

/** Remove chips that weren't there before (Undo for a search prompt). */
export async function removeChips(input, keep) {
  const keepSet = new Set((keep || []).map(norm));
  for (const chip of [...promptBox(input).querySelectorAll(CHIP)]) {
    if (keepSet.has(norm(textOf(chip)))) continue;
    const x = chip.querySelector('[data-automation-id="DELETE_charm"], [aria-label*="remove" i], [aria-label*="delete" i]');
    if (x) pointerClick(x);
    else chip.remove();
    await sleep(40);
  }
  return true;
}

// ---- Files ----------------------------------------------------------------
// A file counts as attached when the page shows it took it (spec 037): the
// box holds it on a plain page, or the upload card lists one more file or
// its name. Workday takes the file from its box, EMPTIES the box and lists the
// file a few seconds later: an emptied box is never a failure. When nothing
// says either way it's "unverified", and never attached again.

/** How long an upload card gets to list a file (tests shorten it). */
export const FILE_WAITS = { listMs: 8000, stepMs: 200 };

async function writeFile(field, files) {
  const file = files.find((f) => f instanceof File);
  if (!file || !win(field.el).DataTransfer) return { ok: false, reason: "no_data" };
  // What the card shows BEFORE: a returning applicant's old résumé there is
  // never taken for ours (spec 029).
  const before = cardState(field, file);
  const el = field.el;
  try {
    const dt = new (win(el).DataTransfer)();
    // A plain box that takes several files keeps what it holds (the résumé,
    // then the cover letter in a box for both, spec 037).
    if (el.multiple && !before.card) for (const f of el.files || []) if (f.name !== file.name) dt.items.add(f);
    dt.items.add(file);
    el.files = dt.files;
    fire(el, "Event", "input");
    fire(el, "Event", "change");
  } catch {
    return { ok: false, reason: "rejected" };
  }
  const holds = () => el.isConnected && [...(el.files || [])].some((f) => f.name === file.name);
  const took = () => tookFile(field, file, before);
  // A plain box (no upload card) that holds it: taken.
  if (!before.card && holds()) return { ok: true, actual: file.name };
  if (await waitFor(took, FILE_WAITS.listMs)) return { ok: true, actual: file.name };
  // Workday's React drop zone that ignored the box (the box still holds it,
  // nothing listed): one drop, the way a person dragging it would.
  if (holds() && dropOn(field, file) && (await waitFor(took, FILE_WAITS.listMs))) return { ok: true, actual: file.name };
  // Maybe up, maybe not: never "failed", never tried again.
  return { ok: false, reason: "unverified", actual: file.name };
}

async function waitFor(test, ms) {
  for (let waited = 0; ; waited += FILE_WAITS.stepMs) {
    if (test()) return true;
    if (waited >= ms) return false;
    await sleep(FILE_WAITS.stepMs);
  }
}

/** Did the page take the file: the card re-drawn (the site reacted), one
 * more file than before, or OUR file's name newly shown. A file that was
 * already there never counts. */
function tookFile(field, file, before) {
  if (before.card && (!before.card.isConnected || (field.zone && !field.zone.isConnected))) return true;
  const now = cardState(field, file);
  return now.count > before.count || now.named > before.named || (now.onPage && !before.onPage);
}

/** The upload card a file box sits in: Workday's around its drop zone, else
 * an ancestor named like one; null for a plain box. */
function cardOf(field) {
  if (field.zone) return uploadCard(field.zone);
  for (let n = field.el?.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
    if (/attachments|fileupload/i.test(n.getAttribute?.("data-automation-id") || "")) return n;
  }
  return null;
}

const uploadedItems = (card) => [...(card?.querySelectorAll?.("[data-automation-id]") || [])].filter((n) => UPLOADED.test(n.getAttribute("data-automation-id")));

/** A file's name as a list shows it: case, spaces, Workday's "Successfully
 * Uploaded!", its size and its Delete button don't count. */
const fileName = (t) =>
  String(t ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/successfully uploaded!?|\b(delete|remove)\b/g, " ")
    .replace(/\(?\s*\d+(\.\d+)?\s*(bytes|[kmg]?b)\s*\)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The part of the page that lists this box's files: Workday's card, else
 * the box's surroundings that hold it alone. */
function listOf(field) {
  const card = cardOf(field);
  if (card) return card;
  let node = field.el?.parentElement;
  for (let i = 0; node?.parentElement && i < 3 && node.parentElement.querySelectorAll("input[type=file]").length === 1; i++) node = node.parentElement;
  return node || null;
}

/** How many entries of a list show exactly this file name (never a part of
 * one: "CV.pdf" is not "Old CV.pdf"). */
function listedTimes(list, name) {
  const want = fileName(name);
  if (!list || !want) return 0;
  const items = uploadedItems(list);
  const entries = items.length ? items : [list];
  let n = 0;
  for (const item of entries) {
    if ([item, ...item.querySelectorAll("*")].some((el) => fileName(el.textContent) === want)) n++;
  }
  return n;
}

/**
 * Does this box's list show a file of exactly this name (spec 037)? Workday's
 * card lists it; another site shows its name by the box. The whole name,
 * never a part of one. `loose` (only for a file Job Catcher itself put
 * there): its name anywhere in the list ("Uploaded: resume.pdf"), or
 * shortened ("Sam_Rivera_Nor….pdf").
 */
export function fileListed(field, name, { loose = false } = {}) {
  const list = listOf(field);
  if (listedTimes(list, name) > 0) return true;
  if (!loose || !list) return false;
  const want = fileName(name);
  if (!want) return false;
  if (fileName(list.textContent).includes(want)) return true;
  return [list, ...list.querySelectorAll("*")].some((el) => {
    const [head, tail, ...more] = fileName(el.textContent).split(/…|\.\.\.(?=\S)/);
    return !more.length && tail !== undefined && head.length >= 4 && want.startsWith(head) && want.endsWith(tail);
  });
}

/** The upload card's files as shown: how many, how many with our file's
 * name, and whether its name is on the page. */
function cardState(field, file) {
  const card = cardOf(field);
  return {
    card,
    count: uploadedItems(card).length,
    named: listedTimes(card, file.name),
    onPage: (field.el.ownerDocument?.body?.textContent || "").includes(file.name),
  };
}

// Workday's own drop zone (spec 029).
const WORKDAY_DROP = /file-upload-drop-zone/i;
// A file shown as uploaded in Workday's card.
const UPLOADED = /file-upload-successful|file-upload-item|delete-file/i;

/** The upload card around a drop zone (Workday's "attachments-FileUpload"),
 * else the zone's parent. */
function uploadCard(zone) {
  for (let n = zone.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
    if (/attachments|fileupload/i.test(n.getAttribute?.("data-automation-id") || "")) return n;
  }
  return zone.parentElement || zone;
}

/**
 * Drop the file on Workday's zone, the way a person dragging it would: only
 * on Workday's own zone, only once per write. True when dropped.
 */
function dropOn(field, file) {
  const zone = field.zone;
  if (!zone?.isConnected || !WORKDAY_DROP.test(zone.getAttribute?.("data-automation-id") || "")) return false;
  const W = win(zone);
  const dt = new W.DataTransfer();
  dt.items.add(file);
  for (const type of ["dragenter", "dragover", "drop"]) {
    let ev;
    try {
      ev = new W.DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt });
    } catch {
      ev = new W.Event(type, { bubbles: true, cancelable: true, composed: true });
    }
    // Some engines leave dataTransfer empty on a made-up drag event.
    if (!ev.dataTransfer) Object.defineProperty(ev, "dataTransfer", { value: dt });
    zone.dispatchEvent(ev);
  }
  return true;
}

// ---- Reading, snapshot, restore ------------------------------------------

/** What the page shows in a field right now ("" when empty). */
export function readField(field) {
  const el = field.el;
  switch (field.kind) {
    case "text":
    case "textarea":
    case "date":
    case "month":
      return el.value || "";
    case "spin":
      return el.value || "";
    case "chips":
      return chipsOf(el).join(", ");
    case "editable":
      return (el.textContent || "").trim();
    case "select": {
      const o = el.options[el.selectedIndex];
      const label = o ? o.textContent.trim() : "";
      return isPlaceholderOption(label) && !o?.value ? "" : label;
    }
    case "radio":
    case "buttons":
    case "checkbox_list": {
      const on = (field.options || []).filter((o) => (o.el.tagName === "INPUT" ? o.el.checked : pressed(o.el)));
      return on.map((o) => o.label).join(", ");
    }
    case "checkbox":
      return el.checked ? "Yes" : "";
    case "file":
      return el.files?.[0]?.name || "";
    case "combobox": {
      if (el.tagName !== "INPUT") {
        const t = textOf(el);
        return isPlaceholderOption(t) ? "" : t;
      }
      // react-select & co keep the choice in a "single value" element next to
      // the input, which holds only what's being typed. Never the whole box's
      // text (it can hold the label or other fields).
      const box = comboBox(el);
      const chosen = box === el ? null : box.querySelector('[class*="single-value"], [class*="singleValue"], [class*="selected-value"]');
      const shown = chosen ? textOf(chosen) : "";
      return (shown && !isPlaceholderOption(shown) ? shown : "") || el.value || "";
    }
    default:
      return "";
  }
}

/** Does the field already hold something (the user's or the page's)? */
export function hasValue(field) {
  const v = readField(field).trim();
  // A phone box that holds only its country code ("+1") is still empty.
  return v !== "" && !(field.hints?.dialCode && /^\+\s?\d{1,4}$/.test(v));
}

export function snapshot(field) {
  const el = field.el;
  switch (field.kind) {
    case "radio":
    case "checkbox_list":
    case "checkbox":
      return { checked: (field.options || [{ el }]).map((o) => o.el.checked) };
    case "buttons":
      return { pressed: (field.options || []).map((o) => pressed(o.el)) };
    case "select":
      return { index: el.selectedIndex };
    case "file":
      return { files: el.files ? [...el.files] : [] };
    case "combobox":
      return { shown: readField(field) };
    case "chips":
      return { chips: chipsOf(el) };
    default:
      return { value: field.kind === "editable" ? el.textContent : el.value };
  }
}

/** Can Undo put this field back exactly? (A radio can't be un-chosen in a
 *  way a framework notices; only a previous choice can be re-chosen.) */
export function canRestore(field, snap) {
  if (field.kind === "combobox") return !snap.shown || !!clearControl(field);
  if (field.kind === "buttons") return snap.pressed.some(Boolean);
  if (field.kind === "radio") return snap.checked.some(Boolean);
  return true;
}

function clearControl(field) {
  const box = comboBox(field.el);
  return box.querySelector?.('[aria-label*="clear" i], [aria-label*="remove" i], [class*="clear-indicator"], [class*="ClearIndicator"]');
}

export function restore(field, snap) {
  return asWriter(field, () => restoreNow(field, snap));
}

async function restoreNow(field, snap) {
  const el = field.el;
  switch (field.kind) {
    case "radio": {
      const i = snap.checked.findIndex(Boolean);
      if (i < 0) return false;
      clickChoice(field.options[i].el);
      return true;
    }
    case "checkbox_list":
    case "checkbox": {
      (field.options || [{ el }]).forEach((o, i) => {
        if (o.el.checked !== snap.checked[i]) clickChoice(o.el);
      });
      return true;
    }
    case "buttons": {
      const i = snap.pressed.findIndex(Boolean);
      if (i < 0) return false;
      pointerClick(field.options[i].el);
      return true;
    }
    case "select": {
      el.selectedIndex = snap.index;
      fire(el, "Event", "change");
      return true;
    }
    case "file": {
      if (!win(field.el).DataTransfer) return false;
      const dt = new (win(el).DataTransfer)();
      for (const f of snap.files) dt.items.add(f);
      el.files = dt.files;
      fire(el, "Event", "change");
      return true;
    }
    case "combobox": {
      if (!snap.shown) {
        const clear = clearControl(field);
        if (!clear) return false;
        pointerClick(clear);
        return true;
      }
      return (await writeCombo(field, [snap.shown], { wait: 1500 })).ok;
    }
    case "chips":
      return removeChips(el, snap.chips);
    case "editable":
      el.textContent = snap.value || "";
      fire(el, "InputEvent", "input");
      return true;
    default:
      setNativeValue(el, snap.value || "");
      return true;
  }
}

/**
 * Write the first candidate value that fits this field.
 * @param {import("./scan.js").Field} field
 * @param {Array<string|File>} candidates
 * @returns {Promise<{ok: boolean, actual?: string, reason?: string}>}
 */
export function writeField(field, candidates) {
  return asWriter(field, () => writeFieldNow(field, candidates));
}

async function writeFieldNow(field, candidates) {
  if (!candidates?.length) return { ok: false, reason: "no_data" };
  try {
    switch (field.kind) {
      case "text":
      case "textarea":
      case "editable":
        return writeText(field, candidates);
      case "date":
      case "month":
        return writeDate(field, candidates);
      case "select":
        return writeSelect(field, candidates);
      case "radio":
      case "buttons":
      case "checkbox_list":
      case "checkbox":
        return writeChoice(field, candidates);
      case "combobox":
        return await writeCombo(field, candidates);
      case "spin":
        return writeSpin(field, candidates);
      case "chips":
        return await writeChips(field, candidates);
      case "file":
        return await writeFile(field, candidates);
      default:
        return { ok: false, reason: "no_data" };
    }
  } catch (e) {
    return { ok: false, reason: "rejected", error: String(e?.message || e) };
  }
}
