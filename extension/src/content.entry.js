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
import { readApplications } from "./extract/indeed-myjobs.js";
const host = location.hostname;
const IS_INDEED = /(^|\.)indeed\./i.test(host);
const IS_LINKEDIN = /(^|\.)linkedin\./i.test(host);

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
    if (!badge || !document.contains(badge)) {
      badge = document.createElement("div");
      badge.id = "je-apply-badge";
      badge.className = "je-btn je-fab je-fab-left";
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
    if (saveBtn && document.contains(saveBtn)) return;
    injectStyles();
    saveBtn = document.createElement("button");
    saveBtn.id = "je-apply-save";
    saveBtn.type = "button";
    saveBtn.className = "je-btn je-fab je-fab-left";
    saveBtn.style.bottom = "66px"; // stack above the badge (bottom: 20px), both left
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
      const t = e.target;
      if (t && t.closest && t.closest("#" + SYNC_BTN_ID)) handleSyncClick();
    },
    true,
  );
  // The RELIABLE trigger: the side panel (our own page — no Indeed event
  // interference) asks us to read the applications and drives the whole review
  // itself. This can't be swallowed by the page the way a page click can.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== "readApplications") return;
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
  new MutationObserver(() => {
    clearTimeout(_st);
    _st = setTimeout(ensureSyncButton, 500);
  }).observe(document.body, { childList: true, subtree: true });
}

