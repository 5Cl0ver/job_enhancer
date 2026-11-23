// "Copy what Job Catcher saw" (spec 017, research R5): per frame, what the
// scanner found, kept and dropped — and why — so a failure on a real page is
// one paste away from a fix, never a request for the page's HTML.
// NEVER a field's value or anything from the profile: labels, kinds and hints
// only (unit-tested in test/never-blind.spec.js with a filled page).
import { allElements, shadowOf } from "./scan.js";
import { hiddenReason } from "./visible.js";

const cut = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const CANDIDATE = "input, select, textarea, [role=combobox], [role=textbox], [contenteditable=''], [contenteditable=true]";
const NOT_FIELDS = new Set(["hidden", "submit", "button", "reset", "image"]);

/** Why the scanner left a control out (it saw it, but didn't keep it). */
function dropReason(el, behindPopup) {
  const r = hiddenReason(el);
  if (r) return r;
  if (el.disabled || el.getAttribute?.("aria-disabled") === "true") return "disabled";
  if (el.readOnly) return "read_only";
  if ((el.getAttribute?.("type") || "").toLowerCase() === "password") return "password";
  if ((el.getAttribute?.("type") || "").toLowerCase() === "search") return "search";
  if (behindPopup(el)) return "behind_popup";
  return "other";
}

/**
 * This frame's report.
 * @param {Document} doc
 * @param {{fields: object[], decide: (f: object) => string, inModal?: (el: Element) => boolean,
 *          popupOpen?: boolean, getShadow?: Function}} opts
 *   fields: what the scanner kept (session.scan()); decide: the fill's decision for one;
 *   popupOpen: a pop-up is open, so what's outside it is left out on purpose.
 */
export function frameReport(doc, { fields, decide, inModal = () => false, popupOpen = false, getShadow = shadowOf }) {
  const kept = new Set();
  for (const f of fields) {
    kept.add(f.el);
    for (const o of f.options || []) kept.add(o.el);
  }
  const dropped = {};
  let found = 0;
  for (const el of allElements(doc, getShadow)) {
    if (!el.matches?.(CANDIDATE)) continue;
    if (el.tagName === "INPUT" && NOT_FIELDS.has((el.getAttribute("type") || "").toLowerCase())) continue;
    found++;
    if (kept.has(el)) continue;
    const why = dropReason(el, (x) => popupOpen && !inModal(x));
    dropped[why] = (dropped[why] || 0) + 1;
  }
  const frames = doc.querySelectorAll("iframe, frame").length;
  return {
    host: doc.location?.hostname || "",
    top: doc.defaultView ? doc.defaultView === doc.defaultView.top : true,
    childFrames: frames,
    found,
    kept: fields.length,
    dropped,
    fields: fields.slice(0, 120).map((f) => ({
      label: cut(f.question, 80) || "(no label)",
      kind: f.kind,
      hints: {
        autocomplete: cut(f.hints?.autocomplete, 40),
        name: cut(f.hints?.name, 40),
        id: cut(f.hints?.id, 40),
        type: cut(f.hints?.type, 20),
      },
      options: f.options ? f.options.length : 0,
      inModal: !!inModal(f.el),
      decision: decide(f),
    })),
  };
}

/** The whole tab's report as plain text, ready to paste. */
export function formatReport({ version, host, frames }) {
  const lines = [`Job Catcher ${version} · what it saw on ${host || "this page"}`];
  if (!frames.length) lines.push("No frame answered: the page needs a refresh, or Job Catcher can't run on it.");
  for (const fr of frames) {
    const drops = Object.entries(fr.dropped || {})
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    lines.push(
      `\nFrame ${fr.frameId}${fr.top ? " (page)" : ""} · ${fr.host || "?"} · ${fr.found} boxes found, ${fr.kept} kept` +
        (drops ? `, left out: ${drops}` : "") +
        (fr.childFrames ? ` · ${fr.childFrames} inner frames` : ""),
    );
    for (const f of fr.fields) {
      const hints = Object.entries(f.hints)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      lines.push(
        `  - "${f.label}" ${f.kind}${f.options ? ` (${f.options} choices)` : ""}${hints ? ` [${hints}]` : ""}${f.inModal ? " · in pop-up" : ""} → ${f.decision}`,
      );
    }
  }
  return lines.join("\n");
}
