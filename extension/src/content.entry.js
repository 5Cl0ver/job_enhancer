// Content script for Indeed / LinkedIn job pages.
//
// Instead of the old (janky) per-card buttons, we inject ONE stable, floating
// "Save to Job Enhancer" button. Clicking it runs the shared, unit-tested
// extractor over the current page and asks the background worker to save it.
// One injected element (#je-fab) → predictable, testable, and it rides on the
// robust JSON-LD extraction, so it works on the job detail page every time.
import { extractJob } from "./extract/index.js";

const FAB_ID = "je-fab";
const SUPPORTED = /(^|\.)(indeed|linkedin)\./i;

if (SUPPORTED.test(location.hostname)) init();

function init() {
  if (document.getElementById(FAB_ID)) return;
  injectStyles();
  const fab = document.createElement("button");
  fab.id = FAB_ID;
  fab.type = "button";
  setLabel(fab, "＋ Save to Job Enhancer");
  fab.addEventListener("click", () => onSave(fab));
  document.body.appendChild(fab);
}

function setLabel(fab, text, state) {
  fab.textContent = text;
  fab.dataset.state = state || "idle";
}

async function onSave(fab) {
  if (fab.dataset.busy === "1") return;
  const job = extractJob(document, location.href);
  if (!job.title) {
    setLabel(fab, "Open a job first ↗", "error");
    reset(fab, "＋ Save to Job Enhancer");
    return;
  }
  fab.dataset.busy = "1";
  setLabel(fab, "Saving…", "busy");
  const res = await chrome.runtime
    .sendMessage({ type: "saveJob", job })
    .catch(() => ({ ok: false, error: "error" }));
  fab.dataset.busy = "0";

  if (res?.ok) {
    setLabel(fab, "✓ Saved", "saved");
    reset(fab, "＋ Save to Job Enhancer", 2500);
  } else if (res?.error === "NOT_SIGNED_IN") {
    setLabel(fab, "Open panel & sign in", "error");
    reset(fab, "＋ Save to Job Enhancer", 3000);
  } else {
    setLabel(fab, (res?.error || "Failed").slice(0, 24), "error");
    reset(fab, "＋ Save to Job Enhancer", 3000);
  }
}

function reset(fab, text, delay = 2000) {
  setTimeout(() => setLabel(fab, text), delay);
}

function injectStyles() {
  if (document.getElementById("je-fab-style")) return;
  const style = document.createElement("style");
  style.id = "je-fab-style";
  style.textContent = `
    #${FAB_ID} {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      padding: 11px 16px; border: 0; border-radius: 999px; cursor: pointer;
      font: 600 14px/1 system-ui, -apple-system, sans-serif; color: #fff;
      background: #16a34a; box-shadow: 0 6px 20px rgba(0,0,0,.28);
      transition: background .15s, transform .1s;
    }
    #${FAB_ID}:hover { transform: translateY(-1px); }
    #${FAB_ID}[data-state="busy"]  { background: #6b7280; cursor: default; }
    #${FAB_ID}[data-state="saved"] { background: #15803d; }
    #${FAB_ID}[data-state="error"] { background: #dc2626; }
  `;
  document.documentElement.appendChild(style);
}
