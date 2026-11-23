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
import { profileKeyFor, profileValues } from "./autofill/classify/profileKeys.js";
import { fingerprintOf } from "./autofill/fingerprint.js";
import { createPicker } from "./autofill/pick.js";
import { frameReport } from "./autofill/report.js";
import { collectFields, fieldId, questionFor } from "./autofill/scan.js";
import { siteKey } from "./autofill/hosts.js";
import { pointRefusal } from "./autofill/session.js";
import { resolve } from "./autofill/resolve.js";
import { createSession } from "./autofill/session.js";
import { watchForSubmit } from "./autofill/track.js";
import { fillAllWorkExperience, inWorkExperience, isWorkdayExperience } from "./autofill/workday.js";

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

const session = createSession({
  send,
  // Workday's Work Experience blocks are filled from the résumé below.
  skipField: (f) => isWorkdayExperience(document) && inWorkExperience(f.el),
  scope: openModal,
});

let state = "idle"; // idle | busy
let lastReport = { filled: 0, need: 0 };
// Keep filling (spec 015, Story 4): after one press, each later step of the
// same application fills as it appears. Remembered per tab and site by the
// background, so it carries across page loads; switchable in the panel.
let keepOn = false;
let keepUserOff = false; // switched off in the panel: a press doesn't turn it back on
let usedHere = false; // autofill ran on this page (learning only notices then)
let lastStep = "";
let lastCopy = null; // the profile's answers, for noticing typed ones
let taughtHere = []; // boxes the user taught on this site (spec 017)

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
  const key = JSON.stringify([location.href, p.form, p.app, p.fields, p.inModal]);
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

function report() {
  const r = session.report();
  lastReport = { filled: r.entries.length, need: r.need_you.length };
  send({ type: "sessionUpdate", session: r });
  return r;
}

async function loadCopy() {
  const res = await send({ type: "getAutofillCopy" });
  if (!res?.signedIn) return { signedOut: true };
  if (!res.copy) return { unreachable: true };
  let resumeFile = null;
  if (res.resume?.b64) {
    try {
      const bytes = Uint8Array.from(atob(res.resume.b64), (c) => c.charCodeAt(0));
      resumeFile = new File([bytes], res.resume.filename || "resume.pdf", { type: res.resume.mime || "application/pdf" });
    } catch {
      /* a corrupt transfer: fill everything else */
    }
  }
  const copy = res.copy || {};
  lastCopy = {
    values: profileValues(copy.profile, copy.email, new Date(), copy.history),
    answers: copy.answers || [],
    taught: copy.taught || [],
    history: copy.history || null,
    resumeFile,
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
  if (await session.uploadResume(copy, { auto })) {
    status({ phase: "filling", done: 0, total: 0, note: "Uploading your résumé…" }, { now: true });
    await settle();
  }

  // Workday's Work Experience: one block per job on the résumé (read once
  // and held in the copy; asked for only if the copy doesn't have it yet).
  // An automatic run (a new step) fills these only while they're all empty —
  // never over the user's edits, never re-adding a block they removed.
  if (isWorkdayExperience(document) && (!auto || !workExperienceTouched())) {
    let work = copy.history?.work;
    if (!work?.length) {
      status({ phase: "filling", done: 0, total: 0, note: "Reading your résumé…" }, { now: true });
      work = (await send({ type: "getWorkHistory" }))?.entries;
    }
    if (work?.length) await fillAllWorkExperience(document, work);
  }

  const { leftovers, seen } = await session.fillKnown(copy, {
    auto,
    onProgress: (done, total) => status({ phase: "filling", done, total, note: "Filling…" }),
  });
  usedHere = true;
  report();
  lastStep = session.stepFingerprint();
  if (!auto && !keepOn && !keepUserOff) {
    keepOn = true; // on by default after a press (switch it off in the panel)
    send({ type: "setKeepFilling", on: true });
  }
  if (leftovers.length) {
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
  status({ phase: "done", filled: lastReport.filled, need: lastReport.need }, { now: true });
  // `seen`: how many fields this frame could see — 0 makes the background
  // read the page again before reporting (spec 017).
  return { ok: true, ...lastReport, seen };
}

/** Has anything in Workday's Work Experience been filled (by anyone)? */
function workExperienceTouched() {
  return [...document.querySelectorAll('[data-fkit-id^="workExperience-"] input:not([type=checkbox]), [data-fkit-id^="workExperience-"] textarea')].some(
    (el) => (el.value || "").trim() !== "",
  );
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
  if (answers.length) send({ type: "answersNoticed", answers });
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
        if (msg.action === "keep") {
          keepOn = !!msg.value;
          keepUserOff = !msg.value;
          return { ok: true };
        }
        return { ok: false };
      };
      act().then((r) => {
        if (!["show", "typed", "keep"].includes(msg.action)) report();
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
  onPick: (control) => {
    const { field, fields } = fieldFor(control);
    picked.set(field.id, field);
    const type = (control.getAttribute?.("type") || "").toLowerCase();
    const refused = type === "password" ? "password" : pointRefusal(field);
    send({
      type: "picked",
      site: siteKey(location.href),
      field: { id: field.id, label: (field.question || "").slice(0, 120), kind: field.kind, options: (field.options || []).map((o) => o.label).filter(Boolean).slice(0, 60) },
      fingerprint: fingerprintOf(field, fields),
      refused,
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
  report();
  return { ok: !!res.ok, reason: res.reason, actual: res.ok ? String(res.actual ?? "") : "" };
}

globalThis.__jecAutofill = {
  alive: () => isCurrent() && !runtimeGone(),
  report: () => (isCurrent() ? scanReportNow() : null),
};

// ---- Start ----------------------------------------------------------------

function start() {
  if (!document.body || !isCurrent()) return;
  // Keep filling carries over from the last step's page (same tab, same site).
  send({ type: "getKeepFilling" }).then((r) => {
    keepOn = !!r?.on;
    keepUserOff = !!r?.userOff;
    if (keepOn) usedHere = true; // the application they're filling, next page
    if (keepOn) check();
  });
  watchForAdvance();
  check();
  // A frame holding a box the user taught here counts as a form, however small.
  send({ type: "taughtHere", site: siteKey(location.href) }).then((r) => {
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
