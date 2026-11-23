// One frame's fill: scan → decide → write → read back, then the AI pass for
// what's left; plus Fix, Undo and Show for the review in the side panel.
// Nothing is ever submitted, nothing the user typed is overwritten, and
// self-identification, agreements and essays are never touched.
import { normalizeQuestion, yesNo } from "./classify/answers.js";
import { PRIVATE, profileKeyFor } from "./classify/profileKeys.js";
import { collectFields, looksLikeApplication } from "./scan.js";
import { IDENTITY, isResumeUpload, resolve } from "./resolve.js";
import { canRestore, hasValue, peekOptions, readField, restore, same, snapshot, writeField } from "./widgets.js";

const STYLE_ID = "jec-fill-style";
const STYLE = `
[data-jec-fill] { outline: 2px solid var(--jec-fill) !important; outline-offset: 2px !important; border-radius: 4px; }
[data-jec-fill="profile"] { --jec-fill: oklch(0.6 0.15 155 / .85); }
[data-jec-fill="learned"] { --jec-fill: oklch(0.6 0.17 250 / .85); }
[data-jec-fill="ai"]      { --jec-fill: oklch(0.6 0.2 300 / .9); }
[data-jec-fill="need"]    { --jec-fill: oklch(0.72 0.16 65 / .9); outline-style: dashed !important; }
[data-jec-flash] { outline: 3px solid oklch(0.72 0.16 65) !important; outline-offset: 3px !important; transition: outline-color .2s; }
`;

function ensureStyle(node) {
  const root = node.getRootNode?.() || node.ownerDocument;
  const host = root.nodeType === 9 ? root.documentElement : root; // document or shadow root
  if (host.querySelector?.(`#${STYLE_ID}`)) return;
  const style = node.ownerDocument.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (root.nodeType === 9 ? root.head || root.documentElement : root).appendChild(style);
}

function mark(field, source) {
  const el = field.mark || field.el;
  if (!el?.setAttribute) return;
  ensureStyle(el);
  el.setAttribute("data-jec-fill", source);
}

function unmark(field) {
  (field.mark || field.el)?.removeAttribute?.("data-jec-fill");
}

// Profile answers a typed value can teach (email is the account's own).
const LEARNABLE_PROFILE = new Set([
  "first_name", "last_name", "phone", "address_line1", "address_line2", "city", "state",
  "postal_code", "country", "linkedin_url", "github_url", "portfolio_url",
  "authorized_to_work", "requires_sponsorship", "willing_to_relocate", "desired_salary", "notice_period",
]);
const BOOL_PROFILE = new Set(["authorized_to_work", "requires_sponsorship", "willing_to_relocate"]);

const LEFT_FOR_YOU = new Set(["sensitive", "essay", "unknown", "no_data", "no_option", "rejected", "other_person"]);
const AI_KINDS = new Set(["text", "select", "radio", "buttons", "combobox", "checkbox_list", "date"]);

const optionLabels = (f) => (f.options || []).map((o) => o.label).filter(Boolean).slice(0, 60);
const shortLabel = (q) => (q.length > 90 ? q.slice(0, 89) + "…" : q) || "Unlabelled field";

/**
 * @param {{doc?: Document, send: (msg: object) => Promise<any>, onChange?: () => void,
 *          getShadow?: Function, visible?: Function, skipField?: (f) => boolean}} deps
 */
