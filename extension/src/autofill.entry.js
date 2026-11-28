// Autofill, in every frame of every https page (spec 015, 016). Nothing is
// drawn on the page but the outlines on the fields it filled: everything is
// managed from the side panel and the toolbar icon (spec 016, a user decision).
//
// Each frame tells the background whether it holds a form worth filling, so
// the panel can offer Autofill on any page with one, whatever its address, and
// the toolbar icon shows ⚡. A press (panel, toolbar or shortcut) fills every
// frame with a form instantly, from the copy of your details the extension
// keeps, then the app's AI answers what's left; progress and the result go to
// the panel as one status line. It NEVER submits.
//
// The work happens in src/autofill/: scan.js (find fields) → resolve.js (decide)
// → widgets.js (write + read back) → session.js (the fill, Fix, Undo).
import { claimPage, runtimeGone, sweepLegacy } from "./orphan.js";
import { removeUi } from "./ui/onpage.js";
import { hasValue, readField, shownValue, writingNow, writtenValue } from "./autofill/widgets.js";
import { isPlaceholderOption } from "./autofill/classify/answers.js";
import { fieldGuard, profileKeyFor, profileValues } from "./autofill/classify/profileKeys.js";
import { fingerprintOf, matchTaught } from "./autofill/fingerprint.js";
import { createPicker } from "./autofill/pick.js";
import { frameReport } from "./autofill/report.js";
import { collectFields, fieldId, hasOwnQuestion, questionFor } from "./autofill/scan.js";
import { companyKnown, siteKey } from "./autofill/hosts.js";
import { learnKeyFor, resolve } from "./autofill/resolve.js";
import { createSession, pointRefusal } from "./autofill/session.js";
import { AI_IN_AUTOFILL } from "./autofill/flags.js";
import { watchForSubmit } from "./autofill/track.js";
import { watchApplyPresses } from "./autofill/applyClick.js";
import { extractFromJsonLd } from "./extract/jsonld.js";

/** The hiring company in the page's own job data (JSON-LD), or "". */
function pageJobCompany(doc) {
  try {
    return extractFromJsonLd(doc, location.href)?.company || "";
  } catch {
    return "";
  }
}
import { startApplyMode } from "./autofill/applyMode.js";
import { pageAnswers, stepName } from "./autofill/applyPage.js";
import { editKey, fillSections, inWorkdaySection, isWorkdaySections } from "./autofill/sections/index.js";

// This copy owns the page (see orphan.js): drop what older copies drew.
const isCurrent = claimPage("autofill");
for (const el of document.querySelectorAll("#jec-autofill, #jec-remember, #jec-autofill-panel, #jec-review-panel, #jec-autofill-style")) {
  el.remove(); // 0.28 and 0.29, before the shadow-root pill
}
removeUi("autofill"); // the on-page pill of 0.30–0.31
sweepLegacy("#je-autofill-btn, #je-remember-btn, #je-autofill-panel, #je-review-panel, #je-autofill-style");

const TOP = window === window.top;

