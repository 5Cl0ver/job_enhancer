// Content script for ATS application pages (Greenhouse / Lever).
//
// Shows one floating "⚡ Autofill" button. Click → background fetches the
// profile vault + resume file → the tested fill engine writes them into the
// form (never overwriting, skipping essays) → button reports "Filled 9 · 2
// need you". We NEVER submit — the user reviews and submits themselves.
//
// Auto-track rides along: when the user submits, tell the backend so the
// matching saved job moves to Applied by itself.
import { detectAts, collectFields } from "./autofill/mapper.js";
import { fillFields, buildValues } from "./autofill/fill.js";

const ATS = detectAts(location.href); // still used for submit auto-tracking
const BTN_ID = "je-autofill-btn";
const LABEL = "⚡ Autofill from Job Enhancer";

// Universal: run on ANY page. The button only appears when the page actually
// has an application form (see hasFillableForm), so random sites stay clean.
if (document.body) {
  injectStyles();
  ensureButton();
  // Forms render/replace via JS — keep the button in sync, but DEBOUNCE so busy
  // pages (Amazon/Workday) don't thrash on every mutation.
  let _t;
  new MutationObserver(() => {
    clearTimeout(_t);
    _t = setTimeout(ensureButton, 500);
  }).observe(document.body, { childList: true, subtree: true });
  watchForSubmit();
}

function hasFillableForm() {
  return collectFields(document).length >= 2; // a real application form, not a search box
}

function ensureButton() {
  let btn = document.getElementById(BTN_ID);
  if (!hasFillableForm()) {
    btn?.remove();
    return;
  }
  if (btn) return;
  btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.textContent = LABEL;
  btn.addEventListener("click", () => run(btn));
  document.body.appendChild(btn);
}

// Orphan-safe messaging: after an extension update, this script's copy in an
// already-open tab loses chrome.runtime — never let that hang the button.
function safeSend(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg));
  } catch (e) {
    return Promise.reject(e);
  }
}

async function run(btn) {
  if (btn.dataset.state === "busy") return;
  try {
    if (!chrome.runtime?.id) {
      setState(btn, "error", "↻ Refresh page — extension updated");
      return;
    }
  } catch {
    setState(btn, "error", "↻ Refresh page — extension updated");
    return;
  }
  setState(btn, "busy", "Filling…");

  const res = await safeSend({ type: "getAutofillData" }).catch(() => null);
  if (!res?.ok || !res.signedIn) {
    setState(btn, "error", "Open panel & sign in");
    setTimeout(() => setState(btn, "idle", LABEL), 3500);
    return;
  }

  let resumeFile = null;
  if (res.resume?.b64) {
    try {
      const bytes = Uint8Array.from(atob(res.resume.b64), (c) => c.charCodeAt(0));
      resumeFile = new File([bytes], res.resume.filename || "resume.pdf", {
        type: res.resume.mime || "application/pdf",
      });
    } catch {
      /* corrupt transfer — fill everything else */
    }
  }

  const report = fillFields(
    collectFields(document),
    buildValues(res.profile, res.email),
    resumeFile,
  );

  const left = report.attention.length;
  setState(
    btn,
    "done",
    left
      ? `✓ Filled ${report.filled.length} · ${left} need you`
      : `✓ Filled ${report.filled.length} — review & submit`,
  );
}

function setState(el, state, text) {
  el.dataset.state = state;
  el.textContent = text;
}

// ---- auto-track: user submitted → move the saved job to Applied ----

function jobInfo() {
  if (ATS === "greenhouse") {
    // "Job Application for <title> at <company>" in the tab title.
    const m = /job application for (.+) at (.+)/i.exec(document.title);
    return {
      title:
        document.querySelector(".app-title, h1")?.textContent?.trim() ||
        m?.[1] ||
        "",
      company:
        document
          .querySelector(".company-name")
          ?.textContent?.replace(/^\s*at\s+/i, "")
          .trim() ||
        m?.[2] ||
        "",
    };
  }
  // Lever tab title: "<Company> - <Title>".
  const [company, ...rest] = (document.title || "").split(" - ");
  return {
    title:
      document.querySelector(".posting-headline h2")?.textContent?.trim() ||
      rest.join(" - ").trim(),
    company: (company || "").trim(),
  };
}

function watchForSubmit() {
  let sent = false;
  document.addEventListener(
    "submit",
    () => {
      if (sent) return;
      sent = true;
      const job = jobInfo();
      if (!job.title) return;
      safeSend({ type: "markApplied", job }).catch(() => {});
      const btn = document.getElementById(BTN_ID);
      if (btn) setState(btn, "done", "✓ Tracked in Job Enhancer");
    },
    true, // capture — before the page's own handler navigates away
  );
}

function injectStyles() {
  if (document.getElementById("je-autofill-style")) return;
  const style = document.createElement("style");
  style.id = "je-autofill-style";
  style.textContent = `
    #${BTN_ID} {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 11px 17px; border: 0; border-radius: 999px;
      font: 600 14px/1 system-ui, -apple-system, sans-serif; color: #fff;
      background: #7c3aed; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
      transition: background .15s, transform .1s;
    }
    #${BTN_ID}:hover { transform: translateY(-1px); }
    #${BTN_ID}[data-state="busy"] { background: #6b7280; cursor: default; }
    #${BTN_ID}[data-state="done"] { background: #16a34a; }
    #${BTN_ID}[data-state="error"] { background: #dc2626; }
    .je-autofilled { outline: 2px solid #7c3aed55 !important; border-radius: 4px; }
  `;
  document.documentElement.appendChild(style);
}
