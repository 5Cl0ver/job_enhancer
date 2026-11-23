// Scan: every field on the page a person would fill, with the question it asks.
// DOM only (no chrome.* except the optional closed-shadow-root getter), so it
// runs under happy-dom in test/fill-engine.spec.js.
//
// Reaches into components that hide their insides (shadow DOM, open and — in
// the extension — closed). Frames are NOT walked: each frame runs its own copy
// of the script, and one press fills them all.
import { normalizeQuestion } from "./classify/answers.js";

/** A shadow root, including closed ones where the extension API allows. */
export function shadowOf(el) {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) || null;
  } catch {
    return null;
  }
}

/** Every element under `root`, in page order, descending into shadow roots. */
export function allElements(root, getShadow = shadowOf, out = []) {
  for (const el of root.querySelectorAll("*")) {
    out.push(el);
    const sr = getShadow(el);
    if (sr) allElements(sr, getShadow, out);
  }
  return out;
}

const clean = (s) =>
  String(s || "")
    .replace(/[ \s]+/g, " ")
    .replace(/\s*[*✱]\s*/g, " ")
    .replace(/\((required|optional)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const CONTROL = "input, select, textarea, button, [role=combobox], [role=radio], [role=checkbox], [contenteditable=''], [contenteditable=true]";

/** The visible text of a node, leaving out controls (a select's options...). */
export function textOf(node, max = 400) {
  let out = "";
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (out.length > max) return; // a label is short: stop reading pages
      if (c.nodeType === 3) out += c.nodeValue + " ";
      else if (c.nodeType === 1) {
        const tag = c.tagName;
        if (/^(SCRIPT|STYLE|SELECT|OPTION|TEXTAREA|INPUT|SVG|TEMPLATE)$/.test(tag)) continue;
        if (c.getAttribute?.("aria-hidden") === "true") continue;
        walk(c);
      }
    }
  };
  walk(node);
  return clean(out);
}

function byIds(root, ids) {
  return clean(
    String(ids || "")
      .split(/\s+/)
      .map((id) => (id && (root.getElementById?.(id) || root.ownerDocument?.getElementById?.(id))) || null)
      .filter(Boolean)
      .map(textOf)
      .join(" "),
  );
}

const esc = (s) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : String(s).replace(/"/g, '\\"'));

/**
 * The question a control asks, as a person reads it: its label, aria label,
 * fieldset legend, the nearest text above it, then its placeholder.
 */
export function questionFor(el) {
  const root = el.getRootNode?.() || el.ownerDocument;
  if (el.id) {
    const label = root.querySelector?.(`label[for="${esc(el.id)}"]`);
    const t = label && textOf(label);
    if (t) return t;
  }
  const wrap = el.closest?.("label");
  if (wrap) {
    const t = textOf(wrap);
    if (t) return t;
  }
  const lb = el.getAttribute?.("aria-labelledby");
  if (lb) {
    const t = byIds(root, lb);
    if (t) return t;
  }
  const al = clean(el.getAttribute?.("aria-label"));
  if (al && !/^(select|choose|open|toggle|clear)\b/i.test(al)) return al;
  // Text right beside the control wins; text found further up (a page heading)
  // only when the control has no placeholder of its own.
  const placeholder = clean(el.getAttribute?.("placeholder"));
  const near = nearbyText(el, 4, true);
  if (near.text && (near.depth <= 1 || !placeholder)) return near.text;
  return placeholder || near.text || clean(el.getAttribute?.("title"));
}

/** The closest text above a control: a sibling heading/div before it. */
export function nearbyText(el, maxDepth = 4, withDepth = false) {
  const out = (text, depth) => (withDepth ? { text, depth } : text);
  let node = el;
  for (let depth = 0; node && depth < maxDepth; depth++, node = node.parentElement) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches?.(CONTROL) || sib.querySelector?.(CONTROL)) return out("", depth);
      const t = textOf(sib);
      if (t) return out(t.length <= 300 ? t : "", depth);
    }
    const legend = node.tagName === "FIELDSET" && node.querySelector(":scope > legend");
    if (legend) return out(textOf(legend), depth);
  }
  return out("", maxDepth);
}