/** sendMessage that never throws (an orphaned copy just gets null). */
function send(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

// The user's own press on an Apply that leaves for the company's site (spec
// 040): the background carries the saved job along only right after one.
watchApplyPresses(document, () => {
  if (isCurrent()) send({ type: "applyPressed" });
});

// ---- Pop-ups ------------------------------------------------------------------
// While a pop-up holding a form is open, only its fields are filled: what's
// behind it is out of sight, and may be another form (spec 016, research R9).

const MODALS =
  'dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"], mat-dialog-container, sdf-dialog, sdf-modal, sdf-focus-pane[data-sdf-modal]';
// Boxes a person types into: a cookie-preferences pop-up (only switches) or a
// date picker (month and year lists) never counts.
const TEXTISH = "input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], textarea";

/** Really on screen: not hidden, not see-through, not parked off the page. */
function showing(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  const s = getComputedStyle(el);
  return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
}

const BLOCKING = 'dialog[open], [aria-modal="true"], mat-dialog-container, sdf-dialog, sdf-modal, sdf-focus-pane[data-sdf-modal]';
const ANY_BOX = "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox]";

function openModal() {
  const shown = [...document.querySelectorAll(MODALS)].filter((el) => {
    if (!showing(el)) return false;
    // A blocking pop-up (it hides the page) with any box at all; any other
    // dialog only with two boxes to type in (not a cookie banner's switches).
    if (el.matches(BLOCKING)) return [...el.querySelectorAll(ANY_BOX)].some((c) => c.getClientRects().length);
    return [...el.querySelectorAll(TEXTISH)].filter(showing).length >= 2;
  });
  // The innermost, last-opened one (a pop-up inside a page-wide wrapper).
  return shown.filter((el) => !shown.some((o) => o !== el && el.contains(o))).pop() || null;
}

// Boxes the user typed in or chose on this page (spec 020): a fill never
// changes them. Only a REAL change counts — a trusted input/change (or a
// choice made with a click) while Job Catcher isn't writing, leaving the box
// different from what Job Catcher last put there and from what it held
// before the user touched it. Focus and blur alone never count (Job
// Catcher's own focus moves fire trusted blurs). Remembered per tab by where
// the box is, so a page that redraws its rows (Workday's Back, a resumed
// draft) still knows: a box showing what the user left in it is theirs.
const userEdited = new WeakSet();
const beforeUser = new WeakMap(); // box → what it held when the user started on it
let savedEdits = {}; // where → what the user left there (this tab, this site)
const CONTROL = 'input, textarea, select, [role="combobox"], [contenteditable="true"], button[aria-haspopup]';
const controlOf = (e) => (e.composedPath?.()[0] || e.target)?.closest?.(CONTROL) || null;

function rememberEdit(el) {
  try {
    const key = editKey(el);
    if (!key) return;
    const value = shownValue(el);
    savedEdits[key] = value;
    send({ type: "userEdit", key, value });
  } catch {
    /* a box gone mid-way */
  }
}

/** Did the user really change this box (not Job Catcher, not just a visit)? */
function reallyChanged(el) {
  const now = shownValue(el);
  if (now === writtenValue(el)) return false;
  return !beforeUser.has(el) || now !== beforeUser.get(el);
}

function startTouch(e) {
  if (!e.isTrusted || writingNow()) return;
  const el = controlOf(e);
  if (el && !beforeUser.has(el)) beforeUser.set(el, shownValue(el));
}
for (const type of ["keydown", "pointerdown", "paste", "drop"]) document.addEventListener(type, startTouch, true);

function noteUser(e) {
  if (!e.isTrusted || writingNow()) return;
  const el = controlOf(e);
  if (!el || !reallyChanged(el)) return;
  userEdited.add(el);
  if (e.type === "change") rememberEdit(el);
}
for (const type of ["input", "change"]) document.addEventListener(type, noteUser, true);
// A list drawn as a button: its choice shows in the button once made.
document.addEventListener(
  "click",
  (e) => {
    if (!e.isTrusted || writingNow()) return;
    const btn = e.target?.closest?.('button[aria-haspopup="listbox"]');
    if (!btn) return;
    setTimeout(() => {
      if (writingNow() || !btn.isConnected || !reallyChanged(btn)) return;
      userEdited.add(btn);
      rememberEdit(btn);
    }, 1500);
  },
  true,
);
function isUsers(el) {
  if (userEdited.has(el)) return true;
  try {
    const key = editKey(el);
    return !!key && key in savedEdits && savedEdits[key] === shownValue(el);
  } catch {
    return false;
  }
}

const session = createSession({
  send,
  // Workday's résumé rows (jobs, schools, languages…) are filled by sections/.
  skipField: (f) => inWorkdaySection(f.el),
  userEdited: isUsers,
  scope: openModal,
  // Each file box tried, kept for the tab (spec 037): never attached twice.
  onFileTried: (key, state) => send({ type: "fileTried", key, state }),
});

let state = "idle"; // idle | busy
let lastReport = { filled: 0, need: 0, already: 0 };
// Keep filling (spec 015, Story 4): each later step of the same application
// fills as it appears. It starts with a press when SUPER AUTOFILL is on (the
// panel's checkbox, on by default, kept in chrome.storage.sync so every
// computer has it — spec 018); off, nothing fills without a press.
// Remembered per tab and site by the background, so it carries across loads.
let keepOn = false;
let keepUserOff = false; // switched off in the panel: a press doesn't turn it back on
let usedHere = false; // autofill ran on this page (learning only notices then)
let lastStep = "";
let lastCopy = null; // the profile's answers, for noticing typed ones
const choicesSeen = new Map(); // a dropdown's choices, once the fill opened it (spec 033)
let taughtHere = []; // boxes the user taught on this site (spec 017)
let resumeDone = false; // the résumé already went up in this application (spec 018)

// ---- Status for the side panel ------------------------------------------------

let statusAt = 0;
/** What this frame is doing, for the panel's status line (throttled). */
function status(s, { now = false } = {}) {
  if (!now && s.phase === "filling" && Date.now() - statusAt < 150) return;
  statusAt = Date.now();
  send({ type: "fillStatus", status: s });
}

// ---- Is there a form here? ------------------------------------------------------
// Asked on page changes, so kept cheap on busy pages: the full scan runs only
// when the set of form controls on screen changed (or, on a page with none in
// plain sight, at most every 10 s for forms inside components).

let checkTimer;
let lastSig = "";
let lastCheck = 0;
let lastPresence = { form: false, app: false, fields: 0, inModal: false };
let lastSent = "";
const CONTROLS = "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox]";

function presenceNow() {
  // Count only controls on screen: a form opened later (a pop-up) changes it.
  const n = [...document.querySelectorAll(CONTROLS)].filter((el) => el.getClientRects().length).length;
  const sig = `${location.href}|${n}`;
  const now = Date.now();
  if (sig === lastSig && (n > 0 || now - lastCheck < 10_000)) return lastPresence;
  lastSig = sig;
  lastCheck = now;
  lastPresence = { ...session.presence(taughtHere), inModal: !!openModal() };
  return lastPresence;
}

/** Tell the background when this frame's form appears, changes or goes. */
function check() {
  if (!isCurrent()) return;
  if (state === "busy") {
    // Mid-fill the page is ours to change: look again once it's done.
    checkTimer ||= setTimeout(() => {
      checkTimer = null;
      check();
    }, 300);
    return;
  }
  const p = presenceNow();
  const key = JSON.stringify([location.href, p.form, p.app, p.fields, p.inModal, !!p.signup]);
  if (key !== lastSent && (p.form || lastSent)) {
    lastSent = p.form ? key : "";
    send({ type: "formPresence", presence: { ...p, at: Date.now() } });
  }
  // A new step of an application being filled: fill it too.
  if (p.app && keepOn && state !== "busy") {
    const step = session.stepFingerprint();
    if (step && step !== lastStep) {
      lastStep = step;
      run({ auto: true });
    }
  }
}

// ---- Filling ----------------------------------------------------------------

/** `action`: after a panel action (Fix, Undo, Use…), never a fill's report (spec 037). */
function report({ action = false } = {}) {
  const r = session.report();
  lastReport = { filled: r.entries.length, need: r.need_you.length, already: (r.already || []).length };
  send({ type: "sessionUpdate", session: action ? { ...r, action: true } : r });
  return r;
}

async function loadCopy() {
  const res = await send({ type: "getAutofillCopy" });
  if (!res?.signedIn) return { signedOut: true };
  if (!res.copy) return { unreachable: true };
  const fileOf = (f, fallback) => {
    if (!f?.b64) return null;
    try {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      return new File([bytes], f.filename || fallback, { type: f.mime || "application/pdf" });
    } catch {
      return null; // a corrupt transfer: fill everything else
    }
  };
  const resumeFile = fileOf(res.resume, "resume.pdf");
  // The job's cover letter (spec 031): its PDF for an upload box, its text for a text box.
  const coverLetterFile = fileOf(res.coverLetter, "Cover letter.pdf");
  const copy = res.copy || {};
  lastCopy = {
    values: profileValues(copy.profile, copy.email, new Date(), copy.history),
    answers: copy.answers || [],
    taught: copy.taught || [],
    history: copy.history || null,
    languages: copy.profile?.languages || [],
    resumeFile,
    // Its text, for a "paste your résumé" box (spec 040).
    resumeText: res.resume?.text || "",
    resumeId: res.resumeId || null,
    coverLetterFile,
    coverLetterText: res.coverLetter?.text || "",
    // Which company this application is for ("have you worked for us
    // before?", spec 034): the linked saved job's, else the page's own job
    // data — never a guess from the site's address ("jj", "pg"…).
    company: res.company || pageJobCompany(document),
  };
  return lastCopy;
}

/**
 * After the résumé upload: if the page rebuilds its form from it (form
 * controls added or removed), wait until that stops — quiet for `quietMs`, at
 * most `capMs`. A page that doesn't rebuild within `firstMs` isn't waited on;
 * other page changes (a ticker, an animation) never count.
 */
function settle({ firstMs = 700, quietMs = 500, capMs = 4000 } = {}) {
  const touchesForm = (nodes) =>
    [...nodes].some((n) => n.nodeType === 1 && (n.matches(CONTROLS) || n.querySelector?.(CONTROLS)));
  return new Promise((resolve) => {
    let quiet;
    const done = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve();
    };
    const observer = new MutationObserver((records) => {
      if (!records.some((r) => touchesForm(r.addedNodes) || touchesForm(r.removedNodes))) return;
      clearTimeout(quiet);
      quiet = setTimeout(done, quietMs);
    });
    const cap = setTimeout(done, capMs);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    quiet = setTimeout(done, firstMs);
  });
}

