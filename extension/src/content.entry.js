// Content script for Indeed / LinkedIn / ZipRecruiter job pages.
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
import { expandMore } from "./extract/expand.js";
import { shouldBackfill } from "./backfill.js";
import { SCOUT_MAX_FAILS, scoutDone, scoutPayload } from "./scoutCapture.js";
import { isIndeedApplyUrl, isSubmitted, submittedCompany, scrapeApplyHeader } from "./indeed-apply.js";
import { readApplications } from "./extract/indeed-myjobs.js";
import { claimPage, runtimeGone, sweepLegacy } from "./orphan.js";
import { eventOn, removeUi, uiRoot } from "./ui/onpage.js";

// This copy now owns the page. A copy from before an update (still running,
// orphaned) sees it lost the claim and stops; buttons it drew are removed —
// including any of OUR ids, which can only belong to an older copy right now.
const isCurrent = claimPage("content");
for (const el of document.querySelectorAll("#jec-save, #jec-apply-badge, #jec-apply-save, #jec-sync, #jec-sync-panel")) {
  el.remove(); // drawn by a 0.28 copy, before the shadow-root UI
}
removeUi("content");
// Everything this script draws lives in one shadow root (src/ui/onpage.js).
const ui = () => uiRoot("content");
sweepLegacy("#je-save-btn, #je-apply-badge, #je-apply-save, #je-sync-btn, #je-sync-panel, #je-style");

const host = location.hostname;
const IS_INDEED = /(^|\.)indeed\./i.test(host);
const IS_LINKEDIN = /(^|\.)linkedin\./i.test(host);
const IS_ZIPRECRUITER = /(^|\.)ziprecruiter\./i.test(host);

const BTN_ID = "jec-save";
// Indeed "My jobs" sync button + review panel. Declared up here: the My jobs
// block below runs while the module loads, and reading these before their
// line used to throw, so the on-page Sync button never appeared.
const SYNC_BTN_ID = "jec-sync";
const SYNC_PANEL_ID = "jec-sync-panel";
const LABEL = "＋ Save to My Jobs";
const STALE_LABEL = "↻ Refresh page — extension updated";

let btn = null;
let currentKey = ""; // the open job we've reflected state for (so we only re-check on change)
const backfilled = new Set(); // job keys we've already backfilled this page session
const scoutSent = new Set(); // posting links Claude Scout is done with this page session
const scoutFails = new Map(); // posting link -> failed sends
let scoutInFlight = false;