// The normal Save button runs on job/search pages — NOT the apply flow (there's
// no job card to save there; the badge above takes over) and NOT the My jobs
// board (that's a whole list, handled above).
if ((IS_INDEED && !ON_INDEED_APPLY && !ON_INDEED_MYJOBS) || IS_LINKEDIN) {
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

// The Save button ALWAYS floats at the bottom-right. It used to anchor inline
// next to the job title when one was found, and float only otherwise — so on a
// page that re-renders (title appears/disappears) it flip-flopped between the
// two spots. Pinning it to one fixed corner ends that jumping.
function placeButton() {
  if (!btn.classList.contains("je-fab")) btn.classList.add("je-fab");
  if (btn.parentElement !== document.body) document.body.appendChild(btn);
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

// ---- Indeed "My jobs" → sync applications into the tracker ----------------

const SYNC_BTN_ID = "je-sync-btn";
const SYNC_PANEL_ID = "je-sync-panel";
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
  const sb = document.getElementById(SYNC_BTN_ID);
  try {
    openSyncReview();
    if (!document.getElementById(SYNC_PANEL_ID) && sb) {
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
  let sb = document.getElementById(SYNC_BTN_ID);
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
    document.body.appendChild(sb);
  }
  if (sb.dataset.state !== "busy") {
    let v = "?";
    try {
      v = chrome.runtime.getManifest().version;
    } catch {
      /* orphaned */
    }
    // Version is ON the button so a stale build is obvious without the console:
    // if this doesn't say the latest version, Chrome is running old code.
    sb.textContent = `🔄 Sync ${apps.length} Indeed applications · v${v}`;
  }
}

function openSyncReview() {
  document.getElementById(SYNC_PANEL_ID)?.remove();
  injectStyles();
  const apps = readApplications(document);
  if (!apps.length) return;

  const panel = document.createElement("div");
  panel.id = SYNC_PANEL_ID;

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
  const relabel = () => (sync.textContent = `🔄 Sync ${chosenCount()}`);
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
  document.body.appendChild(panel);
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
  const sb = document.getElementById(SYNC_BTN_ID);
  if (sb) sb.textContent = "✓ Synced to Job Enhancer";
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
    /* Apply-flow badge + save go bottom-LEFT so they never overlap the
       autofill/remember buttons (a different content script) on the right. */
    .je-fab-left { left: 20px; right: auto; }
    .je-sync-fab { background: #7c3aed; }  /* purple: the sync action */
    .je-sync-fab[data-state="busy"] { background: #6b7280; }
    /* Sync review panel */
    #${SYNC_PANEL_ID} {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 380px; max-height: 78vh; overflow: auto;
      background: #fff; color: #111827; border-radius: 12px;
      box-shadow: 0 12px 34px rgba(0,0,0,.3);
      font: 13px/1.45 system-ui, -apple-system, sans-serif;
    }
    @media (prefers-color-scheme: dark) { #${SYNC_PANEL_ID} { background: #1f2937; color: #f3f4f6; } }
    #${SYNC_PANEL_ID} .je-sp-head {
      position: sticky; top: 0; display: flex; align-items: center;
      justify-content: space-between; padding: 11px 13px; background: inherit;
      border-bottom: 1px solid rgba(148,163,184,.3); font-size: 14px;
    }
    #${SYNC_PANEL_ID} .je-sp-close { background: none; border: 0; cursor: pointer; color: inherit; font-size: 13px; }
    #${SYNC_PANEL_ID} .je-sp-sub { padding: 8px 13px; font-size: 12px; color: #6b7280; }
    #${SYNC_PANEL_ID} .je-sp-body { padding: 2px 13px; }
    #${SYNC_PANEL_ID} .je-sp-row { padding: 9px 0; border-bottom: 1px solid rgba(148,163,184,.18); }
    #${SYNC_PANEL_ID} .je-sp-top { display: flex; gap: 9px; align-items: flex-start; cursor: pointer; }
    #${SYNC_PANEL_ID} .je-sp-top input { margin-top: 3px; }
    #${SYNC_PANEL_ID} .je-sp-title { font-weight: 600; font-size: 12.5px; }
    #${SYNC_PANEL_ID} .je-sp-co { font-size: 11.5px; color: #6b7280; margin-top: 1px; }
    #${SYNC_PANEL_ID} .je-sp-stage {
      display: flex; align-items: center; gap: 6px; margin: 7px 0 0 26px;
    }
    #${SYNC_PANEL_ID} .je-sp-badge {
      font-size: 11px; padding: 2px 7px; border-radius: 999px;
      background: rgba(37,99,235,.14); color: #2563eb; white-space: nowrap;
    }
    #${SYNC_PANEL_ID} .je-sp-arrow { color: #9ca3af; }
    #${SYNC_PANEL_ID} .je-sp-sel {
      flex: 1 1 auto; padding: 5px 7px; border: 1px solid #d1d5db; border-radius: 7px;
      font: inherit; background: #fff; color: #111827;
    }
    @media (prefers-color-scheme: dark) {
      #${SYNC_PANEL_ID} .je-sp-sel { background: #111827; color: #f3f4f6; border-color: #374151; }
    }
    #${SYNC_PANEL_ID} .je-sp-foot {
      position: sticky; bottom: 0; display: flex; flex-direction: column; gap: 8px;
      padding: 11px 13px; background: inherit; border-top: 1px solid rgba(148,163,184,.3);
    }
    #${SYNC_PANEL_ID} .je-sp-btnrow { display: flex; justify-content: flex-end; gap: 8px; }
    #${SYNC_PANEL_ID} .je-sp-status {
      padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.4;
    }
    #${SYNC_PANEL_ID} .je-sp-status[data-kind="info"] { background: rgba(37,99,235,.12); color: #2563eb; }
    #${SYNC_PANEL_ID} .je-sp-status[data-kind="error"] { background: rgba(220,38,38,.12); color: #dc2626; }
    #${SYNC_PANEL_ID} .je-sp-sync { background: #7c3aed; color: #fff; border: 0; border-radius: 8px; padding: 9px 15px; font-weight: 700; cursor: pointer; }
    #${SYNC_PANEL_ID} .je-sp-sync:disabled { background: #6b7280; cursor: default; }
    #${SYNC_PANEL_ID} .je-sp-cancel { background: transparent; color: inherit; border: 1px solid #d1d5db; border-radius: 8px; padding: 9px 13px; cursor: pointer; }
    #${SYNC_PANEL_ID} .je-sp-done { padding: 16px 13px 8px; text-align: center; }
    #${SYNC_PANEL_ID} .je-sp-done-big { font-size: 20px; font-weight: 800; color: #16a34a; margin-bottom: 4px; }
    #${SYNC_PANEL_ID} .je-sp-done-note { padding: 8px 13px 12px; text-align: center; font-size: 12px; color: #6b7280; }
    #${SYNC_PANEL_ID} .je-sp-results { padding: 2px 13px; }
    #${SYNC_PANEL_ID} .je-sp-rgroup { margin-bottom: 8px; }
    #${SYNC_PANEL_ID} .je-sp-rhead {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .05em; margin: 8px 0 4px;
    }
    #${SYNC_PANEL_ID} .je-sp-rhead.updated { color: #2563eb; }
    #${SYNC_PANEL_ID} .je-sp-rhead.imported { color: #16a34a; }
    #${SYNC_PANEL_ID} .je-sp-rhead.skipped { color: #9ca3af; }
    #${SYNC_PANEL_ID} .je-sp-rrow {
      display: flex; justify-content: space-between; gap: 10px; padding: 3px 0;
      border-bottom: 1px solid rgba(148,163,184,.15); font-size: 12px;
    }
    #${SYNC_PANEL_ID} .je-sp-rname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${SYNC_PANEL_ID} .je-sp-rstage { flex: 0 0 auto; color: #6b7280; }
  `;
  document.documentElement.appendChild(style);
}