async function run({ auto = false } = {}) {
  if (state === "busy" || !isCurrent()) return { ok: false, busy: state === "busy" };
  if (runtimeGone()) return { ok: false, refresh: true };
  state = "busy";
  try {
    return await fill(auto);
  } catch {
    // Never leave the panel saying "Filling…": say what to do instead.
    status({ phase: "problem", problem: "refresh" }, { now: true });
    return { ok: false };
  } finally {
    state = "idle";
  }
}

async function fill(auto) {
  status({ phase: "filling", done: 0, total: 0, note: "Getting your details…" }, { now: true });
  // The first use on a computer may wait for a sleeping server.
  const slow = setTimeout(() => status({ phase: "filling", done: 0, total: 0, note: "Waking up the app…" }, { now: true }), 1500);
  const copy = await loadCopy();
  clearTimeout(slow);
  if (copy.signedOut || copy.unreachable) {
    const problem = copy.signedOut ? "signed_out" : "asleep";
    status({ phase: "problem", problem }, { now: true });
    return { ok: false, signedIn: !copy.signedOut, unreachable: !!copy.unreachable };
  }

  // The résumé first: many applicant systems read it and rewrite the form.
  // On an automatic step of an application it already went up in: never again.
  const skipFiles = auto && resumeDone;
  // The file boxes already tried on this tab (a reload, an update): never again (spec 037).
  const files = await send({ type: "getFilesTried" });
  session.seedTried(files?.tried, files?.run || "");
  if (!skipFiles && (await session.uploadResume(copy, { auto }))) {
    resumeDone = true;
    send({ type: "resumeUploaded" });
    status({ phase: "filling", done: 0, total: 0, note: "Uploading your résumé…" }, { now: true });
    await settle();
  }

  // "Retype your résumé" sections (spec 020): jobs, schools, languages,
  // websites, certifications and skills — one row per entry of the chosen
  // résumé, added with the page's own Add button; a value the site put in
  // from its own résumé reading that's wrong is corrected (with Undo); the
  // user's own edits are never touched. A new step filled by itself never
  // re-adds rows. (Work history is read from the chosen résumé if the copy
  // doesn't have it yet.)
  if (!copy.history?.work?.length && isWorkdaySections(document)) {
    status({ phase: "filling", done: 0, total: 0, note: "Reading your résumé…" }, { now: true });
    const work = (await send({ type: "getWorkHistory", resumeId: copy.resumeId || null }))?.entries;
    if (work?.length) copy.history = { ...(copy.history || {}), work };
  }
  status({ phase: "filling", done: 0, total: 0, note: "Filling your résumé sections…" }, { now: true });
  savedEdits = { ...((await send({ type: "getUserEdits" }))?.edits || {}), ...savedEdits };
  await fillSections(document, copy, { session, auto, userEdited: isUsers });

  // Super autofill: a press starts filling every next step of this application.
  if (!auto && !keepOn && (await superAutofill())) {
    keepOn = true;
    send({ type: "setKeepFilling", on: true });
  }

  const { leftovers, seen } = await session.fillKnown(copy, {
    auto,
    skipFiles,
    onProgress: (done, total) => status({ phase: "filling", done, total, note: "Filling…" }),
  });
  usedHere = true;
  report();
  lastStep = session.stepFingerprint();
  if (AI_IN_AUTOFILL && leftovers.length) {
    const n = Math.min(leftovers.length, 40);
    const asking = { phase: "filling", done: lastReport.filled, total: lastReport.filled + n, note: `Asking the AI about ${n} question${n === 1 ? "" : "s"}…` };
    status(asking, { now: true });
    // Still working: the panel's "taking too long" only fires on real silence.
    const alive = setInterval(() => status(asking, { now: true }), 5000);
    try {
      await session.fillWithAi(leftovers);
    } finally {
      clearInterval(alive);
    }
    report();
  }
  status({ phase: "done", filled: lastReport.filled, need: lastReport.need, already: lastReport.already }, { now: true });
  // `seen`: how many fields this frame could see — 0 makes the background
  // read the page again before reporting (spec 017).
  return { ok: true, ...lastReport, seen };
}

