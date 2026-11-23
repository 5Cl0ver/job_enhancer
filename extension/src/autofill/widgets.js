// Write a value into a field the way a person would, so the page's own code
// (React, Vue, Workday...) registers it — then READ IT BACK. A field counts as
// filled only when the page holds the value (spec 015, FR-003).
//
// Each kind has: write(field, candidates) → {ok, actual, reason?},
// read(field), snapshot(field), restore(field, snap) (for Undo).
// DOM only; happy-dom covers the simple kinds (test/fill-engine.spec.js), the
// browser lab covers the rest (e2e/autofill-*.spec.js).
import { isPlaceholderOption, matchOption } from "./classify/answers.js";
import { comboBox, textOf } from "./scan.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+@.]+/g, " ")
    .trim();

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
  return { ok: same(actual, value) || (field.hints?.maxLength && !!actual), actual };
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
    // "LinkedIn, Referral" → tick each; leave others as they are.
    const want = candidates[0].split(/\s*[,;]\s*/).filter(Boolean);
    const picks = want.map((w) => matchOption(w, options)).filter((i) => i >= 0);
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

/** The options a dropdown is showing right now (minus `before`: options
 *  that were already open elsewhere on the page before we opened this one). */
export function visibleOptions(field, before = null) {
  const el = field.el;
  const root = el.getRootNode?.() || el.ownerDocument;
  const doc = el.ownerDocument;
  const owned = [el.getAttribute("aria-controls"), el.getAttribute("aria-owns")]
    .flatMap((v) => String(v || "").split(/\s+/))
    .filter(Boolean)
    .map((id) => root.getElementById?.(id) || doc.getElementById(id))
    .filter(Boolean);
  const scopes = owned.length ? owned : [root, ...(root !== doc ? [doc] : [])];
  const seen = new Set();
  const out = [];
  for (const scope of scopes) {
    for (const o of scope.querySelectorAll('[role="option"], [data-automation-id="promptOption"]')) {
      if (seen.has(o) || o.getAttribute("aria-disabled") === "true") continue;
      if (before?.has(o) && !owned.length) continue;
      const rects = o.getClientRects?.();
      if (rects && rects.length === 0) continue; // a closed menu's options
      seen.add(o);
      const label = (o.getAttribute("data-automation-label") || textOf(o)).trim();
      if (label && !isPlaceholderOption(label)) out.push({ el: o, label });
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

function closeCombo(field) {
  key(field.el, "Escape");
  if (field.el.tagName === "INPUT" && field.el.value) setNativeValue(field.el, "", { blur: false });
}

async function writeCombo(field, candidates, { wait = 2500 } = {}) {
  const el = field.el;
  const typed = el.tagName === "INPUT";
  // Another dropdown's menu left open must never be mistaken for this one's.
  const before = new Set(visibleOptions(field).map((o) => o.el));
  // 1) Open it and look at what it offers.
  openCombo(field);
  let opts = await waitForOptions(field, typed ? 600 : wait, before);
  let i = firstMatch(candidates, opts);
  // 2) A typeahead: type each candidate until a matching option shows.
  if (i < 0 && typed) {
    for (const c of candidates.slice(0, 3)) {
      setNativeValue(el, String(c), { blur: false });
      opts = await waitForOptions(field, wait, before);
      i = firstMatch([c, ...candidates], opts);
      if (i >= 0) break;
    }
  }
  if (i < 0) {
    closeCombo(field);
    return { ok: false, reason: "no_option" };
  }
  const label = opts[i].label;
  opts[i].el.scrollIntoView?.({ block: "nearest" });
  pointerClick(opts[i].el);
  await sleep(80);
  const actual = readField(field);
  // The choices it offered: Fix in the panel shows them.
  field.options = opts.map((o) => ({ el: o.el, label: o.label }));
  return { ok: same(actual, label), actual: actual || label };
}

/** Peek at a dropdown's options without choosing (for the AI's question). */
export async function peekOptions(field) {
  if (field.kind !== "combobox") return (field.options || []).map((o) => o.label);
  const before = new Set(visibleOptions(field).map((o) => o.el));
  openCombo(field);
  const opts = await waitForOptions(field, 1500, before);
  closeCombo(field);
  await sleep(120);
  // Still open (it ignores Escape)? Toggle it shut — only then.
  if (field.el.tagName !== "INPUT" && visibleOptions(field, before).length) pointerClick(field.el);
  return opts.map((o) => o.label).slice(0, 60);
}

// ---- Files ----------------------------------------------------------------

function writeFile(field, [file]) {
  if (!(file instanceof File) || !win(field.el).DataTransfer) return { ok: false, reason: "no_data" };
  try {
    const dt = new (win(field.el).DataTransfer)();
    dt.items.add(file);
    field.el.files = dt.files;
    fire(field.el, "Event", "input");
    fire(field.el, "Event", "change");
  } catch {
    return { ok: false, reason: "rejected" };
  }
  const ok = field.el.files?.length === 1 && field.el.files[0].name === file.name;
  return { ok, actual: file.name };
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
  return readField(field).trim() !== "";
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

export async function restore(field, snap) {
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
export async function writeField(field, candidates) {
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
      case "file":
        return writeFile(field, candidates);
      default:
        return { ok: false, reason: "no_data" };
    }
  } catch (e) {
    return { ok: false, reason: "rejected", error: String(e?.message || e) };
  }
}
