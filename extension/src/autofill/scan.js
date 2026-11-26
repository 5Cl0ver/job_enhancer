// Scan: every field on the page a person would fill, with the question it asks.
// DOM only (no chrome.* except the optional closed-shadow-root getter), so it
// runs under happy-dom in test/fill-engine.spec.js.
//
// Reaches into components that hide their insides (shadow DOM, open and — in
// the extension — closed). Frames are NOT walked: each frame runs its own copy
// of the script, and one press fills them all.
import { normalizeQuestion } from "./classify/answers.js";
import { CONSENT } from "./classify/profileKeys.js";
import { applicantHost, isApplyUrl } from "./hosts.js";
import { isOnScreen } from "./visible.js";
import { uploadKind } from "./resolve.js";

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

// What holds a control's VALUE, never its question: a dropdown's shown
// choice (react-select's single-value, a combobox / listbox / textbox),
// something typed into (contenteditable), a button's caption.
const VALUE_HOLDER = /single-?value|singleValue|__value-container/;
function holdsValue(el) {
  const role = el.getAttribute?.("role") || "";
  if (/^(combobox|listbox|textbox|option)$/.test(role) || el.tagName === "BUTTON") return true;
  if (el.hasAttribute?.("contenteditable") && el.getAttribute("contenteditable") !== "false") return true;
  return VALUE_HOLDER.test(el.getAttribute?.("class") || "");
}

/** The visible text of a node, leaving out controls and the values they
 *  hold (a select's options, a dropdown's chosen answer, typed text...). */
export function textOf(node, max = 1500) {
  let out = "";
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (out.length > max) return; // a label is short: stop reading pages
      if (c.nodeType === 3) out += c.nodeValue + " ";
      else if (c.nodeType === 1) {
        const tag = c.tagName;
        if (/^(SCRIPT|STYLE|SELECT|OPTION|TEXTAREA|INPUT|SVG|TEMPLATE)$/.test(tag)) continue;
        if (c.getAttribute?.("aria-hidden") === "true") continue;
        if (holdsValue(c)) continue;
        walk(c);
      }
    }
  };
  walk(node);
  return clean(out);
}

/** The text of the elements `ids` name — leaving out the control itself and
 *  what shows its value (MUI's Select names its own chosen-value element). */
function byIds(root, ids, self = null) {
  return clean(
    String(ids || "")
      .split(/\s+/)
      .map((id) => (id && (root.getElementById?.(id) || root.ownerDocument?.getElementById?.(id))) || null)
      .filter((n) => n && n !== self && !n.contains?.(self) && !self?.contains?.(n) && !holdsValue(n))
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
    const t = byIds(root, lb, el);
    if (t) return t;
  }
  const al = clean(el.getAttribute?.("aria-label"));
  if (al && !/^(select|choose|open|toggle|clear)\b/i.test(al)) return al;
  // A floating label drawn right after its box: "<div><input><label>Email</label></div>"
  // (the box first in its wrapper, so a flat "label, input, label, input" list
  // never hands a box the NEXT field's label; an error or hint line never counts).
  const after = el.nextElementSibling;
  const cls = after?.getAttribute?.("class") || "";
  if (
    (after?.tagName === "LABEL" || /(^|[\s_-])(floating-?)?label\b/i.test(cls)) &&
    !/error|invalid|hint|help|count|message|feedback/i.test(cls) &&
    after?.getAttribute?.("role") !== "alert" &&
    !el.previousElementSibling &&
    (!after.htmlFor || after.htmlFor === el.id) &&
    !after.querySelector(CONTROL) &&
    !["radio", "checkbox"].includes(el.type)
  ) {
    const t = textOf(after);
    if (t) return t;
  }
  // Text right beside the control wins; text found further up (a page heading)
  // only when the control has no placeholder of its own.
  const placeholder = clean(el.getAttribute?.("placeholder"));
  const near = nearbyText(el, 4, true);
  if (!/[\p{L}\p{N}]/u.test(near.text)) near.text = ""; // ":" or "*" alone is no label
  if (near.text && (near.depth <= 1 || !placeholder)) return near.text;
  return placeholder || near.text || clean(el.getAttribute?.("title"));
}

/**
 * The title of the box's OWN group (spec 020 review): its fieldset's legend, a
 * role=group/region's name (Workday's panels), or the nearest heading inside
 * the same form before it — never a heading outside the form (a job
 * description's "Preferred Qualifications" above an application).
 */
