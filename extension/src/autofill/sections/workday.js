// Workday's "retype your résumé" sections (spec 020, US2): Work Experience,
// Education, Languages, Websites and Certifications come as numbered rows
// ("Work Experience 2") with an Add button per section, and Skills as a search
// prompt. Each row is filled from the matching entry of the CHOSEN résumé's
// details (languages from the profile), rows are added with the page's own
// Add button until they match (at most 10), and a value Workday put in from
// its own résumé reading that differs is corrected — through the session, so
// every change has Undo and the user's own edits are never touched.
//
// Markup from working open-source Workday fillers (research R4): rows are
// [role=group][aria-labelledby$="-panel"] (older tenants: workExperience-N,
// education-N, language-N, websitePanelSet-N), fields formField-<name>,
// dates dateSectionMonth-input / dateSectionYear-input. Rows are found by
// what's in them, never by their number (ids can be arbitrary).
// DOM only: test/workday.spec.js, test/sections.spec.js; the lab covers the rest.
import { degreeForms } from "../classify/profileKeys.js";
import { abilityOf, levelFor, levelOption } from "../classify/languages.js";
import { PROMPT_BOX, fieldId, textOf } from "../scan.js";
import { asWriter, pointerClick, readField, setNativeValue, writeField } from "../widgets.js";

const FF = (id) => `[data-automation-id="formField-${id}"]`;
const ROW =
  '[role="group"][aria-labelledby$="-panel"], [data-fkit-id$="--null"], [data-automation-id^="workExperience-"], ' +
  '[data-automation-id^="education-"], [data-automation-id^="language-"], [data-automation-id^="websitePanelSet-"], [data-automation-id^="certification-"]';
const SECTION = '[aria-labelledby$="-section"], [data-automation-id$="Section"], section, fieldset';
const MONTH = '[data-automation-id="dateSectionMonth-input"]';
const YEAR = '[data-automation-id="dateSectionYear-input"]';
const LISTBOX = 'button[aria-haspopup="listbox"]';

const KIND_OF_ROW = [
  ["work", FF("jobTitle")],
  ["education", `${FF("school")}, ${FF("schoolName")}, ${FF("degree")}`],
  ["languages", `${FF("language")}, button[name="language"]`],
  ["websites", `${FF("url")}, ${FF("websiteAddress")}, ${FF("websiteUrl")}`],
  ["certifications", `${FF("certification")}, ${FF("certificationName")}`],
];
const KIND_OF_HEADING = [
  ["work", /work experience|work history|employment|professional experience/i],
  ["education", /education/i],
  ["languages", /language/i],
  ["websites", /website|social|\blinks?\b/i],
  ["certifications", /certifica|licen[cs]e/i],
];

/** Which section a row belongs to, from the fields in it. */
export function rowKind(row) {
  for (const [kind, sel] of KIND_OF_ROW) if (row.querySelector(sel)) return kind;
  return null;
}

/** Is this a Workday page with résumé sections? */
export function isWorkdaySections(doc) {
  return !!doc?.querySelector?.(`${FF("jobTitle")}, ${FF("language")}, ${FF("skills")}, [data-automation-id="add-button"]`) && workdayRows(doc).length + addButtons(doc).length > 0;
}

/** Every résumé row on the page, outermost only, in page order. */
export function workdayRows(doc) {
  const all = [...doc.querySelectorAll(ROW)].filter((r) => rowKind(r));
  return all.filter((r) => !all.some((o) => o !== r && o.contains(r))).map((row) => ({ row, kind: rowKind(row) }));
}

function addButtons(doc) {
  return [...doc.querySelectorAll('[data-automation-id="add-button"]')];
}

/**
 * Where a box sits in Workday's résumé sections, independent of the page
 * redrawing it: section kind, row number, field and date part. null outside.
 */
export function workdayAddress(el) {
  const row = el?.closest?.(ROW);
  const kind = row && rowKind(row);
  if (kind) {
    const rows = workdaySections(el.ownerDocument).get(kind)?.rows || [];
    const ff = el.closest('[data-automation-id^="formField-"]')?.getAttribute("data-automation-id") || "";
    return `wd|${kind}|${rows.indexOf(row)}|${ff}|${el.getAttribute("data-automation-id") || el.getAttribute("name") || el.tagName}`;
  }
  if (el?.closest?.(FF("skills"))) return "wd|skills";
  return null;
}

/** A control inside a row this filler owns (the general engine skips these). */
export function inWorkdaySection(el) {
  const row = el?.closest?.(ROW);
  return !!(row && rowKind(row)) || !!el?.closest?.(FF("skills"));
}