/** The question for a group of choices (radios, checkboxes, buttons). */
function groupQuestion(members, optionLabels) {
  const first = members[0];
  const legend = first.closest?.("fieldset")?.querySelector?.("legend");
  if (legend && textOf(legend)) return textOf(legend);
  const group = first.closest?.("[role=radiogroup], [role=group]");
  if (group) {
    const root = group.getRootNode?.() || group.ownerDocument;
    const t = clean(group.getAttribute("aria-label")) || byIds(root, group.getAttribute("aria-labelledby"));
    if (t) return t;
  }
  // The smallest box around every option, then upward: its own text minus the
  // option labels, or the text just above it.
  let box = first.parentElement;
  while (box && !members.every((m) => box.contains(m))) box = box.parentElement;
  for (let hop = 0; box && hop < 4; hop++, box = box.parentElement) {
    const above = nearbyText(box, 1);
    if (above) return above;
    let t = textOf(box);
    for (const l of optionLabels) if (l) t = t.split(l).join(" ");
    t = clean(t);
    if (t.length >= 4 && t.length <= 300) return t;
  }
  return "";
}

function isVisible(el) {
  if (el.hidden || el.closest?.("[hidden], [aria-hidden=true], [inert]")) return false;
  const view = el.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(el);
  if (style && (style.visibility === "hidden" || style.display === "none")) return false;
  const rects = el.getClientRects?.();
  return !rects || rects.length > 0;
}

/** Radios and checkboxes are often drawn by a label while the input is hidden. */
function choiceVisible(el, visible) {
  if (visible(el)) return true;
  const label = el.closest("label") || (el.id && el.getRootNode().querySelector?.(`label[for="${esc(el.id)}"]`));
  return !!label && visible(label);
}

let nextId = 1;
const ids = new WeakMap();
/** A stable id per control, kept across scans (so Fix/Undo find it again). */
export function fieldId(el) {
  if (!ids.has(el)) ids.set(el, `f${nextId++}`);
  return ids.get(el);
}

function labelForOption(el) {
  return textOf(el.closest?.("label") || el) || questionFor(el) || clean(el.value);
}

/**
 * @typedef {object} Field
 * @property {string} id
 * @property {"text"|"textarea"|"editable"|"select"|"combobox"|"radio"|"checkbox"|"checkbox_list"|"buttons"|"date"|"month"|"file"} kind
 * @property {Element} el         the control (for groups: the first option)
 * @property {Array<{el: Element, label: string, value?: string}>} [options]
 * @property {string} question
 * @property {string} key         normalizeQuestion(question)
 * @property {object} hints       autocomplete, type, name, id, placeholder, accept, maxLength
 * @property {Element} mark       what to outline
 */

/**
 * Every fillable field, in page order.
 * @param {Document|ShadowRoot} root
 * @param {{getShadow?: Function, visible?: (el: Element) => boolean}} [opts]
 * @returns {Field[]}
 */