export function createSession(deps) {
  const doc = deps.doc || document;
  const send = deps.send;
  const skipField = deps.skipField || (() => false);
  /** id → {field, entry, snap} for everything we filled */
  const filled = new Map();
  /** id → {field, item} for what's left for the user */
  const needYou = new Map();
  /** id → field from the latest scan */
  let fields = new Map();
  /** id → {field, item}: the AI's unsure answers, offered with "Use" */
  const suggestions = new Map();

  const scan = () => {
    const list = collectFields(doc, { getShadow: deps.getShadow, visible: deps.visible }).filter((f) => !skipField(f));
    fields = new Map(list.map((f) => [f.id, f]));
    return list;
  };

  const isApplication = () =>
    looksLikeApplication(scan(), {
      isIdentity: (f) => IDENTITY.has(profileKeyFor(f) || "") || (f.kind === "file" && isResumeUpload(f)),
      isMapped: (f) => !!profileKeyFor(f) || (f.kind === "file" && isResumeUpload(f)),
    });

  function entryFor(field, source, actual, snap) {
    return {
      id: field.id,
      label: shortLabel(field.question),
      kind: field.kind,
      source,
      value: field.kind === "file" ? actual : String(actual ?? ""),
      options: optionLabels(field),
      can_undo: canRestore(field, snap),
    };
  }

  async function fillOne(field, values, source) {
    const snap = snapshot(field);
    const before = readField(field);
    const res = await writeField(field, values);
    if (!res.ok) {
      // Written but not taken (or half taken): put the field back, so nothing
      // is left changed without a record and an Undo.
      if (readField(field) !== before) await restore(field, snap).catch(() => {});
      return res;
    }
    filled.set(field.id, { field, snap, entry: entryFor(field, source, res.actual, snap) });
    needYou.delete(field.id);
    mark(field, source);
    return res;
  }

  function leave(field, reason) {
    if (!LEFT_FOR_YOU.has(reason)) return;
    needYou.set(field.id, { field, item: { id: field.id, label: shortLabel(field.question), reason, kind: field.kind, options: optionLabels(field) } });
    if (reason !== "sensitive") mark(field, "need");
  }

  /**
   * Fill everything known, instantly. Fields that already hold something are
   * left as they are (the user's or the page's own value).
   * @param {import("./resolve.js").Copy} copy
   * @returns {Promise<{leftovers: object[]}>}
   */
  async function fillKnown(copy) {
    const leftovers = [];
    for (const field of scan()) {
      if (filled.has(field.id)) continue;
      if (field.kind !== "file" && hasValue(field)) continue;
      if (field.kind === "file" && field.el.files?.length) continue;
      const d = resolve(field, copy);
      if (d.skip) {
        if (d.skip === "unknown" && AI_KINDS.has(field.kind)) leftovers.push(field);
        leave(field, d.skip);
        continue;
      }
      const res = await fillOne(field, d.values, d.source);
      if (!res.ok) leave(field, res.reason || "rejected");
    }
    return { leftovers };
  }

  /** One request for everything left: the app's AI answers from the user's data. */
  async function fillWithAi(leftovers) {
    if (!leftovers.length) return 0;
    const asked = [];
    for (const f of leftovers.slice(0, 40)) {
      const options = f.kind === "combobox" && asked.filter((a) => a.f.kind === "combobox").length < 12 ? await peekOptions(f) : optionLabels(f);
      asked.push({ f, q: { id: f.id, label: f.question.slice(0, 500), type: f.kind === "text" || f.kind === "date" ? "text" : "select", options } });
    }
    const res = await send({ type: "aiMapFields", fields: asked.map((a) => a.q) }).catch(() => null);
    const mappings = res?.mappings || {};
    const confidence = res?.confidence || {};
    let n = 0;
    for (const { f } of asked) {
      const v = mappings[f.id];
      if (v == null || v === "" || hasValue(f)) continue;
      // Only a sure answer fills; an unsure (or unscored) one is offered as a
      // suggestion the user can Use (spec 015, Story 5).
      if ((confidence[f.id] ?? 0.5) < 0.75) {
        suggestions.set(f.id, { field: f, item: { id: f.id, label: shortLabel(f.question), value: String(v), kind: f.kind } });
        continue;
      }
      const r = await fillOne(f, [String(v)], "ai");
      if (r.ok) n++;
    }
    return n;
  }

  /** The review the side panel shows (serializable). */
  function report() {
    return {
      url: doc.location?.href || "",
      entries: [...filled.values()].map((x) => x.entry),
      need_you: [...needYou.values()].filter((x) => !hasValue(x.field) && !suggestions.has(x.field.id)).map((x) => x.item),
      suggestions: [...suggestions.values()].filter((x) => !hasValue(x.field)).map((x) => x.item),
    };
  }

  /** Use an AI suggestion (the user's tap): it fills like a sure answer. */
  async function useSuggestion(id) {
    const s = suggestions.get(id);
    if (!s) return { ok: false };
    const res = await fillOne(s.field, [s.item.value], "ai");
    if (res.ok) suggestions.delete(id);
    return res;
  }

  /** Which step of the application is showing (its questions, in order). */
  function stepFingerprint() {
    return scan()
      .map((f) => f.key)
      .filter(Boolean)
      .join("|");
  }

  /**
   * Profile answers the user typed (or Chrome's own autofill put in) that the
   * profile doesn't have, or has differently — offered as "Save to my
   * profile" (spec 015, FR-013a). Nothing is saved without a press.
   * @param {Record<string, string[]>} known  the profile's answers (profileValues)
   */
  function typedProfile(known) {
    const out = {};
    for (const field of scan()) {
      const key = profileKeyFor(field);
      if (!LEARNABLE_PROFILE.has(key)) continue;
      const ours = filled.get(field.id);
      const value = readField(field).trim();
      if (!value || value.length > 200) continue;
      if (ours && same(value, ours.entry.value)) continue; // ours, untouched
      if ((known[key] || []).some((k) => same(value, k))) continue; // already saved
      if (BOOL_PROFILE.has(key)) {
        const b = yesNo(value);
        if (b) out[key] = b === "yes";
      } else if (key === "desired_salary") {
        const n = Number(value.replace(/[^\d.]/g, ""));
        if (n > 0) out[key] = Math.round(n);
      } else if (key === "state" && value.length > 2) {
        out[key] = value;
      } else out[key] = value;
    }
    return out;
  }

  const find = (id) => filled.get(id)?.field || needYou.get(id)?.field || fields.get(id) || scan().find((f) => f.id === id);

  /** Change one field to the user's choice (the panel's Fix). */
  async function fix(id, value) {
    const field = find(id);
    if (!field) return { ok: false };
    const had = filled.get(id);
    const snap = had?.snap || snapshot(field);
    const res = await writeField(field, [value]);
    if (!res.ok) return res;
    const source = had?.entry.source === "profile" ? "profile" : "learned";
    filled.set(id, { field, snap, entry: { ...entryFor(field, source, res.actual, snap), fixed: true } });
    needYou.delete(id);
    mark(field, source);
    // A custom question's fix is remembered for next time (FR-014).
    if (!profileKeyFor(field) && field.key && field.kind !== "file") {
      await send({
        type: "saveCustomAnswers",
        answers: [{ question_key: field.key, question_text: field.question.slice(0, 500), answer: String(res.actual || value).slice(0, 2000) }],
      }).catch(() => null);
    }
    return res;
  }

  async function undo(id) {
    const ids = id ? [id] : [...filled.keys()];
    let undone = 0;
    for (const k of ids) {
      const x = filled.get(k);
      if (!x || !x.entry.can_undo) continue;
      // Changed on the page since? That's the user's now: leave it.
      // (Exactly, or the same digits: "Rich" is not "Richmond".)
      const now = readField(x.field).trim();
      const ours = String(x.entry.value).trim();
      const unchanged = now === ours || (now.replace(/\D/g, "").length >= 7 && now.replace(/\D/g, "") === ours.replace(/\D/g, "")) || (x.field.kind !== "text" && x.field.kind !== "textarea" && same(now, ours));
      if (x.field.kind !== "file" && !unchanged) {
        filled.delete(k);
        unmark(x.field);
        continue;
      }
      if (await restore(x.field, x.snap)) {
        filled.delete(k);
        unmark(x.field);
        undone++;
      }
    }
    return undone;
  }

  function show(id) {
    const field = find(id);
    const el = field?.mark || field?.el;
    if (!el) return false;
    el.scrollIntoView?.({ behavior: "smooth", block: "center" });
    try {
      field.el.focus?.({ preventScroll: true });
    } catch {
      /* not focusable */
    }
    el.setAttribute("data-jec-flash", "");
    ensureStyle(el);
    setTimeout(() => el.removeAttribute("data-jec-flash"), 1600);
    return true;
  }

  /** Answers the user typed into questions we didn't know ("Remember"). */
  function typedAnswers() {
    const out = [];
    const list = scan();
    const keyCount = new Map();
    for (const f of list) keyCount.set(f.key, (keyCount.get(f.key) || 0) + 1);
    for (const field of list) {
      // Agreements, private numbers, and questions we can't tell apart (two
      // fields read as the same question) are never remembered.
      if (field.kind === "checkbox" || PRIVATE.test(field.question) || keyCount.get(field.key) > 1) continue;
      // Something we filled counts only if the user has since changed it.
      const ours = filled.get(field.id);
      if (ours && ours.entry.source !== "ai" && readField(field).trim() === ours.entry.value.trim()) continue;
      if (profileKeyFor(field) || field.kind === "file" || !field.key || field.key.length < 3) continue;
      const d = resolve(field, { values: {}, answers: [] });
      if (d.skip && d.skip !== "unknown") continue; // sensitive, essays, agreements
      const answer = readField(field).trim();
      if (!answer || answer.length > 500) continue;
      out.push({ question_key: normalizeQuestion(field.question), question_text: field.question.slice(0, 500), answer });
    }
    return out;
  }

  return {
    scan,
    isApplication,
    fillKnown,
    fillWithAi,
    report,
    fix,
    undo,
    show,
    typedAnswers,
    typedProfile,
    useSuggestion,
    stepFingerprint,
    get filledCount() {
      return filled.size;
    },
  };
}
