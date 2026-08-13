// Workday "Work Experience" filler. Workday (*.myworkdayjobs.com) is everywhere
// and forces you to retype your whole résumé here. Its markup is stable and
// automation-id'd, so we fill each experience block deterministically from the
// user's parsed résumé history (most recent first) — clicking "Add Another" to
// make a block per job, and filling title / company / location / role / dates.
// PURE-ish (DOM only) so it's unit-tested with happy-dom.
import { setNativeValue, markFilled } from "./fill.js";
import { keyForText, normalizeQuestion, matchAnswer } from "./mapper.js";

/** Is this a Workday application with a Work Experience section? */
export function isWorkdayExperience(doc) {
  return !!doc?.querySelector?.('[data-automation-id="formField-jobTitle"]');
}

/** Is this control inside a Workday Work-Experience block? The generic + AI
 *  passes must SKIP these — this filler owns them, so the two never fight. */
export function inWorkExperience(el) {
  return !!el?.closest?.('[data-fkit-id^="workExperience-"]');
}

function blockRoots(doc) {
  const roots = [];
  const seen = new Set();
  for (const jt of doc.querySelectorAll('[data-automation-id="formField-jobTitle"]')) {
    const root = jt.closest('[data-fkit-id$="--null"]') || jt.parentElement;
    if (root && !seen.has(root)) {
      seen.add(root);
      roots.push(root);
    }
  }
  return roots;
}

/** Every Work Experience block on the page, in order (block 1 = most recent). */
export function collectWorkExperienceBlocks(doc) {
  if (!doc?.querySelectorAll) return [];
  return blockRoots(doc).map((root) => {
    const q = (sel) => root.querySelector(sel);
    return {
      root,
      title: q('[data-automation-id="formField-jobTitle"] input'),
      company: q('[data-automation-id="formField-companyName"] input'),
      location: q('[data-automation-id="formField-location"] input'),
      role: q('[data-automation-id="formField-roleDescription"] textarea'),
      current: q('[data-automation-id="formField-currentlyWorkHere"] input[type="checkbox"]'),
      // Keep the date FIELD containers — the month/year inputs are re-created by
      // Workday when the other part changes, so we must re-query them fresh.
      startDate: q('[data-automation-id="formField-startDate"]'),
      endDate: q('[data-automation-id="formField-endDate"]'),
    };
  });
}

// Authoritative text set (overwrites, so re-running corrects a bad value); never
// blanks a field.
function fillText(el, value) {
  if (!el || value == null || value === "") return false;
  if ((el.value || "") === String(value)) return false;
  setNativeValue(el, String(value));
  markFilled(el, "profile");
  return true;
}

function rawSet(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? globalThis.HTMLTextAreaElement?.prototype
      : globalThis.HTMLInputElement?.prototype;
  const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, String(value));
  else el.value = String(value);
}

const MONTH_SEL = '[data-automation-id="dateSectionMonth-input"]';
const YEAR_SEL = '[data-automation-id="dateSectionYear-input"]';

