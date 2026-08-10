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
import { shouldBackfill } from "./backfill.js";
import { isIndeedApplyUrl, isSubmitted, submittedCompany, scrapeApplyHeader } from "./indeed-apply.js";
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
const STALE_LABEL = "↻ Refresh page — extension updated";

let btn = null;
let currentKey = ""; // the open job we've reflected state for (so we only re-check on change)
const backfilled = new Set(); // job keys we've already backfilled this page session

// When the extension is reloaded/updated, the copy of this script already
// running in an open tab is ORPHANED — chrome.runtime dies and every
// sendMessage throws "Extension context invalidated". That sync throw used to
// wedge the button on "Saving…" forever. Detect it and say what to do instead.
function orphaned() {
  try {
    return !chrome.runtime?.id;
  } catch {
    return true;
  }
}

/** sendMessage that NEVER throws synchronously — always yields a promise. */
function safeSend(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg));
  } catch (e) {
    return Promise.reject(e);
  }
}

// ---- Indeed Quick-Apply auto-track ----------------------------------------
// Follows the apply flow: remembers the job as the user steps through, then
// marks it applied the moment the "submitted" confirmation appears — no manual
// click, no trip back to the app.
const ON_INDEED_APPLY = IS_INDEED && isIndeedApplyUrl(location.href);

if (ON_INDEED_APPLY) {
  let lastJob = null; // {title, company} seen on the apply steps
  let fired = false;
  let badge = null;
  let lastBadge = ""; // last text we wrote — so we never write the same thing twice
  let saveBtn = null;
  let saved = false;
  let checkedKey = ""; // job we've already asked "already saved?" about

  const setBadge = (text, done) => {
    if (text === lastBadge) return; // CRITICAL: no redundant DOM writes
    lastBadge = text;
    injectStyles();
    if (!badge || !document.contains(badge)) {
      badge = document.createElement("div");
      badge.id = "je-apply-badge";
      badge.className = "je-btn je-fab";
      document.body.appendChild(badge);
    }
    badge.textContent = text;
    badge.dataset.state = done ? "saved" : "checking";
  };

  const setSaveState = (state, text) => {
    if (!saveBtn) return;
    saveBtn.dataset.state = state;
    saveBtn.textContent = text;
  };

  async function saveApplyJob() {
    if (saved || !lastJob?.company || !lastJob?.title) return;
    if (orphaned()) return;
    setSaveState("busy", "Saving…");
    const job = { title: lastJob.title, company: lastJob.company, url: location.href };
    const res = await safeSend({ type: "saveJob", job }).catch(() => ({ ok: false }));
    if (res?.ok || res?.error === "Already in your tracker") {
      saved = true;
      setSaveState("saved", "✓ Saved");
    } else if (res?.error === "NOT_SIGNED_IN") {
      setSaveState("error", "Open panel & sign in");
      setTimeout(() => setSaveState("idle", "＋ Save this job"), 3000);
    } else {
      setSaveState("error", (res?.error || "Failed").slice(0, 22));
      setTimeout(() => setSaveState("idle", "＋ Save this job"), 3000);
    }
  }

  // A Save button on the apply page too — in case you forgot to save the job
  // before hitting Apply. Sits just above the "Applying to…" badge.
  const ensureSaveBtn = () => {
    if (saveBtn && document.contains(saveBtn)) return;
    injectStyles();
    saveBtn = document.createElement("button");
    saveBtn.id = "je-apply-save";
    saveBtn.type = "button";
    saveBtn.className = "je-btn je-fab";
    saveBtn.style.bottom = "66px"; // stack above the badge (bottom: 20px)
    saveBtn.addEventListener("click", saveApplyJob);
    document.body.appendChild(saveBtn);
    setSaveState("idle", "＋ Save this job");
  };

  // A THROTTLED POLL — never a MutationObserver here. Observing body mutations
  // and then writing the badge (itself a mutation) looped infinitely and froze
  // Indeed's apply page. A 1.5s poll is plenty to catch step changes + submit.
  const timer = setInterval(() => {
    if (orphaned()) {
      clearInterval(timer);
      return;
    }
    const header = scrapeApplyHeader(document);
    if (header?.company) lastJob = header;

    // Once we can read the job, show the Save button and check if it's already
    // saved (so the user doesn't create a duplicate).
    if (lastJob?.company && lastJob?.title) {
      ensureSaveBtn();
      const key = `${lastJob.title}|${lastJob.company}`.toLowerCase();
      if (!saved && key !== checkedKey) {
        checkedKey = key;
        safeSend({
          type: "checkSaved",
          job: { title: lastJob.title, company: lastJob.company, location: "" },
        })
          .then((r) => {
            if (r?.saved) {
              saved = true;
              setSaveState("saved", "✓ Already saved");
            }
          })
          .catch(() => {});
      }
    }

    if (!fired && isSubmitted(document)) {
      fired = true;
      const company = lastJob?.company || submittedCompany(document) || "";
      const title = lastJob?.title || "";
      if (company || title) {
        safeSend({ type: "markApplied", job: { title, company } }).catch(() => {});
      }
      setBadge("✓ Applied — tracked", true);
      return;
    }
    if (!fired) {
      const name = lastJob?.title || lastJob?.company;
      setBadge(name ? `📝 Applying to ${name}`.slice(0, 46) : "📝 Applying…", false);
    }
  }, 1500);
}