export function collectFields(root, opts = {}) {
  const getShadow = opts.getShadow || shadowOf;
  const visible = opts.visible || isVisible;
  const els = allElements(root, getShadow);
  const fields = [];
  const groups = new Map(); // radio/checkbox name (per root) -> members
  const buttonSets = new Map(); // parent -> pressable buttons
  const add = (f) => {
    f.key = normalizeQuestion(f.question);
    fields.push(f);
  };
  const hintsOf = (el) => ({
    autocomplete: el.getAttribute?.("autocomplete") || "",
    type: (el.getAttribute?.("type") || "").toLowerCase(),
    name: el.getAttribute?.("name") || "",
    id: el.id || "",
    placeholder: el.getAttribute?.("placeholder") || "",
    accept: el.getAttribute?.("accept") || "",
    maxLength: Number(el.getAttribute?.("maxlength")) || 0,
  });

  for (const el of els) {
    const tag = el.tagName;
    if (el.disabled || el.getAttribute?.("aria-disabled") === "true") continue;

    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"].includes(type)) continue;
      if (type === "radio" || type === "checkbox") {
        if (!choiceVisible(el, visible)) continue;
        const name = el.getAttribute("name") || "";
        const key = `${type}|${name || fieldId(el)}`;
        if (!groups.has(key)) groups.set(key, { type, members: [], root: el.getRootNode() });
        groups.get(key).members.push(el);
        continue;
      }
      if (type === "file") {
        // Often hidden behind a drop zone: count it when it or its zone shows.
        const zone = el.closest("label, [class*=drop], [class*=upload], [class*=Drop], [class*=Upload]");
        if (!visible(el) && !(zone && visible(zone))) continue;
        add({ id: fieldId(el), kind: "file", el, mark: zone || el, question: questionFor(el), hints: hintsOf(el) });
        continue;
      }
      if (!visible(el) || el.readOnly) continue;
      const combo = el.getAttribute("role") === "combobox" || /^(list|both)$/.test(el.getAttribute("aria-autocomplete") || "");
      const kind = combo ? "combobox" : type === "date" ? "date" : type === "month" ? "month" : "text";
      add({ id: fieldId(el), kind, el, mark: kind === "combobox" ? comboBox(el) : el, question: questionFor(el), hints: hintsOf(el) });
      continue;
    }
    if (tag === "TEXTAREA") {
      if (!visible(el) || el.readOnly) continue;
      add({ id: fieldId(el), kind: "textarea", el, mark: el, question: questionFor(el), hints: hintsOf(el) });
      continue;
    }
    if (tag === "SELECT") {
      if (!visible(el)) continue;
      const options = [...el.options].map((o) => ({ el: o, label: clean(o.textContent), value: o.value }));
      add({ id: fieldId(el), kind: "select", el, mark: el, options, question: questionFor(el), hints: hintsOf(el) });
      continue;
    }
    // A dropdown drawn as a button (Workday, many design systems).
    if (
      (tag === "BUTTON" && el.getAttribute("aria-haspopup") === "listbox") ||
      (el.getAttribute?.("role") === "combobox" && tag !== "INPUT" && !el.querySelector("input"))
    ) {
      if (!visible(el)) continue;
      add({
        id: fieldId(el),
        kind: "combobox",
        el,
        mark: el,
        question: comboQuestion(el),
        hints: hintsOf(el),
      });
      continue;
    }
    if (el.isContentEditable && el.getAttribute?.("contenteditable") != null && !el.parentElement?.closest("[contenteditable]")) {
      if (!visible(el)) continue;
      add({ id: fieldId(el), kind: "editable", el, mark: el, question: questionFor(el), hints: hintsOf(el) });
      continue;
    }
    // Yes/No drawn as pressable buttons (Ashby and friends).
    if (tag === "BUTTON" && (el.hasAttribute("aria-pressed") || el.getAttribute("role") === "radio") && visible(el)) {
      const set = el.closest("[role=radiogroup], [role=group]") || el.parentElement;
      if (!buttonSets.has(set)) buttonSets.set(set, []);
      buttonSets.get(set).push(el);
    }
  }

  for (const { type, members } of groups.values()) {
    const options = members.map((el) => ({ el, label: labelForOption(el), value: el.value }));
    if (type === "checkbox" && members.length === 1) {
      const el = members[0];
      add({ id: fieldId(el), kind: "checkbox", el, mark: el.closest("label") || el, options, question: questionFor(el) || options[0].label, hints: hintsOf(el) });
      continue;
    }
    const kind = type === "radio" ? "radio" : "checkbox_list";
    const question = groupQuestion(members, options.map((o) => o.label));
    let box = members[0].parentElement;
    while (box && !members.every((m) => box.contains(m))) box = box.parentElement;
    add({ id: fieldId(members[0]), kind, el: members[0], mark: box || members[0], options, question, hints: hintsOf(members[0]) });
  }

  for (const [set, buttons] of buttonSets) {
    if (buttons.length < 2) continue;
    const options = buttons.map((el) => ({ el, label: textOf(el) }));
    add({ id: fieldId(buttons[0]), kind: "buttons", el: buttons[0], mark: set, options, question: groupQuestion(buttons, options.map((o) => o.label)), hints: {} });
  }

  // Page order (groups were added last).
  const order = new Map(els.map((el, i) => [el, i]));
  return fields.sort((a, b) => (order.get(a.el) ?? 0) - (order.get(b.el) ?? 0));
}

/** The visible box of an input combobox: a known control wrapper, or its
 *  parent when that holds nothing else (never a whole form or its label). */
export function comboBox(el) {
  const known = el.closest?.(
    "[class*=select__control], [class*=-control], [class*=Select-control], [class*=combobox], [data-automation-id^=formField]",
  );
  if (known) return known;
  const p = el.parentElement;
  if (p && !p.querySelector("label") && p.querySelectorAll("input, select, textarea, button").length <= 2) return p;
  return el;
}

function comboQuestion(el) {
  // Workday: the field's legend / label sits on the formField wrapper.
  const field = el.closest?.("[data-automation-id^=formField], fieldset");
  const legend = field?.querySelector?.("legend, label");
  return (legend && textOf(legend)) || questionFor(el);
}

/** Does this page look like a job application (not a sign-in, a search, or a
 *  page that merely has an upload box)? Two fields the profile answers, at
 *  least one of them about the person (or a résumé upload), and no password. */
export function looksLikeApplication(fields, { isIdentity, isMapped }) {
  const root = fields[0]?.el?.ownerDocument;
  const password = root?.querySelector?.('input[type="password"]');
  if (password && isVisible(password)) return false;
  const mapped = fields.filter(isMapped);
  return mapped.length >= 2 && mapped.some(isIdentity);
}