/** The panel's Super autofill checkbox (on unless switched off). */
async function superAutofill() {
  try {
    const { je_super } = await chrome.storage.sync.get("je_super");
    return je_super !== false;
  } catch {
    return true;
  }
}

// ---- Learning (spec 015, Story 3) -------------------------------------------
// When the user moves on (Next, Continue, Submit, leaving the page), what they
// typed into questions the app didn't know — and profile answers it didn't have
// — is offered in the side panel to remember. Nothing is saved without a press.

// The whole label, exactly: "Save job", "Apply filters", "Next job" don't count.
const ADVANCE = /^(next( step)?|continue|save (and|&) continue|save (and|&) next|review( (my )?application)?|submit( (my )?application)?|apply|send( (my )?application)?|proceed)$/i;

let noticedAt = 0;
function notice() {
  if (!isCurrent() || Date.now() - noticedAt < 500) return;
  noticedAt = Date.now();
  // Only on an application the user is filling with Job Catcher — never a
  // checkout or any other form that merely looks similar.
  if (!usedHere || !presenceNow().app) return;
  const answers = session.typedAnswers();
  if (answers.length) send({ type: "answersNoticed", answers, site: siteKey(location.href), companyKnown: companyKnown(location.href) });
  if (lastCopy) {
    const fields = session.typedProfile(lastCopy.values);
    if (Object.keys(fields).length) send({ type: "profileNoticed", fields });
  }
}