export function groupTitle(el) {
  const root = el.getRootNode?.() || el.ownerDocument;
  for (let n = el.parentElement; n; n = n.parentElement) {
    if (n.tagName === "FIELDSET") {
      const legend = [...n.children].find((c) => c.tagName === "LEGEND");
      if (legend && clean(legend.textContent)) return clean(legend.textContent).slice(0, 120);
    }
    const role = n.getAttribute?.("role");
    if (role === "group" || role === "region") {
      const named = clean(n.getAttribute("aria-label")) || (n.getAttribute("aria-labelledby") ? byIds(root, n.getAttribute("aria-labelledby"), el) : "");
      if (named) return named.slice(0, 120);
    }
    if (n.tagName === "FORM") break;
  }
  const form = el.closest?.("form");
  if (!form) return "";
  const before = [...form.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")].filter(
    (h) => h.compareDocumentPosition(el) & 4, // the box comes after the heading
  );
  return before.length ? clean(before[before.length - 1].textContent).slice(0, 120) : "";
}

/**
 * Does the control have a name of its own — a label, aria name, placeholder,
 * or text right beside it — rather than a page heading further up? Only such
 * a question is learned for every site (spec 020): "Quick apply" over an
 * unlabelled box is no question.
 */
export function hasOwnQuestion(el) {
  const root = el.getRootNode?.() || el.ownerDocument;
  if (el.id && root.querySelector?.(`label[for="${esc(el.id)}"]`)) return true;
  if (el.closest?.("label") || el.getAttribute?.("aria-labelledby") || clean(el.getAttribute?.("aria-label"))) return true;
  if (clean(el.getAttribute?.("placeholder"))) return true;
  const near = nearbyText(el, 4, true);
  if (!near.text || !/[\p{L}\p{N}]/u.test(near.text) || near.depth > 1) return false;
  // A page or section heading, or the page's own title, isn't the box's question.
  const text = clean(near.text);
  if (text === clean(el.ownerDocument?.title)) return false;
  const headings = root.querySelectorAll?.("h1, h2, h3, h4, h5, h6, [role=heading], legend") || [];
  return ![...headings].some((h) => clean(h.textContent) === text);
}

