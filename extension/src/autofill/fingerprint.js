// A box the user taught, remembered by what it IS — its label, name, kind,
// place in the form — never by a CSS path, so it's found again when the
// site's markup shifts (spec 017, research R7; Similo-style weighted match).
// PURE: unit-tested in test/never-blind.spec.js.
import { normalizeQuestion } from "./classify/answers.js";

const cut = (s, n) => String(s || "").trim().slice(0, n);

/**
 * Names a person (or a developer) chose, not ones a build tool generated:
 * "legalFirstName", "email_address" yes; "css-1x2y3z", "jss123", ":r3:",
 * "input-48213", "mui-5" no (after @medv/finder's word-like test).
 */
export function stableName(s) {
  const v = String(s || "");
  if (!v || v.length > 80) return "";
  if (/^(css|jss|sc|emotion|mui|chakra|radix|headlessui|react-select)[-_]|^:r|\d{2,}|[-_:]\d+$|[a-f0-9]{8,}/i.test(v)) return "";
  if (/^[a-z]{1,2}$/i.test(v)) return "";
  return v;
}

/** The heading or legend a box sits under ("Personal information"). */
function sectionOf(el) {
  for (let n = el?.parentElement, hop = 0; n && hop < 8; n = n.parentElement, hop++) {
    const head = n.querySelector?.(":scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4");
    if (head?.textContent?.trim()) return cut(normalizeQuestion(head.textContent), 80);
  }
  return "";
}

/** A taught box's fingerprint, from a scanned field (scan.js) and its form's fields. */
export function fingerprintOf(field, fields = []) {
  const el = field.el;
  return {
    label: cut(field.key || normalizeQuestion(field.question), 120),
    name: stableName(field.hints?.name),
    id: stableName(field.hints?.id),
    testid: stableName(el?.getAttribute?.("data-testid") || el?.getAttribute?.("data-automation-id")),
    // "off" / "on" / "nope" say nothing about the box.
    autocomplete: /^(off|on|nope|false|none|disabled|new-password|no)$/i.test(field.hints?.autocomplete || "") ? "" : cut(field.hints?.autocomplete, 80),
    aria: cut(normalizeQuestion(el?.getAttribute?.("aria-label") || ""), 80),
    placeholder: cut(normalizeQuestion(field.hints?.placeholder || ""), 80),
    kind: field.kind,
    section: sectionOf(el),
    index: Math.max(0, fields.indexOf(field)),
  };
}

/** How sure we are that `field` is the taught box (0–1.2). */
export function matchScore(fp, field, fields = []) {
  const now = fingerprintOf(field, fields);
  if (fp.kind && now.kind !== fp.kind) return 0;
  // Two different questions are two different boxes, whatever their names say.
  if (fp.label && now.label && fp.label !== now.label) return 0;
  let s = 0;
  if ((fp.name && fp.name === now.name) || (fp.id && fp.id === now.id) || (fp.testid && fp.testid === now.testid)) s = 1;
  else if (fp.label && fp.label === now.label) s = 0.9;
  else if ((fp.autocomplete && fp.autocomplete === now.autocomplete) || (fp.aria && fp.aria === now.aria) || (fp.placeholder && fp.placeholder === now.placeholder)) s = 0.7;
  if (!s) return 0;
  if (fp.section && fp.section === now.section) s += 0.1;
  if (Number.isInteger(fp.index) && fp.index === now.index) s += 0.1;
  return s;
}

/**
 * The same box taught again (re-teaching replaces it). Its stable names decide
 * when both have one — two boxes under one heading are NOT the same; without
 * any, the same label in the same section at the same place. (Mirrors the
 * server's rule in backend/app/api/v1/autofill.py.)
 */
export function sameBox(a = {}, b = {}) {
  if ((a.kind || "") !== (b.kind || "")) return false;
  const strong = ["name", "id", "testid"].filter((k) => a[k] && b[k]);
  if (strong.length) return strong.every((k) => a[k] === b[k]);
  return !!a.label && a.label === b.label && a.section === b.section && a.index === b.index;
}

/**
 * Taught boxes on this page: each entry fills at most one box, and only when
 * it's sure (≥ 0.75) and clearly better than the next-best box (by 0.15) —
 * a loose match would fill the wrong box.
 * @returns {Map<string, object>} field id → taught entry
 */
export function matchTaught(entries, fields) {
  const out = new Map();
  for (const t of entries || []) {
    const ranked = fields
      .filter((f) => !out.has(f.id))
      .map((f) => ({ f, s: matchScore(t.fingerprint || {}, f, fields) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const [best, next] = ranked;
    if (best && best.s >= 0.75 && (!next || best.s - next.s >= 0.15)) out.set(best.f.id, t);
  }
  return out;
}