function watchForAdvance() {
  document.addEventListener(
    "click",
    (e) => {
      const path = e.composedPath?.() || [];
      if (path.some((n) => /^JEC-UI-/i.test(n?.tagName || ""))) return; // our own on-page UI
      const b = path.find((n) => n?.matches?.('button, [role="button"], input[type="submit"]'));
      const label = (b?.value || b?.textContent || "").replace(/\s+/g, " ").trim();
      if (label && label.length <= 40 && ADVANCE.test(label)) notice();
    },
    true,
  );
  document.addEventListener("submit", notice, true);
  window.addEventListener("pagehide", notice);
}

// ---- Messages from the panel / background -----------------------------------

try {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!isCurrent()) {
      picker.stop(); // a newer copy owns the page: never leave pointing behind
      return;
    }
    if (msg?.type === "probeFill") {
      // The panel opened: say again whether there's a form here (no reply —
      // the answer goes to the background as formPresence).
      lastSig = "";
      lastSent = "";
      check();
      return;
    }
    if (msg?.type === "startPick") {
      picker.start();
      return;
    }
    if (msg?.type === "stopPick") {
      picker.stop();
      return;
    }
    if (msg?.type === "fillPicked") {
      if (!picked.has(msg.fieldId)) return; // another frame's box
      fillPickedNow(msg).then(reply, () => reply({ ok: false }));
      return true;
    }
    if (msg?.type === "runAutofill") {
      // A frame fills when it holds a form itself (not a chat widget, a
      // newsletter box or a payment frame); the top frame always tries.
      if (!TOP && !(msg.force ? presenceNow().form : session.isApplication())) return;
      run().then(reply, () => reply({ ok: false }));
      return true;
    }
    if (msg?.type === "fillAction") {
      const act = async () => {
        if (msg.action === "fix") return { ok: (await session.fix(msg.id, msg.value)).ok };
        if (msg.action === "undo") return { undone: await session.undo(msg.id || null) };
        if (msg.action === "show") return { ok: session.show(msg.id) };
        if (msg.action === "typed") return { answers: session.typedAnswers() };
        if (msg.action === "use") return { ok: (await session.useSuggestion(msg.id)).ok };
        if (msg.action === "useText") return { ok: (await session.useText(msg.id, msg.value)).ok };
        // Add to profile (spec 034): the value just saved to the profile.
        if (msg.action === "useProfile") return { ok: (await session.useProfile(msg.id, Array.isArray(msg.value) ? msg.value : [msg.value])).ok };
        if (msg.action === "keep") {
          keepOn = !!msg.value;
          keepUserOff = !msg.value;
          return { ok: true };
        }
        return { ok: false };
      };
      act().then((r) => {
        if (!["show", "typed", "keep"].includes(msg.action)) report({ action: true });
        reply(r);
      });
      return true;
    }
  });
} catch {
  /* orphaned */
}