/** The closest text above a control: a sibling heading/div before it. */
export function nearbyText(el, maxDepth = 4, withDepth = false) {
  const out = (text, depth) => (withDepth ? { text, depth } : text);
  let node = el;
  for (let depth = 0; node && depth < maxDepth; depth++, node = node.parentElement) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (holdsValue(sib)) continue; // a dropdown's shown choice: not the question
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

// On screen for a person, by rendering only (spec 017): never by aria-hidden
// or inert on an ancestor, which pop-up libraries set on the pop-up itself.
const isVisible = isOnScreen;

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

// A question's own box: Workday's formField wrapper, a fieldset, a group.
const CHOICE_BOX = '[data-automation-id*="formField"], fieldset, [role=group]';
const TYPED_BOX = 'input:not([type=checkbox]):not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox]';

/**
 * The box a nameless checkbox shares with the other choices of its question
 * (spec 034): its closest question box, when that box holds two or more
 * checkboxes, nothing to type in, and a question of its own (a legend, a
 * group name, or a label for the box). Null for a checkbox on its own.
 *
 * Never a list with an agreement among its boxes (spec 034 review): each box
 * stays on its own, so the agreement is guarded by its own words. A list
 * with a self-ID answer among its boxes ("Yes, I have a disability") IS one
 * list, so the whole question is the user's (guardReason reads every option).
 */
function choiceBox(el) {
  const box = el.closest?.(CHOICE_BOX);
  const boxes = box ? [...box.querySelectorAll('input[type="checkbox"]')] : [];
  if (boxes.length < 2) return null;
  if (box.querySelector(TYPED_BOX)) return null;
  if (boxes.some((b) => CONSENT.test(labelForOption(b)))) return null;
  const root = box.getRootNode?.() || box.ownerDocument;
  const legend = box.tagName === "FIELDSET" ? box.querySelector(":scope > legend") : box.querySelector("legend");
  const named =
    (legend && textOf(legend)) ||
    clean(box.getAttribute("aria-label")) ||
    (box.getAttribute("aria-labelledby") ? byIds(root, box.getAttribute("aria-labelledby")) : "") ||
    // Workday: "<label>Question</label>" (not any checkbox's own label) as the box's first text.
    [...box.querySelectorAll("label, [data-automation-id*=label], [data-automation-id*=Label]")].some(
      (l) => !l.querySelector('input[type="checkbox"]') && !(l.htmlFor && box.querySelector(`#${esc(l.htmlFor)}[type="checkbox"]`)) && textOf(l),
    );
  return named ? box : null;
}

/** Does the page say the box must be answered (required, aria-required, a "*" by its label)? */
export function isRequired(el) {
  if (el.required || el.getAttribute?.("aria-required") === "true") return true;
  const root = el.getRootNode?.() || el.ownerDocument;
  const label = (el.id && root.querySelector?.(`label[for="${esc(el.id)}"]`)) || el.closest?.("label");
  return !!label && /[*✱]|\(required\)/i.test(label.textContent || "");
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

// A drop zone or upload card, by its class or data-automation-id, any case
// (Workday's "attachments-FileUpload" and "file-upload-drop-zone"; spec 029).
// (Never a dropdown.)
const ZONE_NAME = /drop(?![\s_-]?down)|upload/i;
const DROP_NAME = /drop(?![\s_-]?down)/i;
const namedBy = (n, re) => re.test(n.getAttribute?.("data-automation-id") || "") || re.test(n.getAttribute?.("class") || "");
const isZone = (n) => n.tagName === "LABEL" || namedBy(n, ZONE_NAME);
const isDropZone = (n) => namedBy(n, DROP_NAME);
const UPLOAD_WORDS =
  /\b(select|choose|browse|upload|attach|add) (a |your )?files?\b|\bupload\b|\bbrowse\b|\battach\b|drop (a |your )?files? here/i;

/**
 * The visible box a file input hides behind (spec 026, 029): a drop zone or
 * label around it, else the nearest container (up to 4 levels up) holding a
 * drop zone or a visible "Select files" / "Upload" button, never one shared
 * with another upload. Workday's hidden input may sit inside its drop zone or
 * beside it in the upload card: either way the drop zone is the box.
 */
export function uploadZone(el, visible = isVisible) {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    if (node.querySelectorAll("input[type=file]").length > 1) break;
    if (isZone(node)) {
      // An upload card around the input: its own drop zone is the box.
      const drop = isDropZone(node) ? node : [...node.querySelectorAll("*")].find(isDropZone);
      return drop || node;
    }
    const drop = [...node.querySelectorAll("*")].find((n) => isDropZone(n) && visible(n));
    if (drop) return drop;
    const button = [...node.querySelectorAll("button, [role=button], a")].find(
      (b) => visible(b) && UPLOAD_WORDS.test(textOf(b) || b.getAttribute("aria-label") || ""),
    );
    if (button) return node;
  }
  return null;
}

/**
 * The text around an upload box that says what it's for, from the smallest
 * part of the page (up to 8 levels up) that holds this upload alone and has
 * words in it: Workday puts "Resume/CV" in the section heading above its
 * "Upload a file (5MB max)" label (spec 029).
 */
const DOC_WORDS = /r[ée]sum[ée]|\bcv\b|curriculum|cover[\s_-]*letter|transcript|portfolio|writing[\s_-]*sample|certific/i;
export function uploadArea(el) {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    if (node.querySelectorAll("input[type=file]").length > 1) break;
    const t = textOf(node, 600);
    if (DOC_WORDS.test(t)) return t.slice(0, 600);
  }
  return "";
}

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
    if (f.kind === "text" && PHONEISH.test([f.hints.type, f.hints.name, f.hints.id, f.hints.autocomplete, f.question].join(" "))) {
      f.hints.dialCode = dialCodeBeside(f.el);
    }
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
    section: sectionHeading(el),
    group: groupTitle(el),
    required: isRequired(el),
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
        // Workday's checkboxes often have no shared name: the ones in one
        // question's box are one list (spec 034), never separate lone boxes.
        const box = !name && type === "checkbox" ? choiceBox(el) : null;
        const key = `${type}|${name || (box ? `box:${fieldId(box)}` : fieldId(el))}`;
        if (!groups.has(key)) groups.set(key, { type, members: [], root: el.getRootNode() });
        groups.get(key).members.push(el);
        continue;
      }
      if (type === "file") {
        // Often hidden behind a drop zone or its own "Select files" button
        // (Workday): count it when it or its zone shows.
        const zone = uploadZone(el, visible);
        if (!visible(el) && !(zone && visible(zone))) continue;
        // What the box is for is often only in a heading above its card.
        // `area`: the part of the page around it that names it ("Resume/CV"
        // over Workday's "Upload a file"); `zone`: where a drop goes.
        add({
          id: fieldId(el),
          kind: "file",
          el,
          mark: zone || el,
          zone,
          question: questionFor(el),
          hints: {
            ...hintsOf(el),
            context: nearbyText(zone || el, 8),
            area: uploadArea(el),
            automation: el.getAttribute("data-automation-id") || "",
          },
        });
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

  // An upload box that doesn't say what it's for is the résumé's only when
  // it's the page's one such box (resolve.js isResumeUpload).
  // A box that clearly is the résumé's leaves none of the unclear ones to it.
  const files = fields.filter((f) => f.kind === "file");
  const kinds = files.map(uploadKind);
  const unclear = kinds.includes("resume") ? 99 : kinds.filter((k) => k === "unclear").length;
  for (const f of files) f.hints.unclearUploads = unclear;

  // Page order (groups were added last).
  const order = new Map(els.map((el, i) => [el, i]));
  return fields.sort((a, b) => (order.get(a.el) ?? 0) - (order.get(b.el) ?? 0));
}

