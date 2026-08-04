// Content script for Indeed / LinkedIn job pages.
//
// One Save button that stays in sync with the OPEN job:
//   • Anchored in the job header when we can find the title; otherwise a small
//     floating button (so there's always a way to save).
//   • Proactive state — asks the background whether the open job is already saved
//     and colours BLUE "✓ Already saved" vs GREEN "Save" before you click.
//   • Re-syncs when you switch jobs in Indeed's list+pane view (the pane updates
//     and the URL's ?vjk= changes), so the button reflects THIS card, not the last.
//
// Extraction itself is the shared, tested extractJob() (Indeed embedded JSON →
// JSON-LD → selectors), which identifies the open job strictly by ?vjk=.
import { extractJob } from "./extract/index.js";
import {
  INDEED_TITLE_SELECTORS,
  LINKEDIN_TITLE_SELECTORS,
  findTitleEl as findTitle,
  headingFor,
} from "./inject.js";

const host = location.hostname;
const IS_INDEED = /(^|\.)indeed\./i.test(host);
const IS_LINKEDIN = /(^|\.)linkedin\./i.test(host);
const TITLE_SELECTORS = IS_INDEED ? INDEED_TITLE_SELECTORS : LINKEDIN_TITLE_SELECTORS;

const BTN_ID = "je-save-btn";
const LABEL = "＋ Save to Job Enhancer";

let btn = null;
let currentKey = ""; // the open job we've reflected state for (so we only re-check on change)

if (IS_INDEED || IS_LINKEDIN) {
  injectStyles();
  sync();
  let t;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(sync, 300);
  }).observe(document.body, { childList: true, subtree: true });
  // The pane can swap jobs via history (?vjk=) without a DOM mutation we catch —
  // a light poll keeps the button honest when you click another card. (2s to
  // stay light on Indeed's busy, constantly-mutating feed.)
  setInterval(sync, 2000);
}

function keyFor(job) {
  return `${job.title}|${job.company}`.toLowerCase();
}

function sync() {
  const job = extractJob(document, location.href);
  const titleEl = findTitle(document, TITLE_SELECTORS);

  ensureButton();
  placeButton(titleEl);
  btn._job = job;

  const key = job.title ? keyFor(job) : "";
  if (!key) {
    // Couldn't read the open job — reset to a neutral Save (don't keep a stale
    // "already saved" from a previous card). Clicking will guide to the panel.
    if (currentKey !== "" || !btn.dataset.state) {
      currentKey = "";
      setState(btn, "idle", LABEL);
    }
    return;
  }
  if (key === currentKey) return; // same job — nothing to re-check

  currentKey = key;
  // Show a usable "Save" immediately — never a stuck "Checking…". The saved-state
  // check runs in the background and only UPGRADES the button to blue if it
  // confirms; if it's slow or fails, the button still works.
  setState(btn, "idle", LABEL);
  chrome.runtime
    .sendMessage({ type: "checkSaved", job })
    .then((res) => {
      if (!btn || keyFor(btn._job) !== key) return; // moved to another job meanwhile
      if (res?.saved && btn.dataset.state === "idle") setState(btn, "saved", "✓ Already saved");
    })
    .catch(() => {});
}

function ensureButton() {
  if (btn && document.contains(btn)) return;
  btn = document.getElementById(BTN_ID) || document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  if (!btn._wired) {
    btn.className = "je-btn";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSave();
    });
    btn._wired = true;
  }
}

function placeButton(titleEl) {
  if (titleEl) {
    const heading = headingFor(titleEl);
    if (btn.previousElementSibling !== heading || btn.classList.contains("je-fab")) {
      btn.classList.remove("je-fab");
      heading.insertAdjacentElement("afterend", btn);
    }
  } else if (!btn.classList.contains("je-fab") || !document.contains(btn)) {
    btn.classList.add("je-fab");
    document.body.appendChild(btn);
  }
}

async function onSave() {
  if (!btn || btn.dataset.state === "busy" || btn.dataset.state === "saved") return;
  const job = extractJob(document, location.href); // re-read fresh at click time
  btn._job = job;
  if (!job.title) {
    setState(btn, "error", "Can't read here → use panel Capture");
    setTimeout(() => btn && setState(btn, "idle", LABEL), 3500);
    return;
  }
  setState(btn, "busy", "Saving…");
  // Never hang on "Saving…" — bail after 12s so the button stays usable.
  const res = await Promise.race([
    chrome.runtime.sendMessage({ type: "saveJob", job }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "Timed out — try again" }), 12000)),
  ]).catch(() => ({ ok: false, error: "error" }));

  if (res?.ok) {
    setState(btn, "saved", "✓ Saved");
  } else if (res?.error === "Already in your tracker") {
    setState(btn, "saved", "✓ Already saved");
  } else if (res?.error === "NOT_SIGNED_IN") {
    setState(btn, "error", "Open panel & sign in");
    setTimeout(() => btn && setState(btn, "idle", LABEL), 3000);
  } else {
    setState(btn, "error", (res?.error || "Failed").slice(0, 28));
    setTimeout(() => btn && setState(btn, "idle", LABEL), 3000);
  }
}

function setState(el, state, text) {
  el.dataset.state = state;
  el.textContent = text;
}

function injectStyles() {
  if (document.getElementById("je-style")) return;
  const style = document.createElement("style");
  style.id = "je-style";
  style.textContent = `
    .je-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 10px 0; padding: 9px 15px; border: 0; border-radius: 999px;
      font: 600 14px/1 system-ui, -apple-system, sans-serif; color: #fff;
      background: #16a34a; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.18);
      transition: background .15s, transform .1s; z-index: 2147483647;
    }
    .je-btn:hover { transform: translateY(-1px); }
    .je-btn[data-state="checking"] { background: #9ca3af; cursor: default; }
    .je-btn[data-state="busy"]     { background: #6b7280; cursor: default; }
    .je-btn[data-state="saved"]    { background: #2563eb; cursor: default; }  /* blue */
    .je-btn[data-state="error"]    { background: #dc2626; }
    .je-fab {
      position: fixed; right: 20px; bottom: 20px;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
    }
  `;
  document.documentElement.appendChild(style);
}