// ---- What Job Catcher saw (spec 017) ------------------------------------------
// Read by the background with chrome.scripting (every frame, in this world):
// is this copy alive, and the frame's scan report — never a field's value.

function within(box, el) {
  for (let n = el; n; n = n.parentNode || n.host) if (n === box) return true;
  return false;
}

function scanReportNow() {
  const fields = session.scan();
  const r = session.report();
  const filled = new Map(r.entries.map((e) => [e.id, e.source]));
  const need = new Map(r.need_you.map((n) => [n.id, n.reason]));
  const modal = openModal();
  const decide = (f) => {
    if (filled.has(f.id)) return `filled (${filled.get(f.id)})`;
    if (need.has(f.id)) return `left for you (${need.get(f.id)})`;
    if (!lastCopy) {
      const key = profileKeyFor(f);
      return key ? `profile answer: ${key}` : "not a profile question";
    }
    const d = resolve(f, lastCopy);
    return d.skip ? `would leave: ${d.skip}${d.key ? ` (${d.key})` : ""}` : `would fill: ${d.source}${d.key ? ` (${d.key})` : ""}`;
  };
  return frameReport(document, { fields, decide, popupOpen: !!modal, inModal: (el) => !!modal && within(modal, el) });
}

// ---- Point at a box (spec 017) -------------------------------------------------
// The panel starts it in every frame; the frame whose box is clicked tells the
// background what it is (its question and fingerprint — never its value); the
// panel asks "What goes here?" and the answer is filled here, then remembered.