function headingText(sec) {
  const id = sec.getAttribute("aria-labelledby");
  const h = (id && sec.ownerDocument.getElementById(id)) || sec.querySelector("h2, h3, h4, h5, legend");
  return h ? textOf(h) : "";
}

/** Each section's rows and Add button: Map kind → {rows, add}. */
export function workdaySections(doc) {
  const out = new Map();
  const get = (kind) => out.get(kind) || out.set(kind, { rows: [], add: null }).get(kind);
  for (const { row, kind } of workdayRows(doc)) {
    const s = get(kind);
    s.rows.push(row);
    if (!s.add) s.add = row.closest(SECTION)?.querySelector('[data-automation-id="add-button"]') || null;
  }
  // A section with no rows yet (Websites before its first Add): by its heading.
  for (const btn of addButtons(doc)) {
    if ([...out.values()].some((s) => s.add === btn)) continue;
    const sec = btn.closest(SECTION);
    if (!sec) continue;
    const fromRows = workdayRows(sec)[0]?.kind;
    const heading = headingText(sec);
    const kind = fromRows || KIND_OF_HEADING.find(([, re]) => re.test(heading))?.[0];
    if (kind && !get(kind).add) get(kind).add = btn;
  }
  return out;
}

/** The question a control asks, from its formField's label. */
function labelOf(el) {
  const ff = el.closest('[data-automation-id^="formField-"]');
  const l = ff?.querySelector("label, legend");
  return (l ? textOf(l) : "") || el.getAttribute("aria-label") || "";
}

/** A box the page shows (Workday hides "To" while "I currently work here" is ticked). */
const shownBox = (el) => !!el && !el.closest("[hidden]") && (!el.getClientRects || el.getClientRects().length > 0);

const box = (el, kind, question) => ({ id: fieldId(el), el, kind, mark: el, question, hints: {} });
const pad = (n) => String(n).padStart(2, "0");

/** A context for direct use (tests, no session): write, never correct a user's edits. */
export function plainContext(opts = {}) {
  return {
    wait: opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms))),
    auto: false,
    put: async (field, values) => {
      const now = readField(field).trim();
      if (field.kind !== "chips" && now && values.some((v) => (field.kind === "spin" ? Number(now) === Number(v) : now === String(v)))) return { ok: true, already: true };
      return writeField(field, values);
    },
    leave: () => {},
    undo: async () => 0,
    userEdited: () => false,
  };
}

const wrote = (res) => !!res?.ok && !res.already;

async function text(ctx, el, value, question) {
  if (!el || value == null || value === "") return false;
  return wrote(await ctx.put(box(el, el.tagName === "TEXTAREA" ? "textarea" : "text", question), [String(value)]));
}

/** A search prompt (Workday's multiselect) or a plain text box, whichever it is. */
async function promptOrText(ctx, ff, value, question) {
  if (!ff || !value) return false;
  const input = ff.querySelector("input:not([type=checkbox]):not([type=radio]), textarea");
  if (!input) return false;
  const isPrompt = !!ff.querySelector(`${PROMPT_BOX}, [data-uxi-widget-type="selectinput"]`);
  return wrote(await ctx.put(box(input, isPrompt ? "chips" : input.tagName === "TEXTAREA" ? "textarea" : "text", question), [String(value)]));
}

/** Clear a half-filled date (a month with no year shows Workday's error), never the user's. */
async function fixPartialDate(ctx, container) {
  if (!container || ctx.auto) return; // a step filled by itself changes no filled box
  const m = container.querySelector(MONTH);
  const y = container.querySelector(YEAR);
  const mv = (m?.value || "").trim();
  const yv = (y?.value || "").trim();
  if ((mv && !yv) || (!mv && yv)) {
    for (const el of [m, y]) if (el && (el.value || "").trim() && !ctx.userEdited(el)) await asWriter({ el }, () => setNativeValue(el, ""));
  }
}

/**
 * Fill a Workday month/year date. Setting the month makes Workday redraw and
 * drop a year already there, so: month → wait → find the year box afresh →
 * year. Then both parts must have stuck; if only one did, the part we put
 * there is undone, so the page never shows a half date ("09/").
 */
