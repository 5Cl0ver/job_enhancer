// Autofill, in every frame of every https page (spec 015). A small pill on
// pages that look like an application: one press fills every field the app
// knows — instantly, from the copy of your details the extension keeps — then
// the app's AI answers what's left. Every filled field is outlined by where its
// answer came from, and the side panel lists them all with Fix / Undo.
// It NEVER submits.
//
// The work happens in src/autofill/: scan.js (find fields) → resolve.js (decide)
// → widgets.js (write + read back) → session.js (the fill, Fix, Undo).
import { claimPage, runtimeGone, sweepLegacy } from "./orphan.js";
import { removeUi, uiRoot } from "./ui/onpage.js";
import { profileValues } from "./autofill/classify/profileKeys.js";
import { createSession } from "./autofill/session.js";
import { watchForSubmit } from "./autofill/track.js";
import { fillAllWorkExperience, inWorkExperience, isWorkdayExperience } from "./autofill/workday.js";

// This copy owns the page (see orphan.js): drop what older copies drew.
const isCurrent = claimPage("autofill");
for (const el of document.querySelectorAll("#jec-autofill, #jec-remember, #jec-autofill-panel, #jec-review-panel, #jec-autofill-style")) {
  el.remove(); // 0.28 and 0.29, before the shadow-root pill
}
removeUi("autofill");
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

const session = createSession({
  send,
  // Workday's Work Experience blocks are filled from the résumé below.
  skipField: (f) => isWorkdayExperience(document) && inWorkExperience(f.el),
});

let state = "idle"; // idle | busy | done | error
let lastReport = { filled: 0, need: 0 };
// Keep filling (spec 015, Story 4): after one press, each later step of the
// same application fills as it appears. Remembered per tab and site by the
// background, so it carries across page loads; switchable in the panel.
let keepOn = false;
let lastStep = "";
let lastCopy = null; // the profile's answers, for noticing typed ones

// ---- The pill --------------------------------------------------------------

function pill() {
  const root = uiRoot("autofill");
  let box = root.getElementById("jec-pill");
  if (box) return box;
  box = document.createElement("div");
  box.id = "jec-pill";
  box.className = "jec-pill";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Job Catcher autofill");
  const main = document.createElement("button");
  main.type = "button";
  main.id = "jec-autofill";
  main.className = "je-btn jec-pill-main";
  main.addEventListener("click", () => (state === "done" ? openReview() : run()));
  const review = document.createElement("button");
  review.type = "button";
  review.className = "jec-pill-link";
  review.textContent = "Review";
  review.addEventListener("click", openReview);
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "jec-pill-link";
  undo.textContent = "Undo";
  undo.addEventListener("click", async () => {
    await session.undo();
    report();
    setPill("idle");
  });
  box.append(main, review, undo);
  root.appendChild(box);
  setPill(state);
  return box;
}

function setPill(next, text) {
  state = next;
  const box = uiRoot("autofill").getElementById("jec-pill");
  if (!box) return;
  const main = box.querySelector(".jec-pill-main");
  box.dataset.state = next;
  main.dataset.state = next === "done" ? "saved" : next === "busy" ? "busy" : next === "error" ? "error" : "";
  main.textContent =
    text ||
    (next === "busy"
      ? "Filling…"
      : next === "done"
        ? `✓ ${lastReport.filled} filled${lastReport.need ? ` · ${lastReport.need} for you` : ""}`
        : "⚡ Autofill");
  for (const b of box.querySelectorAll(".jec-pill-link")) b.hidden = next !== "done";
}

function openReview() {
  send({ type: "openReview" });
}

// Is this an application? Asked on page changes, so kept cheap on busy pages:
// the full scan runs only when the set of form controls changed (or, on a page
// with none in plain sight, at most every 10 s for forms inside components).
let ensureTimer;
let lastSig = "";
let lastCheck = 0;
let lastAnswer = false;
const CONTROLS = "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox]";
function looksLikeApplicationNow() {
  // Count only controls on screen: a form opened later (a dialog) changes it.
  const n = [...document.querySelectorAll(CONTROLS)].filter((el) => el.getClientRects().length).length;
  const sig = `${location.href}|${n}`;
  const now = Date.now();
  if (sig === lastSig && (n > 0 || now - lastCheck < 10_000)) return lastAnswer;
  lastSig = sig;
  lastCheck = now;
  lastAnswer = session.isApplication();
  return lastAnswer;
}

