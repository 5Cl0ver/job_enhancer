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

let ensureTimer;
function ensurePill() {
  if (!isCurrent()) return;
  if (state !== "idle" || session.isApplication()) pill();
  else uiRoot("autofill").getElementById("jec-pill")?.remove();
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
  if (!res?.signedIn) return null;
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
  return {
    values: profileValues(copy.profile, copy.email),
    answers: copy.answers || [],
    resumeFile,
  };
}

async function run() {
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
  if (!copy) {
    setPill("error", "Sign in to autofill");
    openReview();
    setTimeout(() => setPill("idle"), 4000);
    return { ok: false, signedIn: false };
  }

  // Workday's Work Experience: one block per job on the résumé.
  if (isWorkdayExperience(document)) {
    setPill("busy", "Reading your résumé…");
    const wh = await send({ type: "getWorkHistory" });
    if (wh?.entries?.length) await fillAllWorkExperience(document, wh.entries);
    setPill("busy");
  }

  const { leftovers } = await session.fillKnown(copy);
  report();
  setPill("done");
  if (leftovers.length) {
    await session.fillWithAi(leftovers);
    report();
    setPill("done");
  }
  return { ok: true, ...lastReport };
}

// ---- Messages from the panel / background -----------------------------------

try {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!isCurrent()) return;
    if (msg?.type === "runAutofill") {
      // Only frames with a form answer (an empty frame stays quiet).
      if (!TOP && !session.isApplication() && !session.scan().length) return;
      run().then(reply, () => reply({ ok: false }));
      return true;
    }
    if (msg?.type === "fillAction") {
      const act = async () => {
        if (msg.action === "fix") return { ok: (await session.fix(msg.id, msg.value)).ok };
        if (msg.action === "undo") return { undone: await session.undo(msg.id || null) };
        if (msg.action === "show") return { ok: session.show(msg.id) };
        if (msg.action === "typed") return { answers: session.typedAnswers() };
        return { ok: false };
      };
      act().then((r) => {
        if (msg.action !== "show" && msg.action !== "typed") {
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
      setPill("done", "✓ Tracked as applied");
    },
  });
}