const PHONEISH = /\btel\b|phone|mobile|\bcell\b/i;
const DIAL_ONLY = /^\+\s?\d{1,4}$/;
const DIAL_WORDS = /country\s*code|dial(ing)?\s*code|\+\d{1,4}\b/i;

/**
 * Is a country dial code drawn beside this phone box — a "+1" in front of it,
 * a code picker in the same small group, or "+1" already in the box
 * (react-phone-number-input)? Then the box takes the national number only
 * (spec 016, research R8).
 */
export function dialCodeBeside(el) {
  if (DIAL_ONLY.test((el.value || "").trim())) return true;
  let box = el.parentElement;
  for (let hop = 0; box && hop < 3; hop++, box = box.parentElement) {
    const controls = [...box.querySelectorAll("input:not([type=hidden]), select, button, [role=combobox]")];
    if (controls.length > 3) break; // a whole form row, not the phone's own group
    for (const c of controls) {
      if (c === el) continue;
      const t = c.tagName === "SELECT" ? textOf(c.options[c.selectedIndex] || c) || c.value : textOf(c) || c.value || c.getAttribute("aria-label") || "";
      if (t.length <= 60 && DIAL_WORDS.test(t)) return true;
    }
    for (const s of box.children) {
      if (!s.matches(CONTROL) && !s.querySelector(CONTROL) && DIAL_ONLY.test(textOf(s))) return true;
    }
  }
  return false;
}

// Section titles only — never a question's own label (a legend, the hidden
// "notched outline" legend MUI draws inside every box).
const HEADING = "h1, h2, h3, h4, h5, h6, [role=heading], [class*=section-title], [class*=sectionTitle], [class*=section-header], [class*=SectionHeader]";
const TYPED = "input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=submit]):not([type=button]), select, textarea";

/** A section title that's really on the page (not inside something hidden from it). */
function titleText(h) {
  if (!h || h.closest?.("[aria-hidden=true]")) return "";
  return textOf(h);
}

/**
 * The heading of the section a box sits in ("Employment History", "Employer
 * 2", "Personal Information"): the nearest section title above it — a
 * previous sibling, or the last title inside one — within the box's own form,
 * or the legend of a group of several boxes to type in. A question's legend
 * (a radio group's, a box's own outline) is never a section.
 * (jobHistory.js only trusts a heading when the boxes under it prove it.)
 */