function setFire(el, value) {
  if (!el) return;
  rawSet(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Fill a Workday MM/YYYY date. Setting the month makes Workday re-render and
 * wipe a pre-set year, so: set month → wait for the re-render → RE-QUERY the
 * year input → set it. Then verify BOTH stuck; if not, clear both so the page
 * never shows a half-filled ("09/") invalid date. Returns whether it stuck.
 */
async function fillDate(container, month, year, wait) {
  if (!container || !month || !year) return false;
  setFire(container.querySelector(MONTH_SEL), String(month).padStart(2, "0"));
  await wait(60);
  const yEl = container.querySelector(YEAR_SEL); // fresh after any re-render
  setFire(yEl, String(year));
  if (yEl) {
    yEl.dispatchEvent(new Event("blur", { bubbles: true }));
    yEl.dispatchEvent(new Event("focusout", { bubbles: true }));
  }
  await wait(60);
  const m2 = container.querySelector(MONTH_SEL);
  const y2 = container.querySelector(YEAR_SEL);
  const stuck = (m2?.value || "").trim() && (y2?.value || "").trim();
  if (!stuck) {
    // The widget rejected a part — clear both so Workday doesn't flag "09/".
    if (m2 && (m2.value || "").trim()) setNativeValue(m2, "");
    if (y2 && (y2.value || "").trim()) setNativeValue(y2, "");
    return false;
  }
  markFilled(m2, "profile");
  markFilled(y2, "profile");
  return true;
}

// Clear a half-filled date left by any pass (so it can't error), without
// touching a valid or empty one.
function fixPartialDate(container) {
  if (!container) return;
  const m = container.querySelector(MONTH_SEL);
  const y = container.querySelector(YEAR_SEL);
  const mv = (m?.value || "").trim();
  const yv = (y?.value || "").trim();
  if ((mv && !yv) || (!mv && yv)) {
    if (m && mv) setNativeValue(m, "");
    if (y && yv) setNativeValue(y, "");
  }
}

async function fillBlock(b, e, wait) {
  let any = false;
  if (fillText(b.title, e.title)) any = true;
  if (fillText(b.company, e.company)) any = true;
  if (fillText(b.location, e.location)) any = true;
  if (fillText(b.role, e.description)) any = true;
  if (e.current && b.current && !b.current.checked) {
    b.current.checked = true;
    b.current.dispatchEvent(new Event("click", { bubbles: true }));
    b.current.dispatchEvent(new Event("change", { bubbles: true }));
    markFilled(b.current, "profile");
    any = true;
  }
  if (e.start_month && e.start_year) await fillDate(b.startDate, e.start_month, e.start_year, wait);
  else fixPartialDate(b.startDate);
  if (!e.current && e.end_month && e.end_year) await fillDate(b.endDate, e.end_month, e.end_year, wait);
  else if (!e.current) fixPartialDate(b.endDate);
  return any;
}

/** Fill the blocks currently on the page from the entries (block i ← entry i). */
export async function fillWorkExperience(blocks, entries, opts = {}) {
  const wait = opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let filled = 0;
  const details = [];
  for (let i = 0; i < blocks.length; i++) {
    const e = entries[i];
    if (!e) continue;
    if (await fillBlock(blocks[i], e, wait)) {
      filled++;
      details.push({
        label: `Work Experience ${i + 1}`,
        value: [e.title, e.company].filter(Boolean).join(" — "),
      });
    }
  }
  return { filled, details };
}

// ---- Workday questionnaire dropdowns -------------------------------------
// The "Application Questions" page uses custom listbox widgets (a button that
// pops open an option list), NOT <select> — so the generic passes can't see
// them. Each is a <button aria-haspopup="listbox"> inside a formField, with the
// question in the fieldset's legend.

/** Every Workday questionnaire dropdown with its question text. */
export function collectWorkdayDropdowns(doc) {
  if (!doc?.querySelectorAll) return [];
  const out = [];
  for (const button of doc.querySelectorAll('button[aria-haspopup="listbox"]')) {
    const field = button.closest('[data-automation-id^="formField-"]');
    if (!field) continue;
    const legend = field.querySelector('legend [data-automation-id="richText"]') || field.querySelector("legend");
    const question = (legend?.textContent || "")
      .replace(/\s+/g, " ")
      .replace(/\*/g, "")
      .trim();
    if (!question) continue;
    out.push({ button, field, question, current: (button.textContent || "").trim() });
  }
  return out;
}

// The answer for a questionnaire dropdown, or null: a profile Yes/No (work
// authorization, sponsorship, relocation…) or a previously-learned answer.
// Legal attestations we have no data for return null → left for the user.
function dropdownAnswer(question, values, answers) {
  const key = keyForText(question);
  if (key && typeof values[key] === "boolean") return values[key] ? "Yes" : "No";
  const m = matchAnswer(normalizeQuestion(question), answers);
  return m ? m.answer : null;
}

const optionLabel = (o) =>
  (o.getAttribute("data-automation-label") || o.textContent || "").replace(/\s+/g, " ").trim();

const isPlaceholder = (label) => /^(select( one)?|choose( an option)?|-+ ?select ?-+)$/i.test(label);

// Open the button's listbox and return its option elements (Workday only renders
// them after a click). Leaves the list OPEN so the caller can read/click.
async function openOptions(dd, doc, wait) {
  dd.button.click();
  for (let t = 0; t < 20; t++) {
    await wait(40);
    const opts = [...doc.querySelectorAll('[data-automation-id="promptOption"], [role="option"]')];
    if (opts.length) return opts;
  }
  return [];
}

// Close an open listbox without selecting (toggle the button).
function closeDropdown(dd, doc) {
  if (doc.querySelector('[data-automation-id="promptOption"], [role="option"]')) dd.button.click();
}

function clickOption(opts, answer) {
  const want = String(answer).replace(/\s+/g, " ").trim().toLowerCase();
  if (!want) return false;
  const match =
    opts.find((o) => optionLabel(o).toLowerCase() === want) ||
    opts.find((o) => want.length >= 2 && optionLabel(o).toLowerCase().startsWith(want));
  if (match) {
    match.click();
    return true;
  }
  return false;
}

/**
 * Fill Workday questionnaire dropdowns. Two tiers, so new questions don't need
 * hand-mapping:
 *   1. KNOWN — profile Yes/No + learned answers (instant, no AI).
 *   2. AI FALLBACK — read every unknown widget's REAL options, then make ONE
 *      batched call (opts.aiMap(fields) → {id: answer}) so the whole page costs a
 *      single round-trip instead of one-per-dropdown. Grounded: the model omits
 *      anything the user's data doesn't answer, so legal attestations are left
 *      for the user.
 * Uses the standard ARIA combobox pattern (aria-haspopup=listbox + role=option),
 * so it generalises beyond Workday.
 */
export async function fillWorkdayDropdowns(doc, values, answers, opts = {}) {
  const wait = opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const aiMap = opts.aiMap;
  const dds = collectWorkdayDropdowns(doc);
  const filled = [];
  const pending = []; // {dd, options} for the single AI batch

  // Pass 1: apply known answers; collect options for the unknowns.
  for (const dd of dds) {
    const known = dropdownAnswer(dd.question, values, answers || []);
    if (known && dd.current.toLowerCase() === known.toLowerCase()) continue; // already set
    const optsEls = await openOptions(dd, doc, wait);
    if (!optsEls.length) continue;
    if (known) {
      if (clickOption(optsEls, known)) {
        markFilled(dd.button, "profile");
        filled.push({ label: dd.question.slice(0, 70), value: known, source: "profile" });
      } else {
        closeDropdown(dd, doc);
      }
      continue;
    }
    const labels = optsEls.map(optionLabel).filter((l) => l && !isPlaceholder(l));
    closeDropdown(dd, doc);
    if (labels.length && aiMap) pending.push({ dd, options: labels });
  }

  // Pass 2: ONE AI call for every unknown dropdown on the page.
  if (pending.length && aiMap) {
    const fields = pending.map((p, i) => ({
      id: "d" + i,
      label: p.dd.question,
      type: "select",
      options: p.options,
    }));
    const mappings = (await aiMap(fields)) || {};
    // Pass 3: apply the model's choices.
    for (let i = 0; i < pending.length; i++) {
      const choice = mappings["d" + i];
      if (!choice) continue;
      const { dd } = pending[i];
      const optsEls = await openOptions(dd, doc, wait);
      if (clickOption(optsEls, choice)) {
        markFilled(dd.button, "ai");
        filled.push({ label: dd.question.slice(0, 70), value: choice, source: "ai" });
      } else {
        closeDropdown(dd, doc);
      }
    }
  }
  return filled;
}

/**
 * Full flow: add a block per résumé job (clicking Workday's "Add Another",
 * which renders a new block asynchronously), then fill them all.
 */
export async function fillAllWorkExperience(doc, entries, opts = {}) {
  const wait = opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const addBtn = () => doc.querySelector('[data-automation-id="add-button"]');

  let guard = 0;
  while (collectWorkExperienceBlocks(doc).length < entries.length && addBtn() && guard < 12) {
    guard++;
    const before = collectWorkExperienceBlocks(doc).length;
    addBtn().click();
    for (let t = 0; t < 20 && collectWorkExperienceBlocks(doc).length <= before; t++) {
      await wait(100);
    }
  }
  return fillWorkExperience(collectWorkExperienceBlocks(doc), entries, { wait });
}
