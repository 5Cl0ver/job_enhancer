// Content script for Indeed / LinkedIn job pages.
//
// Injects a "Save to Job Enhancer" button INTO THE JOB DETAIL HEADER (right
// after the job title), so you save from where you're reading. It's anchored to
// the title element the shared extractor already finds, and it re-syncs when you
// click a different job (Indeed/LinkedIn swap the detail pane in place).
//
// Proactive state: when a job opens, we ask the background whether it's already
// in your tracker and colour the button BLUE ("✓ Already saved") before you
// click — GREEN if it's new. Clicking saves; a duplicate turns blue, an error red.
//
// If we can't find a header to anchor to (unusual layout), we fall back to a
// small floating button so there's always a way to save.
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

// Same title selectors the extractor uses — a reliable, single anchor point.
const TITLE_SELECTORS = IS_INDEED ? INDEED_TITLE_SELECTORS : LINKEDIN_TITLE_SELECTORS;

const BTN_ID = "je-save-btn";
const FAB_ID = "je-fab";
const LABEL = "＋ Save to Job Enhancer";
let currentKey = ""; // identifies the open job so we only re-check when it changes

if (IS_INDEED || IS_LINKEDIN) {
  injectStyles();
  sync();
  let t;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(sync, 300);
  }).observe(document.body, { childList: true, subtree: true });
}

function findTitleEl() {
  return findTitle(document, TITLE_SELECTORS);
}

function keyFor(job) {
  return `${job.title}|${job.company}`.toLowerCase();
}

// Runs on load and on every (debounced) DOM change.
function sync() {
  const titleEl = findTitleEl();
  if (!titleEl) {
    // No job header on this view — offer the floating fallback instead.
    removeInlineButton();
    ensureFab();
    return;
  }
  removeFab();

  const job = extractJob(document, location.href);
  if (!job.title) return;
  const key = keyFor(job);

  let btn = document.getElementById(BTN_ID);
  const heading = headingFor(titleEl);
  if (!btn) {
    btn = makeButton();
    heading.insertAdjacentElement("afterend", btn);
  } else if (!heading.parentElement?.contains(btn)) {
    // Header re-rendered and dropped our button — re-anchor it.
    heading.insertAdjacentElement("afterend", btn);
  }

  // Only (re)check saved-state when the open job actually changes.
  if (key !== currentKey || !btn.dataset.state) {
    currentKey = key;
    btn._job = job;
    setState(btn, "checking", "Checking…");
    chrome.runtime
      .sendMessage({ type: "checkSaved", job })
      .then((res) => {
        // Ignore a stale response if the user moved to another job meanwhile.
        if (keyFor(job) !== currentKey) return;
        if (res?.saved) setState(btn, "saved", "✓ Already saved");
        else setState(btn, "idle", LABEL);
      })
      .catch(() => setState(btn, "idle", LABEL));
  } else {
    btn._job = job; // keep the freshest extraction for the click handler
  }
}

function makeButton() {
  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.type = "button";
  btn.className = "je-btn";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSave(btn);
  });
  return btn;
}

async function onSave(btn) {
  if (btn.dataset.state === "saved" || btn.dataset.state === "busy") return;
  const job = btn._job;
  if (!job?.title) return;
  setState(btn, "busy", "Saving…");
  const res = await chrome.runtime
    .sendMessage({ type: "saveJob", job })
    .catch(() => ({ ok: false, error: "error" }));

  if (res?.ok) {
    setState(btn, "saved", "✓ Saved");
  } else if (res?.error === "Already in your tracker") {
    setState(btn, "saved", "✓ Already saved");
  } else if (res?.error === "NOT_SIGNED_IN") {
    setState(btn, "error", "Open panel & sign in");
    setTimeout(() => setState(btn, "idle", LABEL), 3000);
  } else {
    setState(btn, "error", (res?.error || "Failed").slice(0, 28));
    setTimeout(() => setState(btn, "idle", LABEL), 3000);
  }
}

function setState(btn, state, text) {
  btn.dataset.state = state;
  btn.textContent = text;
}

// ---- floating fallback (only when there's no header to anchor to) ----
function ensureFab() {
  if (document.getElementById(FAB_ID)) return;
  const fab = document.createElement("button");
  fab.id = FAB_ID;
  fab.type = "button";
  fab.className = "je-btn je-fab";
  setState(fab, "idle", LABEL);
  fab.addEventListener("click", () => onSave(fab));
  fab._job = extractJob(document, location.href);
  document.body.appendChild(fab);
}
function removeFab() {
  document.getElementById(FAB_ID)?.remove();
}
function removeInlineButton() {
  document.getElementById(BTN_ID)?.remove();
  currentKey = "";
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
      transition: background .15s, transform .1s;
    }
    .je-btn:hover { transform: translateY(-1px); }
    .je-btn[data-state="checking"] { background: #9ca3af; cursor: default; }
    .je-btn[data-state="busy"]     { background: #6b7280; cursor: default; }
    .je-btn[data-state="saved"]    { background: #2563eb; cursor: default; }  /* blue */
    .je-btn[data-state="error"]    { background: #dc2626; }
    .je-fab {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
    }
  `;
  document.documentElement.appendChild(style);
}