/** The scanned field for a picked control — even one the scanner left out. */
function fieldFor(control) {
  const fields = session.scan();
  const own = (f) => f.el === control || (f.options || []).some((o) => o.el === control) || f.mark === control || f.mark?.contains?.(control);
  let field = fields.find(own);
  if (field) return { field, fields };
  // Left out by the scanner (the reason the user is pointing): read it anyway.
  const all = collectFields(control.getRootNode?.() || document, { visible: () => true });
  field = all.find(own);
  if (field) return { field, fields: all };
  const type = (control.getAttribute?.("type") || "").toLowerCase();
  // A checkbox or radio the scanner couldn't read is never written as text.
  const kind = /^(checkbox|radio)$/.test(type) ? "unknown_choice" : control.tagName === "SELECT" ? "select" : control.tagName === "TEXTAREA" ? "textarea" : "text";
  return { field: { id: fieldId(control), kind, el: control, mark: control, question: questionFor(control), key: "", hints: { name: control.getAttribute("name") || "", id: control.id || "", type: control.getAttribute("type") || "" } }, fields: [] };
}

const picked = new Map(); // id → field, for the answer the panel sends back
const picker = createPicker({
  alive: () => isCurrent() && !runtimeGone(),
  labelFor: (el) => questionFor(el).slice(0, 60),
  onPick: async (control) => {
    const { field, fields } = fieldFor(control);
    picked.set(field.id, field);
    const type = (control.getAttribute?.("type") || "").toLowerCase();
    const refused = type === "password" ? "password" : pointRefusal(field);
    // Inspect (spec 018): what the box holds now, and what Job Catcher would
    // put there and why — shown only in the user's own panel. A refused box
    // (password, self-ID, agreement) never sends what it holds.
    const raw = refused ? "" : readField(field).trim();
    // Nothing real in it: empty, a "+1" on its own, "Please select".
    const value = raw && hasValue(field) && !isPlaceholderOption(raw) ? raw.slice(0, 2000) : "";
    let known = null;
    let taughtHereAlready = false;
    if (!refused) {
      const copy = lastCopy || (await loadCopy());
      if (!copy.signedOut && !copy.unreachable) {
        const site = siteKey(location.href);
        const t = matchTaught((copy.taught || []).filter((x) => x.site === site || x.site === location.hostname), fields).get(field.id);
        if (t) {
          taughtHereAlready = true;
          const v = t.profile_key ? copy.values[t.profile_key]?.[0] : t.answer;
          known = { source: "taught", key: t.profile_key || "", value: String(v ?? "").slice(0, 2000) };
        } else {
          const d = resolve(field, { ...copy, site });
          known = d.skip ? { source: "none", key: d.key || "" } : { source: d.source, key: d.key || "", value: String(d.values?.[0] ?? "").slice(0, 2000) };
        }
      }
    }
    // Saved by clicking only when it's the user's own answer in a box to type
    // in: not what Job Catcher just filled, not a box already taught, never a
    // file, an essay or a long text.
    const ours = session.filledEntry(field.id);
    const saveable =
      !!value &&
      !taughtHereAlready &&
      !(ours && String(ours.value).trim() === value) &&
      field.kind !== "file" &&
      fieldGuard(field) !== "essay" &&
      value.length <= 300;
    // Where a correction is remembered (spec 020): for this question on
    // every site, unless it's about this company only. Boxes inside a past
    // job's block belong to that job, so they stay with this box on this site.
    const site = siteKey(location.href);
    const inBlock = /\b(employ|experience|work history|education|reference)/i.test(field.hints?.section || "");
    const learn = refused || inBlock || !hasOwnQuestion(control) ? null : learnKeyFor(field, site);
    send({
      type: "picked",
      site,
      field: {
        id: field.id,
        label: (field.question || "").slice(0, 120),
        kind: field.kind,
        // A lone yes/no checkbox (spec 034): ticked (Yes) or not (No).
        options: field.kind === "checkbox" ? ["Yes", "No"] : (field.options || []).map((o) => o.label).filter(Boolean).slice(0, 60),
      },
      fingerprint: fingerprintOf(field, fields),
      refused,
      value,
      known,
      saveable,
      learn: learn && learn.scope !== "essay" ? { scope: learn.scope, key: learn.key, question_text: (field.question || "").slice(0, 500) || learn.key } : null,
    });
  },
  onCancel: () => send({ type: "pickCancelled" }),
});