async function date(ctx, container, month, year, question) {
  if (!container) return false;
  const mEl = container.querySelector(MONTH);
  if (!mEl) {
    // A year-only date (education): just the year.
    const yOnly = container.querySelector(YEAR) || container.querySelector("input");
    return year ? wrote(await ctx.put(box(yOnly, "spin", question), [String(year)])) : false;
  }
  if (!month || !year) {
    await fixPartialDate(ctx, container);
    return false;
  }
  const mRes = await ctx.put(box(mEl, "spin", `${question} month`), [pad(month)]);
  await ctx.wait(60);
  const yEl = container.querySelector(YEAR);
  const yRes = yEl ? await ctx.put(box(yEl, "spin", `${question} year`), [String(year)]) : { ok: false };
  await ctx.wait(60);
  const m2 = container.querySelector(MONTH);
  const y2 = container.querySelector(YEAR);
  const mv = (m2?.value || "").trim();
  const yv = (y2?.value || "").trim();
  if (!mv !== !yv) {
    // Half a date: take back what we put; clear what's left if the user didn't type it.
    for (const [el, res] of [[mEl, mRes], [yEl, yRes]]) if (el && wrote(res)) await ctx.undo(fieldId(el));
    await fixPartialDate(ctx, container);
    return false;
  }
  return wrote(mRes) || wrote(yRes);
}

async function checkbox(ctx, el, on, question) {
  if (!el || !on) return false;
  return wrote(await ctx.put(box(el, "checkbox", question), ["Yes"]));
}

async function list(ctx, btn, values, question, pick) {
  if (!btn || !values?.length) return false;
  const f = box(btn, "combobox", question);
  if (pick) f.pick = pick;
  return wrote(await ctx.put(f, values));
}

// ---- One row of each kind ------------------------------------------------------

async function fillWork(ctx, row, e, n) {
  const q = (sel) => row.querySelector(sel);
  const at = (p) => `Work Experience ${n} · ${p}`;
  let any = false;
  any = (await text(ctx, q(`${FF("jobTitle")} input`), e.title, at("Job Title"))) || any;
  any = (await text(ctx, q(`${FF("companyName")} input`), e.company, at("Company"))) || any;
  any = (await text(ctx, q(`${FF("location")} input`), e.location, at("Location"))) || any;
  const current = q(`${FF("currentlyWorkHere")} input[type="checkbox"]`);
  if (e.current) any = (await checkbox(ctx, current, true, at("I currently work here"))) || any;
  else if (current?.checked) {
    // The page ticked it, the résumé says the job ended: untick it (a press
    // only — never on a step filled by itself, never the user's own tick),
    // then wait for the To date the page shows once it's unticked.
    const res = await ctx.put(box(current, "checkbox", at("I currently work here")), ["No"]);
    if (wrote(res)) {
      any = true;
      await waitFor(() => shownBox(q(FF("endDate"))), ctx, 1000);
    }
  }
  any = (await date(ctx, q(FF("startDate")), e.start_month, e.start_year, at("From"))) || any;
  if (!e.current && !current?.checked && shownBox(q(FF("endDate")))) any = (await date(ctx, q(FF("endDate")), e.end_month, e.end_year, at("To"))) || any;
  any = (await text(ctx, q(`${FF("roleDescription")} textarea`), e.description, at("Role Description"))) || any;
  return any;
}

async function fillEducation(ctx, row, s, n) {
  const q = (sel) => row.querySelector(sel);
  const at = (p) => `Education ${n} · ${p}`;
  let any = false;
  any = (await promptOrText(ctx, q(FF("school")) || q(FF("schoolName")), s.school, at("School"))) || any;
  any = (await list(ctx, q(`${FF("degree")} ${LISTBOX}`), s.degree ? degreeForms(s.degree) : [], at("Degree"))) || any;
  any = (await promptOrText(ctx, q(FF("fieldOfStudy")), s.field_of_study, at("Field of Study"))) || any;
  any = (await date(ctx, q(FF("firstYearAttended")), null, s.start_year, at("From"))) || any;
  any = (await date(ctx, q(FF("lastYearAttended")), null, s.end_year, at("To"))) || any;
  return any;
}

async function fillLanguage(ctx, row, lang, n) {
  const at = (p) => `Languages ${n} · ${p}`;
  let any = false;
  const pickBtn = row.querySelector(`${FF("language")} ${LISTBOX}, button[name="language"]`);
  any = (await list(ctx, pickBtn, [lang.language], at("Language"))) || any;
  const fluent = row.querySelector(`input[name="native"], ${FF("native")} input[type="checkbox"], ${FF("fluent")} input[type="checkbox"]`);
  any = (await checkbox(ctx, fluent, !!lang.native, at("I am fluent in this language"))) || any;
  // Every other list in the row is an ability's level (Comprehension, Reading…).
  for (const btn of row.querySelectorAll(`[data-automation-id^="formField-"] ${LISTBOX}`)) {
    if (btn === pickBtn) continue;
    const label = labelOf(btn);
    const level = levelFor(lang, abilityOf(label));
    if (!level) continue;
    any = (await list(ctx, btn, [`level ${level}`], at(label || "Proficiency"), (opts) => levelOption(level, opts))) || any;
  }
  return any;
}