// The normal Save button runs on job/search pages — NOT the apply flow (there's
// no job card to save there; the badge above takes over).
if ((IS_INDEED && !ON_INDEED_APPLY) || IS_LINKEDIN) {
  injectStyles();
  sync();
  let t;
  const observer = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(sync, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // The pane can swap jobs via history (?vjk=) without a DOM mutation we catch —
  // a light poll keeps the button honest when you click another card. (2s to
  // stay light on Indeed's busy, constantly-mutating feed.)
  const poll = setInterval(() => {
    if (orphaned()) {
      // Stop everything and tell the user the one action that fixes it.
      clearInterval(poll);
      observer.disconnect();
      if (btn) setState(btn, "stale", STALE_LABEL);
      return;
    }
    sync();
  }, 2000);
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
  safeSend({ type: "checkSaved", job })
    .then((res) => {
      if (!btn || keyFor(btn._job) !== key) return; // moved to another job meanwhile
      if (res?.saved && btn.dataset.state === "idle") setState(btn, "saved", "✓ Already saved");

      // Passive backfill: this job is saved but thin, and we can see the full
      // posting right now — send it up. Once per job per page session.
      if (shouldBackfill(job, res) && !backfilled.has(key)) {
        backfilled.add(key);
        safeSend({ type: "backfillJob", job })
          .then((r) => {
            if (r?.updated && btn && keyFor(btn._job) === key) {
              setState(btn, "saved", "✓ Details updated");
            }
          })
          .catch(() => {});
      }
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
      // A stale (orphaned) button has ONE useful action: reload the page so a
      // fresh, connected copy of this script takes over.
      if (btn.dataset.state === "stale") {
        location.reload();
        return;
      }
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
  if (orphaned()) {
    setState(btn, "stale", STALE_LABEL);
    return;
  }
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
    safeSend({ type: "saveJob", job }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "Timed out — try again" }), 12000)),
  ]).catch((e) => ({
    ok: false,
    error: /context invalidated/i.test(String(e?.message)) ? "STALE" : "error",
  }));

  if (res?.ok) {
    setState(btn, "saved", "✓ Saved");
  } else if (res?.error === "Already in your tracker") {
    setState(btn, "saved", "✓ Already saved");
  } else if (res?.error === "STALE") {
    setState(btn, "stale", STALE_LABEL);
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
    .je-btn[data-state="stale"]    { background: #d97706; }  /* amber: refresh me */
    .je-fab {
      position: fixed; right: 20px; bottom: 20px;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
    }
  `;
  document.documentElement.appendChild(style);
}