async function fillPickedNow({ fieldId: id, profile_key, answer }) {
  const field = picked.get(id);
  if (!field?.el?.isConnected) return { ok: false, reason: "gone" };
  let values = answer ? [answer] : [];
  if (profile_key) {
    const copy = lastCopy || (await loadCopy());
    if (copy.signedOut || copy.unreachable) return { ok: false, reason: copy.signedOut ? "signed_out" : "asleep" };
    values = copy.values[profile_key] || [];
  }
  if (!values.length) return { ok: false, reason: "no_data" };
  const res = await session.fillPicked(field, values, profile_key ? "profile" : "learned");
  usedHere = true;
  report({ action: true });
  return { ok: !!res.ok, reason: res.reason, actual: res.ok ? String(res.actual ?? "") : "" };
}

globalThis.__jecAutofill = {
  alive: () => isCurrent() && !runtimeGone(),
  report: () => (isCurrent() ? scanReportNow() : null),
  // "Read the page again" (spec 034): what this frame sees, even with no form
  // here (a sign-in page's boxes), never a value.
  presence: () => (isCurrent() ? session.presence(taughtHere) : null),
  // Apply with Claude (spec 022): every question here with its answer, for
  // the photos' review. Read by the background in every frame.
  answers: () => (isCurrent() ? pageAnswers(session.scan(), readField) : []),
  // The live view (spec 026): the same, with what Job Catcher filled marked,
  // and each box's choices (spec 033), also the ones seen when filling a
  // dropdown that only shows them when opened (Workday).
  live: () => {
    if (!isCurrent()) return [];
    const report = session.report();
    for (const e of [...report.entries, ...(report.need_you || [])]) if (e.options?.length) choicesSeen.set(e.id, e.options);
    return pageAnswers(session.scan(), readField, new Set(report.entries.map((e) => e.id)), { choices: choicesSeen });
  },
  // The site's own name for the step on screen (spec 033).
  step: () => (isCurrent() ? stepName(document) : ""),
};

// ---- Start ----------------------------------------------------------------

function start() {
  if (!document.body || !isCurrent()) return;
  // Keep filling carries over from the last step's page (same tab, same site).
  send({ type: "getKeepFilling" }).then((r) => {
    keepOn = !!r?.on;
    keepUserOff = !!r?.userOff;
    resumeDone = !!r?.resumeDone;
    if (keepOn) usedHere = true; // the application they're filling, next page
    if (keepOn) check();
  });
  watchForAdvance();
  check();
  // A frame holding a box the user taught here counts as a form, however small.
  send({ type: "taughtHere", site: siteKey(location.href), host: location.hostname }).then((r) => {
    taughtHere = r?.taught || [];
    if (taughtHere.length) {
      lastSig = "";
      check();
    }
  });
  const observer = new MutationObserver(() => {
    if (!isCurrent()) {
      observer.disconnect();
      return;
    }
    // At most every 300 ms, even on a page that never stops changing.
    checkTimer ||= setTimeout(() => {
      checkTimer = null;
      check();
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden", "aria-hidden", "style", "class"] });
  watchForSubmit({ isCurrent, onSubmit: (job) => send({ type: "markApplied", job }) });
  // A frame going away (a pop-up's frame closed) takes its form with it.
  window.addEventListener("pagehide", () => {
    if (lastSent) send({ type: "formPresence", presence: { form: false } });
  });
  // ...and back from the back/forward cache: say so again.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    lastSig = "";
    lastSent = "";
    check();
  });
}

// A copy injected while the page is still loading waits for its body.
if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });

// Apply with Claude (spec 022): idle until the background says an application
// is open on this site; then Submit presses wait for the user's OK, and the
// top frame scrolls for the photos.
let applyMode = null;
try {
  applyMode = startApplyMode({ send, isCurrent, scan: () => session.scan(), readField });
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== "applyPage" || !isCurrent() || window.top !== window) return;
    Promise.resolve(applyMode.answer(msg))
      .then(reply)
      .catch(() => reply(null));
    return true;
  });
} catch {
  /* orphaned */
}