async function fillWebsite(ctx, row, url, n) {
  const input = row.querySelector(`${FF("url")} input, ${FF("websiteAddress")} input, ${FF("websiteUrl")} input`);
  return text(ctx, input, url, `Websites ${n} · URL`);
}

async function fillCertification(ctx, row, name, n) {
  return promptOrText(ctx, row.querySelector(FF("certification")) || row.querySelector(FF("certificationName")), name, `Certifications ${n} · Certification`);
}

const FILL = { work: fillWork, education: fillEducation, languages: fillLanguage, websites: fillWebsite, certifications: fillCertification };

async function waitFor(test, ctx, ms = 2000) {
  for (let t = 0; t <= ms / 100; t++) {
    if (test()) return true;
    await ctx.wait(100);
  }
  return test();
}

/**
 * Fill every Workday résumé section on the page.
 * @param {Document} doc
 * @param {{work?, education?, languages?, websites?, certifications?, skills?}} data
 * @param {object} ctx {put, leave, undo, wait, auto, userEdited, addedBefore?, added?}
 * @returns {Promise<{filled: number, details: {label, value}[]}>}
 */
export async function fillWorkday(doc, data, ctx) {
  let filled = 0;
  const details = [];
  for (const kind of ["work", "education", "languages", "websites", "certifications"]) {
    const entries = (data[kind] || []).slice(0, 10);
    let sec = workdaySections(doc).get(kind);
    if (!sec || !entries.length) continue;
    // One row per entry, with the section's own Add button. A new step filled
    // by itself (Super autofill) never re-adds rows already added once.
    let guard = 0;
    while (sec.rows.length < entries.length && sec.add && guard++ < 10 && !(ctx.auto && ctx.addedBefore?.(kind))) {
      const before = sec.rows.length;
      pointerClick(sec.add);
      if (!(await waitFor(() => (workdaySections(doc).get(kind)?.rows.length || 0) > before, ctx))) break;
      sec = workdaySections(doc).get(kind);
    }
    if (guard) ctx.added?.(kind);
    for (let i = 0; i < sec.rows.length && i < entries.length; i++) {
      if (await FILL[kind](ctx, sec.rows[i], entries[i], i + 1)) {
        filled++;
        details.push({ kind, row: i + 1 });
      }
    }
  }
  // Skills: a search prompt, one skill at a time, each the site's own entry
  // only, ~30 s for the box; the ones it doesn't offer are listed (spec 037).
  const skills = doc.querySelector(`${FF("skills")} input:not([type=checkbox])`);
  if (skills && data.skills?.length && wrote(await ctx.put(box(skills, "chips", "Skills"), data.skills.slice(0, 60)))) filled++;
  return { filled, details };
}

// ---- The older Work Experience API (kept for its callers and tests) -----------

/** Is this a Workday application with a Work Experience section? */
export function isWorkdayExperience(doc) {
  return !!doc?.querySelector?.(FF("jobTitle"));
}

/** Is this control inside a Workday Work-Experience block? */
export function inWorkExperience(el) {
  return !!el?.closest?.('[data-fkit-id^="workExperience-"]') || (inWorkdaySection(el) && rowKind(el.closest(ROW)) === "work");
}

/** Every Work Experience block on the page, in order (block 1 = most recent). */
export function collectWorkExperienceBlocks(doc) {
  if (!doc?.querySelectorAll) return [];
  return (workdaySections(doc).get("work")?.rows || []).map((root) => {
    const q = (sel) => root.querySelector(sel);
    return {
      root,
      title: q(`${FF("jobTitle")} input`),
      company: q(`${FF("companyName")} input`),
      location: q(`${FF("location")} input`),
      role: q(`${FF("roleDescription")} textarea`),
      current: q(`${FF("currentlyWorkHere")} input[type="checkbox"]`),
      startDate: q(FF("startDate")),
      endDate: q(FF("endDate")),
    };
  });
}

/** Fill the blocks currently on the page from the entries (block i ← entry i). */
export async function fillWorkExperience(blocks, entries, opts = {}) {
  const ctx = opts.put ? opts : plainContext(opts);
  let filled = 0;
  const details = [];
  for (let i = 0; i < blocks.length; i++) {
    const e = entries[i];
    if (!e) continue;
    if (await fillWork(ctx, blocks[i].root, e, i + 1)) {
      filled++;
      details.push({ label: `Work Experience ${i + 1}`, value: [e.title, e.company].filter(Boolean).join(" — ") });
    }
  }
  return { filled, details };
}

/** Full flow: add a block per résumé job with "Add Another", then fill them all. */
export async function fillAllWorkExperience(doc, entries, opts = {}) {
  const ctx = opts.put ? opts : plainContext(opts);
  const res = await fillWorkday(doc, { work: entries }, ctx);
  return { filled: res.filled, details: res.details };
}