// When the extension is reloaded/updated, the copy of this script already
// running in an open tab is ORPHANED — chrome.runtime dies and every
// sendMessage throws "Extension context invalidated". That sync throw used to
// wedge the button on "Saving…" forever. Detect it and say what to do instead.
// A copy superseded by a newer one (injected on update) counts as orphaned too.
function orphaned() {
  return !isCurrent() || runtimeGone();
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
// The "My jobs" board (myjobs.indeed.com) — a whole list of applications to sync
// into the tracker, not a single job to save.
const ON_INDEED_MYJOBS =
  IS_INDEED && (host === "myjobs.indeed.com" || /\/myjobs(\b|\/|$)/.test(location.pathname));

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
    if (!badge || !badge.isConnected) {
      badge = document.createElement("div");
      badge.id = "jec-apply-badge";
      badge.className = "je-btn je-fab je-fab-left";
      ui().appendChild(badge);
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
    if (saved) return;
    if (orphaned()) return;
    // Capture the FULL posting from the apply flow's JobInfoCard — description,
    // location, salary — not just the thin title/company off the step header.
    const job = extractJob(document, location.href);
    if (!job.title && lastJob?.title) job.title = lastJob.title;
    if (!job.company && lastJob?.company) job.company = lastJob.company;
    job.url = location.href;
    if (!job.title || !job.company) return;
    setSaveState("busy", "Saving…");
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
    if (saveBtn && saveBtn.isConnected) return;
    injectStyles();
    saveBtn = document.createElement("button");
    saveBtn.id = "jec-apply-save";
    saveBtn.type = "button";
    saveBtn.className = "je-btn je-fab je-fab-left je-fab-stack"; // above the badge
    saveBtn.addEventListener("click", saveApplyJob);
    ui().appendChild(saveBtn);
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

// The "My jobs" board: one button to sync every application's real status into
// the tracker, with a review step first.
if (ON_INDEED_MYJOBS) {
  try {
    const v = chrome.runtime?.getManifest?.().version;
    console.log(
      `[Job Enhancer] My Jobs sync ready — v${v} — ${readApplications(document).length} applications detected`,
    );
  } catch {
    /* orphaned */
  }
  injectStyles();
  ensureSyncButton();
  // Capture-phase: runs BEFORE Indeed's own handlers, so a page that stops
  // event propagation can't swallow the click to our button.
  document.addEventListener(
    "click",
    (e) => {
      if (!isCurrent()) return; // a newer copy handles the page now
      if (eventOn(e, SYNC_BTN_ID)) handleSyncClick();
    },
    true,
  );
  // The RELIABLE trigger: the side panel (our own page — no Indeed event
  // interference) asks us to read the applications and drives the whole review
  // itself. This can't be swallowed by the page the way a page click can.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== "readApplications") return;
      if (!isCurrent()) return;
      try {
        sendResponse({ ok: true, applications: readApplications(document) });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
      return true;
    });
  } catch {
    /* orphaned */
  }
  let _st;
  const syncObserver = new MutationObserver(() => {
    if (!isCurrent()) {
      syncObserver.disconnect(); // a newer copy took over (an update)
      return;
    }
    clearTimeout(_st);
    _st = setTimeout(ensureSyncButton, 500);
  });
  syncObserver.observe(document.body, { childList: true, subtree: true });
}

// The normal Save button runs on job/search pages — NOT the apply flow (there's
// no job card to save there; the badge above takes over) and NOT the My jobs
// board (that's a whole list, handled above).
if ((IS_INDEED && !ON_INDEED_APPLY && !ON_INDEED_MYJOBS) || IS_LINKEDIN || IS_ZIPRECRUITER) {
  injectStyles();
  sync();
  // The side panel's "Save this page" asks us first, so on these sites it gets
  // the same tested extractJob() as the Save button — not its inline fallback.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== "extractJob") return;
      // Same escape hatch as the panel's inline reader: highlighted text wins
      // (read before anything is pressed; expandMore leaves a highlight alone).
      const sel = (window.getSelection?.().toString() || "").trim();
      readWhole()
        .then((job) => {
          if (sel.length > 40) job.description = sel;
          sendResponse({ ok: true, job });
        })
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    });
  } catch {
    /* orphaned */
  }
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
      // A newer copy took over (an update): leave the page to it. Only a copy
      // with no successor shows the one action that fixes it.
      if (btn && isCurrent()) setState(btn, "stale", STALE_LABEL);
      return;
    }
    sync();
  }, 2000);
}

function keyFor(job) {
  return `${job.title}|${job.company}`.toLowerCase();
}