export function sectionHeading(el) {
  const cut = (t) => (t.length <= 80 ? t : "");
  for (let n = el, hop = 0; n && hop < 12; n = n.parentElement, hop++) {
    // The group the box is in, titled by its legend ("Employment History"),
    // before anything above that group (a form-wide "Apply Now" title).
    if (n !== el && n.tagName === "FIELDSET") {
      const legend = [...n.children].find((c) => c.tagName === "LEGEND");
      const t = legend && !legend.closest("[aria-hidden=true]") ? textOf(legend) : "";
      if (t && n.querySelectorAll(TYPED).length >= 3) return cut(t);
    }
    // A heading may sit outside the form itself (Paycom's step title):
    // jobHistory.js only trusts it when the boxes under it prove it.
    for (let sib = n.previousElementSibling, k = 0; sib && k < 15; sib = sib.previousElementSibling, k++) {
      const h = sib.matches?.(HEADING) ? sib : [...(sib.querySelectorAll?.(HEADING) || [])].pop();
      const t = titleText(h);
      if (t) return cut(t);
    }
  }
  return "";
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

/** A visible password box on the page (a sign-in or sign-up page). */
export function passwordShown(doc) {
  return passwordCount(doc) > 0;
}

function passwordCount(doc) {
  return [...(doc?.querySelectorAll?.('input[type="password"]') || [])].filter((el) => isVisible(el)).length;
}

const EMAILISH = /\be-?mail\b/i;
// The page says it's making an account (a sign-in page doesn't).
const CREATING = /\bcreate (an |your |a new )?account\b|\bsign[\s-]?up\b|\bregister\b|\bnew (user|account)\b/i;

/**
 * An applicant system's Create Account page (spec 034): on an application
 * host (Workday, Greenhouse…), an email box beside password boxes. Job
 * Catcher fills the email (and "confirm email") only — never a password.
 * A job board's sign-in page is never one (not an application host).
 */
export function isSignupPage(fields) {
  const doc = fields[0]?.el?.ownerDocument;
  if (!doc || !applicantHost(doc.defaultView?.location?.href || "")) return false;
  if (!passwordShown(doc)) return false;
  // A register-and-apply form (Taleo, iCIMS, SuccessFactors: name, phone,
  // city… beside a password) is an application: filled as usual (never the
  // password). Only a short Create Account page is sign-up only.
  if (fields.length >= 6) return false;
  // Creating an account: a password and its repeat, or a heading that says
  // so. A sign-in page (one password, even with a "Create Account" button
  // beside it) stays not a form.
  const creating =
    passwordCount(doc) >= 2 || [...doc.querySelectorAll("h1, h2, h3, [role=heading]")].some((n) => CREATING.test(n.textContent || ""));
  if (!creating) return false;
  return fields.some(
    (f) => f.kind === "text" && (f.hints?.type === "email" || /\bemail\b/i.test(f.hints?.autocomplete || "") || EMAILISH.test(f.question || "")),
  );
}

/** Does this page look like a job application (not a sign-in, a search, or a
 *  page that merely has an upload box)? Two fields the profile answers, at
 *  least one of them about the person (or a résumé upload), and no password —
 *  except an applicant system's Create Account page (spec 034). */
export function looksLikeApplication(fields, { isIdentity, isMapped }) {
  const root = fields[0]?.el?.ownerDocument;
  if (passwordShown(root)) return isSignupPage(fields);
  const mapped = fields.filter(isMapped);
  if (mapped.length >= 2 && mapped.some(isIdentity)) return true;
  // A question-only step (Workday's "Application Questions", "Voluntary
  // Disclosures"…) on an application's own address.
  const href = root?.defaultView?.location?.href || "";
  return isApplyUrl(href) && fields.length >= 2;
}

// Address parts a site marks with autocomplete (a form about a person).
const PERSON_AUTOCOMPLETE = /\b(name|given-name|family-name|email|tel|tel-national|street-address|address-line1|postal-code|address-level[12])\b/i;

/**
 * Is there a form worth filling here (spec 016, research R2)? Decides whether
 * the side panel offers Autofill — never a guess about the address alone:
 * 3+ fillable fields; or 2+ fields the site marks with autocomplete, or on an
 * applicant system; or an application. A visible password box means a sign-in
 * page, unless it's one of the sign-up-and-apply forms with 6+ other fields,
 * or an applicant system's Create Account page (spec 034).
 */
export function hasFormHere(fields, { isApplication }) {
  const root = fields[0]?.el?.ownerDocument;
  if (!root) return false;
  if (passwordShown(root)) return fields.length >= 6 || isSignupPage(fields);
  if (fields.length >= 3) return true;
  if (fields.filter((f) => PERSON_AUTOCOMPLETE.test(f.hints?.autocomplete || "")).length >= 2) return true;
  if (fields.length >= 2 && applicantHost(root.defaultView?.location?.href || "")) return true;
  return isApplication();
}
