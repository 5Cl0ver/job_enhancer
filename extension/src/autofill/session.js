// One frame's fill: scan → decide → write → read back, then the AI pass for
// what's left; plus Fix, Undo and Show for the review in the side panel.
// Nothing is ever submitted, nothing the user typed is overwritten, and
// self-identification, agreements and essays are never touched.
import { answerKey, isCompanySpecific, normalizeQuestion, yesNo } from "./classify/answers.js";
import { PRIVATE, fieldGuard, profileKeyFor } from "./classify/profileKeys.js";
import { matchTaught } from "./fingerprint.js";
import { PERSONAL, classifySections, createJobBlocks, eduPart, eduValues, jobPart, jobValues } from "./classify/jobHistory.js";
import { siteKey } from "./hosts.js";
import { collectFields, hasFormHere, isSignupPage, looksLikeApplication, passwordShown } from "./scan.js";
import { COMPANY_KEYS, COMPUTED_KEYS, FORMAT_KEYS, IDENTITY, IDENTITY_KEYS, isResumeUpload, resolve } from "./resolve.js";

/** Case, spaces and punctuation don't count when deciding the user changed a box. */
const loose = (v) => String(v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Does what a box shows agree with an answer? Typed boxes exactly (case and
 * punctuation aside: "Platform Engineer" is NOT "Platform Engineer (Cloud)");
 * a list's shown choice as the list words it ("Washington (WA)"); a level
 * box by its own chooser.
 */
function agrees(field, now, value) {
  if (field.pick) return field.pick([{ label: String(now) }]) === 0;
  if (field.kind === "text" || field.kind === "textarea" || field.kind === "editable" || field.kind === "spin") {
    const d = (x) => String(x ?? "").replace(/\D/g, "");
    if (field.kind === "spin") return Number.parseInt(now, 10) === Number.parseInt(value, 10);
    return loose(now) === loose(value) || (d(now).length >= 7 && d(now) === d(value));
  }
  return same(now, value);
}
import { canRestore, hasValue, peekOptions, readField, restore, same, snapshot, writeField } from "./widgets.js";

const STYLE_ID = "jec-fill-style";
const STYLE = `
[data-jec-fill] { outline: 2px solid var(--jec-fill) !important; outline-offset: 2px !important; border-radius: 4px; }
[data-jec-fill="profile"] { --jec-fill: oklch(0.6 0.15 155 / .85); }
[data-jec-fill="learned"] { --jec-fill: oklch(0.6 0.17 250 / .85); }
[data-jec-fill="ai"], [data-jec-fill="history"] { --jec-fill: oklch(0.6 0.2 300 / .9); }
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
export const LEARNABLE_PROFILE = new Set([
  "first_name", "last_name", "phone", "address_line1", "address_line2", "city", "state",
  "postal_code", "country", "linkedin_url", "github_url", "portfolio_url",
  "authorized_to_work", "requires_sponsorship", "willing_to_relocate", "desired_salary", "notice_period",
]);
const BOOL_PROFILE = new Set(["authorized_to_work", "requires_sponsorship", "willing_to_relocate"]);
// Keys filled once per page (repeated education blocks: only the first).
const ONCE_KEYS = new Set(["school", "degree", "field_of_study", "graduation_year", "current_company", "current_title", "resume_file", "cover_letter_file", "cover_letter"]);
// Questions about a business, a recipient or someone's work line, not the user.
const NOT_MINE = /company|employer|business|office|work (phone|address)|recipient|shipping|billing|gift|delivery/i;

/**
 * A typed value as the profile stores it, or null when it can't be one
 * (a pay range, an hourly rate, a phone extension…), so a save never fails.
 */
export function profileValue(key, value) {
  if (BOOL_PROFILE.has(key)) {
    const b = yesNo(value);
    return b ? b === "yes" : null;
  }
  if (key === "desired_salary") {
    if (/[-–]|\bto\b|\/\s*h|hour|hr\b|month|week/i.test(value)) return null; // a range or not yearly
    const m = /^\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?$/i.exec(value.trim());
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    return n >= 1000 && n <= 5_000_000 ? Math.round(n) : null;
  }
  if (key === "phone") return value.replace(/\D/g, "").length >= 7 ? value : null;
  if (/_url$/.test(key)) {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(url).hostname.includes(".") ? url : null;
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * What a user may never point at and teach: self-identification and private
 * details (ID, bank…), agreements, choices the scanner couldn't read. A lone
 * checkbox that isn't an agreement is a yes/no answer like any other (spec
 * 034). Everything else is the user's call ("Notification email").
 */
export function pointRefusal(field) {
  const guard = fieldGuard(field);
  if (guard === "sensitive" || guard === "consent") return guard;
  if (field.kind === "unknown_choice") return "consent";
  return "";
}

/**
 * A box in an employment / education / references section (spec 018, US5):
 * a past job's part comes from the résumé's work history (that block's job),
 * a school's from its education (that block's school — spec 020); the user's
 * own details never go there.
 */
function sectionDecision(field, section, part, entry, copy) {
  if (part) {
    // The same guards as everywhere: a declaration, agreement or self-ID box
    // inside a job block is never ticked or typed in (a job's description
    // box may read as an essay question: that one is fine).
    const guard = fieldGuard(field);
    if (guard && !(guard === "essay" && part === "description")) return { skip: guard };
    // "I currently work here" ticked by the page for a job that ended: untick
    // it (a correction: a press only); left unticked otherwise, quietly.
    if (part === "current" && entry && !entry.current) return field.el.checked ? { values: ["No"], source: "profile", key: "job_current" } : { skip: "fine" };
    const values = section === "education" ? eduValues(part, entry, field) : jobValues(part, entry, field);
    if (values.length) return { values, source: "profile", key: `${section === "education" ? "edu" : "job"}_${part}` };
    // A past job that isn't current: its "I work here" box stays unticked, quietly.
    return { skip: part === "current" ? "fine" : "job_history" };
  }
  const d = resolve(field, copy);
  if (d.key && PERSONAL.has(d.key)) return { skip: section === "reference" ? "other_person" : "job_history", key: d.key };
  return d;
}

/** What a taught box gets: its profile answer or its typed text — never past a guard. */
function taughtDecision(field, t, copy) {
  const guard = pointRefusal(field);
  if (guard) return { skip: guard };
  if (t.profile_key) {
    const values = copy.values[t.profile_key] || [];
    return values.length ? { values, source: "profile", key: t.profile_key } : { skip: "no_data", key: t.profile_key };
  }
  return t.answer ? { values: [t.answer], source: "learned" } : { skip: "unknown" };
}

/** Is `el` inside `box`, across shadow-root boundaries? */
function within(box, el) {
  for (let n = el; n; n = n.parentNode || n.host) if (n === box) return true;
  return false;
}

const LEFT_FOR_YOU = new Set(["sensitive", "consent", "job_history", "essay", "unknown", "no_data", "no_option", "rejected", "other_person", "too_long"]);
const AI_KINDS = new Set(["text", "select", "radio", "buttons", "combobox", "checkbox_list", "date"]);

// A lone yes/no checkbox is answered Yes (ticked) or No (left unticked).
const optionLabels = (f) => (f.kind === "checkbox" ? ["Yes", "No"] : (f.options || []).map((o) => o.label).filter(Boolean).slice(0, 60));
// On a Create Account page only these are filled (spec 034): never a password.
const SIGNUP_KEYS = new Set(["email", "email_confirm"]);
const shortLabel = (q) => (q.length > 90 ? q.slice(0, 89) + "…" : q) || "Unlabelled field";

/** Still on the page: in it, and not inside a step the site hid (spec 029). */
function onPage(field) {
  const box = field.mark || field.el;
  if (!field.el?.isConnected || !box?.isConnected) return false;
  return typeof box.checkVisibility === "function" ? box.checkVisibility() : true;
}

/**
 * @param {{doc?: Document, send: (msg: object) => Promise<any>, onChange?: () => void,
 *          getShadow?: Function, visible?: Function, skipField?: (f) => boolean,
 *          scope?: () => Element|null}} deps
 *   scope: when it returns an element (an open pop-up), only fields inside it count.
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
  /** id → {field, item}: boxes that already held the right answer (Chrome's
   * own autofill, the page): "Already filled", never silently skipped (spec 034). */
  const already = new Map();
  /** Fields the user undid: an automatic run (keep filling) leaves them alone. */
  const declined = new Set();
  /** The résumé on this page: attached / no_box / no_file / failed (spec 026). */
  let resumeState = null;
  /** Where the résumé went up, and its name: a site may swap its box for the
   * file's name (Workday), but later steps at the same address aren't it. */
  let attachedOn = "";
  let attachedName = "";
  /** Fields already put to the AI: never asked twice (each step, each run). */
  const aiAsked = new Set();

  /** Boxes the user typed or chose in on this page: never changed by a fill (spec 020). */
  const userEdited = deps.userEdited || (() => false);

  /** Every box from the latest scan, the section fillers' own included (for "is there a form"). */
  let everything = [];
  const scan = () => {
    everything = collectFields(doc, { getShadow: deps.getShadow, visible: deps.visible });
    const all = everything.filter((f) => !skipField(f));
    // An open pop-up with a form of its own is filled alone; one whose fields
    // aren't really showing (a hidden drawer, a date picker) doesn't count.
    const inside = deps.scope?.() || null;
    const scoped = inside ? all.filter((f) => within(inside, f.el)) : all;
    const list = scoped.length ? scoped : all;
    // The same pop-up rule for "is there a form" (section fillers' boxes included).
    const near = inside ? everything.filter((f) => within(inside, f.el)) : [];
    if (near.length) everything = near;
    fields = new Map(list.map((f) => [f.id, f]));
    if (!inside) syncStep(all);
    return list;
  };

  /** The questions of the step on show: a one-address application (Workday)
   * moving to its next step starts a new record (spec 029). A pop-up over the
   * step, a step still loading, or rows added to it are the same step. */
  let stepKeys = new Set();
  function syncStep(list) {
    const now = new Set(list.map((f) => f.key).filter(Boolean));
    if (now.size < 2) return;
    if (stepKeys.size >= 2) {
      let same = 0;
      for (const k of stepKeys) if (now.has(k)) same++;
      if (same / stepKeys.size < 0.34) {
        filled.clear();
        needYou.clear();
        suggestions.clear();
        already.clear();
      }
    }
    stepKeys = now;
  }

  /**
   * The records whose box is on the page now. A box the site re-drew in place
   * (a new element for the same question, same step) is found again by its
   * question and kept; one hidden for now (a pop-up over it) is kept but not
   * listed; one gone with its step isn't listed.
   */
  function current(map) {
    const gone = (x) => !onPage(x.field) && !x.field.el?.isConnected;
    if ([...filled.values(), ...needYou.values(), ...suggestions.values(), ...already.values()].some(gone)) scan();
    const taken = new Set([...map.values()].filter((x) => onPage(x.field)).map((x) => x.field.el));
    const out = [];
    for (const x of map.values()) {
      if (onPage(x.field)) {
        out.push(x);
        continue;
      }
      if (!gone(x)) continue;
      const again = [...fields.values()].find((f) => f.key && f.key === x.field.key && f.kind === x.field.kind && !taken.has(f.el) && onPage(f));
      if (!again) continue;
      taken.add(again.el);
      x.field = again;
      out.push(x);
    }
    return out;
  }

  const appCheck = {
    isIdentity: (f) => IDENTITY.has(profileKeyFor(f) || "") || (f.kind === "file" && isResumeUpload(f)),
    isMapped: (f) => !!profileKeyFor(f) || (f.kind === "file" && isResumeUpload(f)),
  };
  const isApplication = () => looksLikeApplication(scan(), appCheck);

  /** A form worth filling here (the side panel offers Autofill when one is). */
  const hasForm = () => presence().form;

  /** One scan: is there a form, is it an application, how many fields. */
  /** @param {object[]} [taught] boxes taught on this site: a frame holding one has a form. */
  function presence(taught = []) {
    scan();
    const list = everything; // a page that's all résumé sections is still a form
    const app = looksLikeApplication(list, appCheck);
    const form = app || hasFormHere(list, { isApplication: () => app }) || (taught.length > 0 && matchTaught(taught, list).size > 0);
    // A Create Account page (spec 034): email only; a password box anywhere
    // (a sign-in page) — "Read the page again" says what it saw.
    const signup = isSignupPage(list);
    return { form, app, fields: list.length, ...(signup ? { signup: true } : {}), ...(passwordShown(doc) ? { password: true } : {}) };
  }

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
    already.delete(field.id);
    mark(field, source);
    return res;
  }

  /**
   * One box of a "retype your résumé" section, filled by a section filler
   * (sections/): the page's wrong value is corrected (Undo puts it back), the
   * user's own edits are never touched, a box already right is left as it is.
   * @param {object} field {id, el, kind, question, pick?}
   * @param {string[]} values
   */
  async function putSection(field, values, { correct = true } = {}) {
    if (!values?.length) return { skipped: "no_data" };
    if (declined.has(field.id) || userEdited(field.el)) return { skipped: "user" };
    const ours = filled.get(field.id);
    const now = readField(field);
    if (field.kind === "chips" && now.trim() && !correct) return { skipped: "has_value" };
    if (field.kind !== "chips") {
      if (ours && !agrees(field, now, ours.entry.value)) return { skipped: "user" }; // changed since: theirs
      if (now.trim() && values.some((v) => agrees(field, now, v))) return { ok: true, already: true };
      if (now.trim() && !ours && !correct) return { skipped: "has_value" };
    }
    const prior = !ours && now.trim() !== "";
    const res = await fillOne(field, values, "profile");
    if (res.ok && prior) filled.get(field.id).entry.corrected = true;
    if (!res.ok) leave(field, res.reason || "rejected");
    return res;
  }

  /** `key`: the profile answer a "Not in your profile yet" box wants (Add to profile, spec 034). */
  function leave(field, reason, saved, key) {
    if (!LEFT_FOR_YOU.has(reason)) return;
    needYou.set(field.id, {
      field,
      item: { id: field.id, label: shortLabel(field.question), reason, kind: field.kind, options: optionLabels(field), ...(saved ? { saved } : {}), ...(key && reason === "no_data" ? { key } : {}) },
    });
    if (reason !== "sensitive") mark(field, "need");
  }

  /** A box that already held the right answer: listed, never filled again. */
  function alreadyFilled(field, value) {
    if (filled.has(field.id)) return;
    already.set(field.id, { field, item: { id: field.id, label: shortLabel(field.question), kind: field.kind, value: String(value ?? "").slice(0, 200) } });
  }

  /**
   * Fill everything known, instantly. Fields that already hold something are
   * left as they are (the user's or the page's own value).
   * @param {import("./resolve.js").Copy} copy
   * @returns {Promise<{leftovers: object[]}>}
   */
  async function fillKnown(copy, { auto = false, onProgress, skipFiles = false } = {}) {
    const leftovers = [];
    if (!auto) declined.clear(); // a press means: fill again, undone ones too
    // A suggestion whose field left the page (a new step) is gone.
    for (const [id, x] of suggestions) if (!x.field.el.isConnected) suggestions.delete(id);
    // Education and the current job go into the FIRST block that asks.
    const once = new Set();
    const list = scan();
    // Boxes the user pointed at and taught on this site come first (spec 017).
    const site = siteKey(doc.location?.href || "");
    // (Boxes taught before 0.34 on Paycom/ADP are keyed by the host alone.)
    const host = doc.location?.hostname || "";
    const taught = matchTaught((copy.taught || []).filter((t) => t.site === site || t.site === host), list);
    copy = { ...copy, site, host }; // this site's own answers first (spec 018)
    // "Retype your résumé" sections: which past job or school each box belongs
    // to (spec 018, 020).
    const sections = classifySections(list);
    const blockOf = createJobBlocks();
    const schoolOf = createJobBlocks();
    // A Create Account page (spec 034): the email (and "confirm email") only.
    // Passwords are never even seen (scan.js leaves them out); the agreement
    // is listed for the user; anything else (a security question) is theirs.
    const signup = isSignupPage(everything);
    let i = 0;
    for (const field of list) {
      onProgress?.(++i, list.length);
      const section = sections.get(field.id) || "";
      const part = section === "job" ? jobPart(field) : section === "education" ? eduPart(field) : "";
      const block = part ? (section === "job" ? blockOf : schoolOf)(part, field) : 0;
      if (declined.has(field.id)) continue;
      // Filled by Job Catcher before: left — except a past job's or school's
      // part on a press, still as we left it, which follows the résumé now
      // chosen (another résumé picked since the last press).
      const mine = filled.get(field.id);
      if (mine && (auto || !part || !agrees(field, readField(field), mine.entry.value))) continue;
      // A box the page filled itself: left alone — except a past job's or a
      // school's part, which is corrected from the résumé when it's wrong
      // (an applicant system's own résumé reading cuts titles; spec 020).
      const prefilled = field.kind !== "file" && hasValue(field);
      // (Only on a press: on a step filled by itself, a filled box stays as it is.)
      if (prefilled && (auto || !part || taught.has(field.id) || userEdited(field.el))) {
        // Already holding what Job Catcher would put there (Chrome's own
        // autofill put the email in): "Already filled", not silence (spec 034).
        if (!mine && !part && !taught.has(field.id) && !userEdited(field.el)) {
          const d = resolve(field, copy);
          const now = readField(field);
          if (!d.skip && (!signup || SIGNUP_KEYS.has(d.key)) && d.values.some((v) => agrees(field, now, v))) alreadyFilled(field, now);
        }
        continue;
      }
      if (field.kind === "file" && (field.el.files?.length || skipFiles)) continue;
      // The résumé is already up on this page (the site re-drew its box
      // empty): never a second copy (spec 029).
      if (field.kind === "file" && resumeShown() && isResumeUpload(field)) continue;
      // A box that shows the résumé's name is the résumé's: never a cover
      // letter (or anything else) in it (spec 031).
      if (field.kind === "file" && attachedName && [(field.mark || field.el)?.textContent, field.hints?.area].join(" ").includes(attachedName)) continue;
      const entry = section === "education" ? copy.history?.education?.[block] : copy.history?.work?.[block];
      const d = taught.has(field.id)
        ? taughtDecision(field, taught.get(field.id), copy)
        : section
          ? sectionDecision(field, section, part, entry, copy)
          : resolve(field, copy);
      if (signup && !(d.key && SIGNUP_KEYS.has(d.key))) {
        if (d.skip === "consent") leave(field, "consent");
        continue;
      }
      if (prefilled) {
        if (d.skip) continue; // nothing better to put there: the page's stays
        const now = readField(field);
        if (d.values.some((v) => agrees(field, now, v))) continue;
        const res = await fillOne(field, d.values, d.source);
        if (res.ok) filled.get(field.id).entry.corrected = true;
        continue;
      }
      if (d.skip) {
        // A yes/no checkbox nobody requires: unticked already says no (spec 034).
        if (d.quiet) continue;
        if (d.skip === "unknown" && AI_KINDS.has(field.kind)) leftovers.push(field);
        // An essay answer saved before, or an answer to a near rewording, is
        // offered ("Use saved answer"), never filled.
        const saved = d.skip === "essay" ? (copy.answers || []).find((a) => a.question_key === answerKey("essay", "", field.key))?.answer : d.offer;
        leave(field, d.skip, saved, d.key);
        continue;
      }
      if (ONCE_KEYS.has(d.key)) {
        if (once.has(d.key)) continue;
        once.add(d.key);
      }
      const res = await fillOne(field, d.values, d.source);
      if (!res.ok) leave(field, res.reason || "rejected");
    }
    return { leftovers: leftovers.filter((f) => !aiAsked.has(f.id)), seen: list.length };
  }

  /** Did the résumé go up on this page, and does the page still show it? */
  function resumeShown() {
    const here = doc.location?.href || "";
    return attachedOn === here && !!attachedName && (doc.body?.textContent || "").includes(attachedName);
  }

  /**
   * Upload the résumé before anything else: many applicant systems read it
   * and rewrite the form (spec 016, research R7). True when one was uploaded.
   */
  async function uploadResume(copy, { auto = false } = {}) {
    if (!auto) declined.clear(); // a press means: fill again, undone ones too
    const boxes = scan().filter((f) => f.kind === "file" && isResumeUpload(f));
    const here = doc.location?.href || "";
    // What happened to the résumé on this page, for Apply with Claude (spec 026).
    const state = (s) => ((resumeState = s), false);
    // Already up on this page and still shown: never again, even when the
    // site re-draws its upload box empty afterwards (Workday, spec 029).
    if (resumeShown()) return state("attached");
    if (!boxes.length) return state("no_box");
    if (boxes.some((f) => f.el.files?.length || filled.has(f.id))) return state("attached");
    if (!copy.resumeFile) return state("no_file");
    let tried = false;
    for (const field of boxes) {
      if (declined.has(field.id)) continue;
      const d = resolve(field, copy);
      if (d.skip) continue;
      tried = true;
      const res = await fillOne(field, d.values, d.source);
      if (res.ok) {
        state("attached");
        attachedOn = here;
        attachedName = copy.resumeFile.name || "";
        return true; // one résumé per page, never into a second box
      }
    }
    if (tried) state("failed");
    return false;
  }

  /**
   * Fill a box the user pointed at (spec 017) — even one the scanner left
   * out — with a profile answer or typed text. Agreements, self-ID and
   * private questions are never filled this way either.
   */
  async function fillPicked(field, values, source) {
    const guard = pointRefusal(field);
    if (guard) return { ok: false, reason: guard };
    fields.set(field.id, field);
    declined.delete(field.id);
    return fillOne(field, values, source);
  }

  /** One request for everything left: the app's AI answers from the user's data. */
  async function fillWithAi(leftovers) {
    if (!leftovers.length) return 0;
    const asked = [];
    for (const f of leftovers.slice(0, 40)) {
      aiAsked.add(f.id);
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

  /** The review the side panel shows (serializable): the boxes on the page
   * NOW. A one-address application (Workday) swaps its steps in place, and
   * the last step's boxes must never be reported again (spec 029). */
  function report() {
    return {
      url: doc.location?.href || "",
      resume: resumeState,
      entries: current(filled).map((x) => x.entry),
      need_you: current(needYou)
        .filter((x) => !hasValue(x.field) && !suggestions.has(x.field.id))
        .map((x) => x.item),
      suggestions: current(suggestions)
        .filter((x) => !hasValue(x.field))
        .map((x) => x.item),
      already: current(already)
        .filter((x) => hasValue(x.field) && !filled.has(x.field.id))
        .map((x) => x.item),
      ...(isSignupPage(everything) ? { signup: true } : {}),
    };
  }

  /** Put text in a box from the panel ("Use saved answer"): filled, not remembered again. */
  async function useText(id, value) {
    const field = find(id);
    if (!field || !value) return { ok: false };
    return fillOne(field, [value], "learned");
  }

  /**
   * "Add to profile" (spec 034): the value the user just saved to their
   * profile goes in this box (its other wordings too: "OR" / "Oregon").
   * Never past a guard (self-ID, agreements, passwords are never here).
   */
  async function useProfile(id, values) {
    const field = find(id);
    const list = (values || []).map(String).filter(Boolean);
    if (!field || !list.length || pointRefusal(field)) return { ok: false };
    return fillOne(field, list, "profile");
  }

  /** Use an AI suggestion (the user's tap): it fills like a sure answer. */
  async function useSuggestion(id) {
    const s = suggestions.get(id);
    if (!s) return { ok: false };
    // Gone from the page, or the user answered it meanwhile: drop it.
    if (!s.field.el.isConnected || hasValue(s.field)) {
      suggestions.delete(id);
      return { ok: false };
    }
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
    const seen = new Map(); // key → how many fields on the page ask for it
    const list = scan();
    for (const field of list) {
      const key = profileKeyFor(field);
      if (key) seen.set(key, (seen.get(key) || 0) + 1);
    }
    const sections = classifySections(list);
    for (const field of list) {
      const key = profileKeyFor(field);
      if (!LEARNABLE_PROFILE.has(key)) continue;
      if (sections.has(field.id)) continue; // a past job's, a school's or a reference's — not the user's
      // Two fields asking the same (yours and a company's, a shipping address)
      // or a question about a business: not clearly the user's own.
      if (seen.get(key) > 1 || NOT_MINE.test(field.question)) continue;
      const ours = filled.get(field.id);
      const value = readField(field).trim();
      if (!value || value.length > 200) continue;
      if (ours && same(value, ours.entry.value)) continue; // ours, untouched
      if ((known[key] || []).some((k) => same(value, k))) continue; // already saved
      const v = profileValue(key, value);
      if (v !== null) out[key] = v;
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
    // A custom question's fix is remembered for next time (FR-014); one about
    // this company ("Have you worked for us before?") for this company only.
    // Never an agreement or a self-ID answer (they're never filled or fixed).
    if (!profileKeyFor(field) && field.key && field.kind !== "file" && !pointRefusal(field) && !PRIVATE.test(field.question)) {
      const site = siteKey(doc.location?.href || "");
      const company = isCompanySpecific(field.question);
      const answer = { question_text: field.question.slice(0, 500), answer: String(res.actual || value).slice(0, 2000) };
      const answers = [];
      // This company's question: this site only. A tick box: this site (it's
      // ticked here next time) and, unless about this company, every site
      // (only offered there). Anything else: every site.
      if (site && (company || field.kind === "checkbox")) answers.push({ question_key: answerKey("site", site, field.key), ...answer });
      if (!company) answers.push({ question_key: field.key, ...answer });
      if (answers.length) await send({ type: "saveCustomAnswers", answers }).catch(() => null);
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
      const unchanged =
        now === ours ||
        (now.replace(/\D/g, "").length >= 7 && now.replace(/\D/g, "") === ours.replace(/\D/g, "")) ||
        // A box we ticked or unticked reads "Yes" / "": still as we left it?
        (x.field.kind === "checkbox" && (now === "Yes") === (ours === "Yes")) ||
        (x.field.kind !== "text" && x.field.kind !== "textarea" && same(now, ours));
      if (x.field.kind !== "file" && !unchanged) {
        filled.delete(k);
        unmark(x.field);
        continue;
      }
      if (await restore(x.field, x.snap)) {
        filled.delete(k);
        declined.add(k);
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
    const sections = classifySections(list);
    const keyCount = new Map();
    for (const f of list) keyCount.set(f.key, (keyCount.get(f.key) || 0) + 1);
    for (const field of list) {
      // Agreements, private numbers, and questions we can't tell apart (two
      // fields read as the same question) are never remembered. A lone
      // checkbox that isn't an agreement is a yes/no answer (spec 034).
      if (PRIVATE.test(field.question) || keyCount.get(field.key) > 1) continue;
      if (field.kind === "checkbox" && fieldGuard(field)) continue;
      // Something we filled counts only if the user has since changed it.
      const ours = filled.get(field.id);
      if (field.kind === "checkbox") {
        // Ticked by the user ("Yes"), or a box Job Catcher ticked that the
        // user unticked ("No"); an untouched unticked box says nothing new.
        const ticked = !!field.el.checked;
        if (ours ? (ours.entry.value === "Yes") === ticked : !ticked) continue;
        if (!field.key || field.key.length < 3 || sections.has(field.id)) continue;
        const one = { question_key: normalizeQuestion(field.question), question_text: field.question.slice(0, 500), answer: ticked ? "Yes" : "No" };
        // Kept for this site (ticked here next time) and, unless it's about
        // this company, for every site — where it's only offered, never
        // ticked by itself (spec 034 review).
        out.push({ ...one, company: true });
        if (!isCompanySpecific(field.question)) out.push(one);
        continue;
      }
      if (ours && readField(field).trim() === ours.entry.value.trim()) continue; // ours, untouched
      if (field.kind === "file" || !field.key || field.key.length < 3) continue;
      const kind = sections.get(field.id);
      if (kind === "job" || kind === "reference") continue; // about one past job / one person: never a general answer
      // A box the profile answers (spec 020): a correction of what Job Catcher
      // put there is learned for that kind of box on every site — never the
      // legal name or email (only an explicit point-and-save changes those).
      // A box Job Catcher didn't fill is left to the profile save (typedProfile).
      const profileKey = profileKeyFor(field);
      // Pay, or a question about this company: kept for this company only.
      if (profileKey && (COMPANY_KEYS.has(profileKey) || isCompanySpecific(field.question))) {
        const answer = readField(field).trim();
        if (!answer || answer.length > 300 || (ours && loose(answer) === loose(ours.entry.value))) continue;
        out.push({ question_key: normalizeQuestion(field.question), question_text: field.question.slice(0, 500), answer, company: true });
        continue;
      }
      if (profileKey) {
        if (!ours || IDENTITY_KEYS.has(profileKey) || COMPUTED_KEYS.has(profileKey) || FORMAT_KEYS.has(profileKey)) continue;
        const answer = readField(field).trim();
        if (!answer || answer.length > 300) continue;
        // The site reformatted what Job Catcher put ("oregon" → "Oregon"): no change.
        if (loose(answer) === loose(ours.entry.value)) continue;
        out.push({ question_key: `@${profileKey}`, question_text: field.question.slice(0, 500), answer });
        continue;
      }
      const d = resolve(field, { values: {}, answers: [] });
      // Essays are kept as saved answers (offered, never filled); sensitive
      // questions and agreements are never kept.
      const essay = d.skip === "essay";
      if (d.skip && d.skip !== "unknown" && !essay) continue;
      const answer = readField(field).trim();
      if (!answer || answer.length > (essay ? 4000 : 500)) continue;
      out.push({
        question_key: normalizeQuestion(field.question),
        question_text: field.question.slice(0, 500),
        answer,
        ...(essay ? { essay: true } : {}),
        ...(isCompanySpecific(field.question) ? { company: true } : {}),
      });
    }
    return out;
  }

  return {
    scan,
    putSection,
    leaveField: leave,
    isApplication,
    hasForm,
    presence,
    fillPicked,
    useText,
    useProfile,
    /** What Job Catcher put in a box, if it filled it: {source, value}. */
    filledEntry: (id) => filled.get(id)?.entry || null,
    uploadResume,
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