function sync() {
  if (!isCurrent()) return; // superseded by a newer copy (an update)
  const job = extractJob(document, location.href);

  ensureButton();
  placeButton();
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
  scoutCapture(job);
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

// Claude Scout: while a run is open in the app, send the open posting exactly
// as the page shows it. Re-tried on each sync until the description has loaded
// and the app has answered; the background says whether a run is open.
// Keyed by link, not title + company: one company can post the same title twice.
function scoutCapture(job) {
  if (scoutInFlight) return;
  const payload = scoutPayload(job);
  if (!payload || scoutSent.has(payload.url)) return;
  const link = payload.url;
  scoutInFlight = true;
  safeSend({ type: "scoutCapture", job: payload })
    .then((res) => {
      if (scoutDone(res)) scoutSent.add(link);
      else if (res?.failed) {
        const fails = (scoutFails.get(link) || 0) + 1;
        scoutFails.set(link, fails);
        if (fails >= SCOUT_MAX_FAILS) scoutSent.add(link);
      }
    })
    .catch(() => {})
    .finally(() => {
      scoutInFlight = false;
    });
}

function ensureButton() {
  if (!isCurrent()) return;
  if (btn && btn.isConnected) return;
  btn = ui().getElementById(BTN_ID) || document.createElement("button");
  btn.id = BTN_ID;
  btn.setAttribute("data-je-save", "");
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

// The Save button ALWAYS floats at the bottom-right. It used to anchor inline
// next to the job title when one was found, and float only otherwise — so on a
// page that re-renders (title appears/disappears) it flip-flopped between the
// two spots. Pinning it to one fixed corner ends that jumping.
function placeButton() {
  if (!btn.classList.contains("je-fab")) btn.classList.add("je-fab");
  if (btn.parentNode !== ui()) ui().appendChild(btn);
}

// The job as it is now, after opening a description hidden behind "See more".
async function readWhole() {
  if (expandMore(document)) await new Promise((r) => setTimeout(r, 500));
  return extractJob(document, location.href);
}

async function onSave() {
  if (!btn || btn.dataset.state === "busy" || btn.dataset.state === "saved") return;
  if (orphaned()) {
    setState(btn, "stale", STALE_LABEL);
    return;
  }
  setState(btn, "busy", "Saving…");
  let job = null;
  try {
    job = await readWhole(); // re-read fresh at click time, the whole description
  } catch {
    /* a page we can't read: same as no title below */
  }
  if (btn) btn._job = job;
  if (!job?.title || !job.company) {
    setState(btn, "error", job?.title ? "No company here → save from the panel" : "Can't read here → use panel Capture");
    setTimeout(() => btn && setState(btn, "idle", LABEL), 3500);
    return;
  }
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

// ---- Indeed "My jobs" → sync applications into the tracker ----------------

// Offered as stage overrides in the review panel (matches the default pipeline).
const STAGE_OPTIONS = [
  "Interested",
  "Referral Sent",
  "Applied",
  "Phone Screen",
  "Take-Home Assignment",
  "Interview",
  "Offer",
  "Rejected",
];

// The click behaviour in ONE place, wired to the button AND to a document
// capture-phase listener (below) — so even if Indeed's SPA swallows the bubble
// click, the sync still fires. Reports the outcome ON the button itself, so we
// never depend on the console: you'll see the panel, or a "⚠ …" reason.
let _handlingSyncClick = false;
function handleSyncClick() {
  if (_handlingSyncClick) return; // de-dupe button + capture listeners
  _handlingSyncClick = true;
  setTimeout(() => (_handlingSyncClick = false), 300);
  const sb = ui().getElementById(SYNC_BTN_ID);
  try {
    openSyncReview();
    if (!ui().getElementById(SYNC_PANEL_ID) && sb) {
      const n = readApplications(document).length;
      sb.dataset.state = "busy";
      sb.textContent = `⚠ read ${n}, but panel didn't open`;
      setTimeout(() => sb && ((sb.dataset.state = ""), ensureSyncButton()), 4000);
    }
  } catch (e) {
    console.error("[Job Enhancer] sync failed:", e);
    if (sb) {
      sb.dataset.state = "busy";
      sb.textContent = "⚠ " + String((e && e.message) || e).slice(0, 42);
      setTimeout(() => sb && ((sb.dataset.state = ""), ensureSyncButton()), 6000);
    }
  }
}

function ensureSyncButton() {
  if (!isCurrent()) return;
  let sb = ui().getElementById(SYNC_BTN_ID);
  const apps = readApplications(document);
  if (!apps.length) {
    sb?.remove();
    return;
  }
  if (!sb) {
    sb = document.createElement("button");
    sb.id = SYNC_BTN_ID;
    sb.type = "button";
    sb.className = "je-btn je-fab je-sync-fab";
    sb.addEventListener("click", handleSyncClick);
    ui().appendChild(sb);
  }
  const label = `Sync ${apps.length} Indeed applications`;
  if (sb.dataset.state !== "busy" && sb.textContent !== label) sb.textContent = label;
}

function openSyncReview() {
  ui().getElementById(SYNC_PANEL_ID)?.remove();
  injectStyles();
  const apps = readApplications(document);
  if (!apps.length) return;

  const panel = document.createElement("div");
  panel.id = SYNC_PANEL_ID;
  panel.className = "je-panel";

  const head = document.createElement("div");
  head.className = "je-sp-head";
  // NB: build with textContent/createElement, NEVER innerHTML — Indeed enforces
  // a Trusted Types CSP, under which `el.innerHTML = "…"` THROWS and silently
  // killed the whole click ("nothing happens").
  const headTitle = document.createElement("b");
  headTitle.textContent = "Sync your Indeed applications";
  head.appendChild(headTitle);
  const close = document.createElement("button");
  close.className = "je-sp-close";
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => panel.remove());
  head.appendChild(close);
  panel.appendChild(head);

  const sub = document.createElement("div");
  sub.className = "je-sp-sub";
  sub.textContent = `${apps.length} found — matches update their status, the rest import. Uncheck any to skip.`;
  panel.appendChild(sub);

  const body = document.createElement("div");
  body.className = "je-sp-body";
  const rows = apps.map((app) => {
    const row = document.createElement("div");
    row.className = "je-sp-row";

    const top = document.createElement("label");
    top.className = "je-sp-top";
    const keep = document.createElement("input");
    keep.type = "checkbox";
    keep.checked = true;
    const meta = document.createElement("div");
    meta.className = "je-sp-meta";
    const t = document.createElement("div");
    t.className = "je-sp-title";
    t.textContent = app.title;
    const c = document.createElement("div");
    c.className = "je-sp-co";
    c.textContent = [app.company, app.location].filter(Boolean).join(" · ");
    meta.append(t, c);
    top.append(keep, meta);

    const stageWrap = document.createElement("div");
    stageWrap.className = "je-sp-stage";
    const badge = document.createElement("span");
    badge.className = "je-sp-badge";
    badge.textContent = app.status || "Applied";
    const arrow = document.createElement("span");
    arrow.className = "je-sp-arrow";
    arrow.textContent = "→";
    const sel = document.createElement("select");
    sel.className = "je-sp-sel";
    for (const s of STAGE_OPTIONS) {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      if (s === app.stage) o.selected = true;
      sel.appendChild(o);
    }
    stageWrap.append(badge, arrow, sel);

    row.append(top, stageWrap);
    row._data = { app, keep, sel };
    body.appendChild(row);
    return row;
  });
  panel.appendChild(body);

  const foot = document.createElement("div");
  foot.className = "je-sp-foot";
  // A persistent status line ABOVE the buttons — the old flash-on-the-button
  // vanished before you could read it, so failures looked like "nothing happened".
  const status = document.createElement("div");
  status.className = "je-sp-status";
  status.style.display = "none";
  const setStatus = (text, kind) => {
    status.textContent = text || "";
    status.dataset.kind = kind || "info";
    status.style.display = text ? "block" : "none";
  };
  const btnRow = document.createElement("div");
  btnRow.className = "je-sp-btnrow";
  const cancel = document.createElement("button");
  cancel.className = "je-sp-cancel";
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => panel.remove());
  const sync = document.createElement("button");
  sync.className = "je-sp-sync";
  sync.type = "button";
  const chosenCount = () => rows.filter((r) => r._data.keep.checked).length;
  const relabel = () => (sync.textContent = `Sync ${chosenCount()}`);
  relabel();
  body.addEventListener("change", relabel);
  sync.addEventListener("click", async () => {
    if (orphaned()) {
      setStatus("Extension was updated — refresh this page, then Sync.", "error");
      return;
    }
    const chosen = rows
      .filter((r) => r._data.keep.checked)
      .map((r) => ({
        title: r._data.app.title,
        company: r._data.app.company,
        location: r._data.app.location || "Not specified",
        url: r._data.app.url || undefined,
        stage: r._data.sel.value,
      }));
    if (!chosen.length) {
      setStatus("Nothing selected — check at least one application.", "error");
      return;
    }
    sync.disabled = true;
    sync.textContent = "Syncing…";
    setStatus(`Syncing ${chosen.length}…`, "info");
    console.log("[Job Enhancer] sync →", chosen.length, "applications", chosen);
    // Never hang on "Syncing…": bail after 30s so the panel stays usable.
    const res = await Promise.race([
      safeSend({ type: "syncApplications", applications: chosen }),
      new Promise((r) => setTimeout(() => r({ ok: false, error: "Timed out — is the app running?" }), 30000)),
    ]).catch((e) => ({
      ok: false,
      error: /context invalidated/i.test(String(e?.message)) ? "STALE" : String(e?.message || e),
    }));
    console.log("[Job Enhancer] sync ←", res);
    if (res?.ok) {
      showSyncResult(panel, res);
      return;
    }
    sync.disabled = false;
    relabel();
    if (res?.error === "STALE") {
      setStatus("Extension was updated — refresh this page, then Sync.", "error");
    } else if (res?.error === "NOT_SIGNED_IN") {
      setStatus("Not signed in — open the Job Enhancer side panel, sign in, then Sync again.", "error");
    } else {
      setStatus(`Couldn't sync: ${res?.error || "unknown error"}. Is the app running at localhost:8000?`, "error");
    }
  });
  btnRow.append(cancel, sync);
  foot.append(status, btnRow);
  panel.appendChild(foot);
  ui().appendChild(panel);
}

function showSyncResult(panel, res) {
  panel.querySelector(".je-sp-body")?.remove();
  panel.querySelector(".je-sp-sub")?.remove();
  const foot = panel.querySelector(".je-sp-foot");

  const done = document.createElement("div");
  done.className = "je-sp-done";
  const big = document.createElement("div");
  big.className = "je-sp-done-big";
  big.textContent = "✓ Synced";
  const line = document.createElement("div");
  const skipped = res.skipped ? ` · ${res.skipped} skipped` : "";
  line.textContent = `${res.updated || 0} updated · ${res.imported || 0} imported${skipped}`;
  done.append(big, line);
  panel.insertBefore(done, foot);

  // The per-job breakdown so you can cross-reference exactly what happened to
  // each application: which existing jobs moved stage vs which were newly added.
  const outcomes = Array.isArray(res.outcomes) ? res.outcomes : [];
  const results = document.createElement("div");
  results.className = "je-sp-results";
  const group = (title, action, cls) => {
    const items = outcomes.filter((o) => o.action === action);
    if (!items.length) return;
    const sec = document.createElement("div");
    sec.className = "je-sp-rgroup";
    const h = document.createElement("div");
    h.className = `je-sp-rhead ${cls}`;
    h.textContent = `${title} (${items.length})`;
    sec.appendChild(h);
    for (const o of items) {
      const row = document.createElement("div");
      row.className = "je-sp-rrow";
      const name = document.createElement("span");
      name.className = "je-sp-rname";
      name.textContent = [o.title, o.company].filter(Boolean).join(" — ");
      const st = document.createElement("span");
      st.className = "je-sp-rstage";
      st.textContent = action === "skipped" ? "skipped" : `→ ${o.stage}`;
      row.append(name, st);
      sec.appendChild(row);
    }
    results.appendChild(sec);
  };
  group("Updated (already tracked)", "updated", "updated");
  group("Imported (new to your tracker)", "imported", "imported");
  group("Skipped", "skipped", "skipped");
  if (results.childElementCount) panel.insertBefore(results, foot);

  const note = document.createElement("div");
  note.className = "je-sp-done-note";
  note.textContent = "Open Job Enhancer to see your board.";
  panel.insertBefore(note, foot);

  if (foot) {
    foot.querySelector(".je-sp-status")?.remove();
    foot.querySelector(".je-sp-cancel")?.remove();
    const sync = foot.querySelector(".je-sp-sync");
    if (sync) {
      sync.disabled = false;
      sync.textContent = "Done";
      sync.onclick = () => panel.remove();
    }
  }
  // Refresh the floating button's count (some may have moved off "Applied").
  const sb = ui().getElementById(SYNC_BTN_ID);
  if (sb) sb.textContent = "✓ Synced to Job Enhancer";
}

// The styles live in the shadow root (src/ui/onpage.js); this makes sure it exists.
function injectStyles() {
  ui();
}