function ensurePill() {
  if (!isCurrent()) return;
  const app = looksLikeApplicationNow();
  if (state !== "idle" || app) pill();
  else uiRoot("autofill").getElementById("jec-pill")?.remove();
  // A new step of an application being filled: fill it too.
  if (app && keepOn && state !== "busy") {
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
    history: copy.history || null,
    resumeFile,
  };
  return lastCopy;
}

async function run({ auto = false } = {}) {
  if (state === "busy" || !isCurrent()) return { ok: false };
  if (runtimeGone()) {
    setPill("error", "↻ Refresh the page");
    return { ok: false };
  }
  if (TOP || session.isApplication()) pill();
  setPill("busy");
  // The first use on a computer may wait for a sleeping server.
  const slow = setTimeout(() => state === "busy" && setPill("busy", "Waking up the app…"), 1500);
  const copy = await loadCopy();
  clearTimeout(slow);
  if (copy.signedOut || copy.unreachable) {
    setPill("error", copy.signedOut ? "Sign in from the side panel" : "Can't reach the app: try again");
    setTimeout(() => setPill("idle"), 4000);
    return { ok: false, signedIn: !copy.signedOut, unreachable: !!copy.unreachable };
  }

  // Workday's Work Experience: one block per job on the résumé (read once
  // and held in the copy; asked for only if the copy doesn't have it yet).
  if (isWorkdayExperience(document)) {
    let work = copy.history?.work;
    if (!work?.length) {
      setPill("busy", "Reading your résumé…");
      work = (await send({ type: "getWorkHistory" }))?.entries;
    }
    if (work?.length) await fillAllWorkExperience(document, work);
    setPill("busy");
  }

  const { leftovers } = await session.fillKnown(copy);
  report();
  setPill("done");
  lastStep = session.stepFingerprint();
  if (!auto && !keepOn) {
    keepOn = true; // on by default after a press (switch it off in the panel)
    send({ type: "setKeepFilling", on: true });
  }
  if (leftovers.length) {
    await session.fillWithAi(leftovers);
    report();
    setPill("done");
  }
  return { ok: true, ...lastReport };
}

// ---- Learning (spec 015, Story 3) -------------------------------------------
// When the user moves on (Next, Continue, Submit, leaving the page), what they
// typed into questions the app didn't know — and profile answers it didn't have
// — is offered in the side panel to remember. Nothing is saved without a press.

const ADVANCE = /^(next|continue|save (and|&) continue|save|review|submit( (my )?application)?|apply|send( application)?|proceed)\b/i;

let noticedAt = 0;
function notice() {
  if (!isCurrent() || Date.now() - noticedAt < 500) return;
  noticedAt = Date.now();
  if (!looksLikeApplicationNow()) return;
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
      if (path.some((n) => /^JEC-UI-/i.test(n?.tagName || ""))) return; // our own pill
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
    if (!isCurrent()) return;
    if (msg?.type === "runAutofill") {
      // A frame fills only when it holds an application itself (not a chat
      // widget, a newsletter box or a payment frame).
      if (!TOP && !session.isApplication()) return;
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
          return { ok: true };
        }
        return { ok: false };
      };
      act().then((r) => {
        if (!["show", "typed", "keep"].includes(msg.action)) {
          report();
          setPill(session.filledCount ? "done" : "idle");
        }
        reply(r);
      });
      return true;
    }
  });
} catch {
  /* orphaned */
}

// ---- Start ----------------------------------------------------------------

if (document.body && isCurrent()) {
  // Keep filling carries over from the last step's page (same tab, same site).
  send({ type: "getKeepFilling" }).then((r) => {
    keepOn = !!r?.on;
    if (keepOn) ensurePill();
  });
  watchForAdvance();
  ensurePill();
  const observer = new MutationObserver(() => {
    if (!isCurrent()) {
      observer.disconnect();
      return;
    }
    clearTimeout(ensureTimer);
    ensureTimer = setTimeout(ensurePill, 600);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  watchForSubmit({
    isCurrent,
    onSubmit: (job) => {
      send({ type: "markApplied", job });
      if (uiRoot("autofill").getElementById("jec-pill")) setPill("done", "✓ Tracked as applied");
    },
  });
}
