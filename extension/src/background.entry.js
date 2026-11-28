// Background service worker — the ONLY place that talks to Supabase Auth and the
// Job Enhancer API. The side panel and the on-page Save buttons send it messages;
// it handles login, token refresh, saving, and passive detail backfill.
// Centralizing here avoids CORS and keeps one source of truth.
//
// NO SCRAPING: we never fetch pages the user isn't on (sites block that — that
// was the old enrichIfThin 401 problem). All job data comes from CAPTURE — the
// content script reading pages the user actually has open.
//
// Bundled by esbuild. config.js is loaded at runtime from the extension root.
import { friendlyApiError } from "./errors.js";
import { parseSummary } from "./savedSync.js";
import { reinjectOpenTabs } from "./background/reinject.js";
import { createAutofillCopy } from "./background/autofillCopy.js";
import { createFillPresence } from "./background/fillPresence.js";
import { createConnect } from "./background/connect.js";
import { APPLY_ALARM, createApplyRun } from "./background/applyRun.js";
import { createTabJobs } from "./background/tabJobs.js";
import { createCaughtReporter, fillFailure, isSaveFailure, ownerReport, placeOf } from "./background/bugReports.js";
import { capture } from "./background/pagePhoto.js";
import { sameBox } from "./autofill/fingerprint.js";
import { answerKey } from "./autofill/classify/answers.js";
import { pageId, siteKey } from "./autofill/hosts.js";
import { bestJobMatch } from "../panel/src/lib/context.ts";
import { LEARNABLE_PROFILE, profileValue } from "./autofill/session.js";
import { valueForms } from "./autofill/classify/profileKeys.js";
import { detectAts } from "./autofill/track.js";
import { promotions } from "./autofill/promote.js";

importScripts("/config.js");
const cfg = self.JOB_ENHANCER_CONFIG;

// Clicking the toolbar icon opens the side panel (no popup).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Installed or updated: put the current scripts into the tabs already open,
  // so nothing needs a refresh (spec 015). Not on a Chrome update: the same
  // version is already running in those tabs.
  if (reason === "install" || reason === "update") reinjectOpenTabs().catch(() => {});
  // A new version says hello again right away (the update note goes away),
  // and checks for a newer one every 6 hours from now on (spec 034).
  chrome.storage.local
    .remove("je_hello_at")
    .then(() => keepChecking())
    .then(() => checkVersion())
    .catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function bytesToB64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function storeSession(d, email) {
  const patch = {
    je_token: d.access_token,
    je_expires: d.expires_at,
    je_refresh: d.refresh_token,
  };
  if (email) patch.je_email = email;
  await chrome.storage.local.set(patch);
}

// A single in-flight refresh, shared by ALL callers. Supabase rotates refresh
// tokens, so if many requests each refresh at once, only the first succeeds and
// the rest get "refresh token already used" — which wedges the session. This
// mutex makes concurrent callers await the SAME refresh instead of racing.
let _refreshInFlight = null;

async function refreshToken(je_refresh) {
  let res;
  try {
    res = await fetchWithTimeout(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: je_refresh }),
    });
  } catch {
    return null; // network/timeout — treat as "couldn't refresh" instead of hanging
  }
  if (res.status === 400 || res.status === 401) {
    // The refresh token is dead (revoked, already used, signed out elsewhere):
    // forget the session so we stop retrying and the panel shows Sign in.
    await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
    return null;
  }
  if (!res.ok) return null; // 5xx, 429: try again later
  const d = await res.json();
  await storeSession(d);
  return d.access_token;
}

async function getValidToken() {
  const { je_token, je_expires, je_refresh } = await chrome.storage.local.get([
    "je_token",
    "je_expires",
    "je_refresh",
  ]);
  if (je_token && je_expires && je_expires * 1000 > Date.now() + 30_000) {
    return je_token;
  }
  if (!je_refresh) return null;
  if (!_refreshInFlight) {
    _refreshInFlight = refreshToken(je_refresh).finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

async function login(email, password) {
  const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error_description || d.msg || "Sign-in failed");
  await storeSession(d, email);
}

// ---- One-press Connect + hello (spec 019) ---------------------------------
// A connected Job Catcher holds its own pass ("jcx_…"), not a Supabase
// session: it never expires on its own schedule (the server stops it after 90
// days unused or a year), so it's stored with a far-off je_expires and no
// refresh token. Every 401 below signs the panel out as usual.

const TEN_YEARS = 10 * 365 * 24 * 3600;

async function storePass(token, email) {
  const { je_email: before } = await chrome.storage.local.get("je_email");
  // Owner or not is the app's to say again (the hello below), per account.
  await chrome.storage.local.remove(["je_refresh", "je_is_owner"]);
  await chrome.storage.local.set({
    je_token: token,
    je_expires: Math.floor(Date.now() / 1000) + TEN_YEARS,
    je_email: email,
  });
  // Another account's copy must never fill this one's forms.
  if ((before || "").toLowerCase() !== (email || "").toLowerCase()) await autofill.wipe();
  autofill.refresh();
  hello(true).catch(() => {});
  chrome.runtime.sendMessage({ type: "authChanged" }).catch(() => {});
}

const connect = createConnect({ cfg, onConnected: storePass, fetchFn: (url, opts) => wakeFetch(url, opts) });

// Only the app's /connect page may ask (externally_connectable lists only the
// app's address), and only gets the proof for the code we're waiting on.
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  // The app asks which Job Catcher is in this browser (spec 040): only the
  // app's own address can ask (externally_connectable), and it's told only
  // the version and the browser's name.
  if (msg?.type === "version") {
    sendResponse({ version: chrome.runtime.getManifest().version, browser: browserName() });
    return false;
  }
  connect.proofFor(msg, sender).then(sendResponse, () => sendResponse({}));
  return true;
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  // The worker slept while waiting for approval: carry on the same loop.
  if (alarm.name === connect.alarm) connect.status().catch(() => {});
  if (alarm.name === REVOKE_ALARM) retryRevoke().catch(() => {});
  if (alarm.name === VERSION_ALARM) checkVersion().catch(() => {});
  // A run is open: carry on its requests even with no page ticking (spec 040).
  if (alarm.name === APPLY_ALARM) applyRun.wake().catch(() => {});
});

function browserName() {
  const brands = navigator.userAgentData?.brands || [];
  const b =
    brands.find((x) => /edge|brave|opera/i.test(x.brand)) ||
    brands.find((x) => /chrome/i.test(x.brand) && !/chromium/i.test(x.brand)) ||
    brands.find((x) => !/not.?a.?brand|chromium/i.test(x.brand));
  // The computer's system too ("Chrome 142 (Windows)"): the app names which
  // computer's Job Catcher is out of date (spec 034).
  const platform = String(navigator.userAgentData?.platform || "").replace(/[^\w .-]/g, "").slice(0, 20);
  const name = b ? `${b.brand.replace(/^Microsoft /, "").replace(/^Google /, "")} ${b.version}` : "Chrome";
  return `${name}${platform ? ` (${platform})` : ""}`.slice(0, 64);
}

async function installId() {
  const { je_install_id } = await chrome.storage.local.get("je_install_id");
  if (je_install_id) return je_install_id;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ je_install_id: id });
  return id;
}

/**
 * Tell Job Enhancer which version this is: on sign-in, when Chrome starts and
 * every 6 hours (spec 034), and when the panel opens (at most hourly). The
 * answer says which version is the newest: an older Job Catcher shows "NEW"
 * on its toolbar icon and an update card in the panel.
 */
async function hello(force = false) {
  const { je_hello_at } = await chrome.storage.local.get("je_hello_at");
  if (!force && je_hello_at && Date.now() - je_hello_at < 3600_000) return;
  const token = await getValidToken();
  if (!token) return;
  await chrome.storage.local.set({ je_hello_at: Date.now() });
  // A sleeping server wakes up (a cold start must not lose the check).
  const res = await wakeFetch(`${cfg.API_BASE}/v1/extension/hello`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      install_id: await installId(),
      version: chrome.runtime.getManifest().version,
      browser: browserName(),
    }),
  }).catch(() => null);
  if (res?.ok) {
    const d = await res.json().catch(() => ({}));
    await storeOwner(d.is_owner === true);
    await storeLatest(typeof d.latest === "string" ? d.latest : null);
  }
}

/** The app's owner sees "Report a problem here" (spec 032); the server checks again on every report. */
async function storeOwner(isOwner) {
  const { je_is_owner: before } = await chrome.storage.local.get("je_is_owner");
  await chrome.storage.local.set({ je_is_owner: isOwner });
  if (isOwner !== !!before) chrome.runtime.sendMessage({ type: "authChanged" }).catch(() => {});
}

/** The newest version, as the app said: kept, and shown when this one is older. */
async function storeLatest(latest) {
  const { je_latest: before } = await chrome.storage.local.get("je_latest");
  await chrome.storage.local.set({ je_latest: latest });
  // A newer version just became known: the panel shows the update card.
  if (latest !== (before ?? null)) chrome.runtime.sendMessage({ type: "authChanged" }).catch(() => {});
  await showUpdateBadge(latest !== (before ?? null));
}

// ---- Never out of date (spec 034) -------------------------------------------
// Job Catcher is installed from a zip, so Chrome can't update it by itself:
// it checks for a newer version when Chrome starts and every 6 hours, and an
// older one says so on its toolbar icon ("NEW"), in the panel and in the app.

const VERSION_ALARM = "je-version";
const VERSION_EVERY_MIN = 360;
const NEW_BADGE = { text: "NEW", color: "#dc2626" };

/** "NEW" when a newer Job Catcher is out; nothing otherwise (offline: as last known). */
async function updateBadge() {
  const { je_latest } = await chrome.storage.local.get("je_latest");
  return isOlder(chrome.runtime.getManifest().version, je_latest) ? NEW_BADGE : { text: "" };
}

/** The toolbar icon on every tab says it (`allTabs`: each tab's own badge too). */
async function showUpdateBadge(allTabs = false) {
  const b = await updateBadge();
  try {
    await chrome.action.setBadgeText({ text: b.text });
    if (b.text) await chrome.action.setBadgeBackgroundColor({ color: b.color });
  } catch {
    /* no toolbar icon (tests) */
  }
  if (!allTabs) return;
  for (const t of await chrome.tabs.query({}).catch(() => [])) if (t.id != null) await presence.badge(t.id);
}

/** Ask which version is the newest: signed in, with a hello; else the public answer. */
async function checkVersion() {
  if (await getValidToken()) {
    await hello(true);
    return;
  }
  const res = await wakeFetch(`${cfg.API_BASE}/v1/extension/latest`, {}).catch(() => null);
  if (!res?.ok) return; // offline: try again at the next check
  const d = await res.json().catch(() => ({}));
  await storeLatest(typeof d.version === "string" ? d.version : null);
}

async function keepChecking() {
  if (!(await chrome.alarms?.get(VERSION_ALARM).catch(() => null))) {
    chrome.alarms?.create(VERSION_ALARM, { delayInMinutes: VERSION_EVERY_MIN, periodInMinutes: VERSION_EVERY_MIN });
  }
}

chrome.runtime.onStartup.addListener(() => {
  keepChecking().catch(() => {});
  checkVersion().catch(() => {});
});
// The worker woke up (a new version, a browser restart): the icon as last known.
showUpdateBadge().catch(() => {});
keepChecking().catch(() => {});

function isOlder(have, latest) {
  const parse = (v) => (typeof v === "string" && /^\d+(\.\d+){1,3}$/.test(v) ? v.split(".").map(Number) : null);
  const a = parse(have);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0;
  }
  return false;
}

/** Sign out: a pass is revoked on the server first, so it's dead everywhere.
 *  If the server can't be reached, the revoke is kept and retried later. */
const REVOKE_ALARM = "je-revoke";

async function sendRevoke(token) {
  try {
    const res = await wakeFetch(`${cfg.API_BASE}/v1/extension/tokens/current`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // 204 revoked; 401 already dead. Either way it's done.
    return res.status === 204 || res.status === 401;
  } catch {
    return false;
  }
}

async function revokePass() {
  const { je_token } = await chrome.storage.local.get("je_token");
  if (typeof je_token !== "string" || !je_token.startsWith("jcx_")) return;
  if (!(await sendRevoke(je_token))) {
    await chrome.storage.local.set({ je_pending_revoke: je_token });
    chrome.alarms?.create(REVOKE_ALARM, { periodInMinutes: 30 });
  }
}

async function retryRevoke() {
  const { je_pending_revoke } = await chrome.storage.local.get("je_pending_revoke");
  if (typeof je_pending_revoke !== "string") {
    chrome.alarms?.clear(REVOKE_ALARM);
    return;
  }
  if (await sendRevoke(je_pending_revoke)) {
    await chrome.storage.local.remove("je_pending_revoke");
    chrome.alarms?.clear(REVOKE_ALARM);
  }
}
// A sign-out that couldn't reach the server: try again whenever we start.
retryRevoke().catch(() => {});

async function saveJob(job) {
  const token = await getValidToken();
  if (!token) throw new Error("NOT_SIGNED_IN");
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/manual`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // origin: the app labels the job "Job Catcher" in My Jobs.
    body: JSON.stringify({ ...job, origin: "extension" }),
  });
  if (res.status === 401) {
    await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
    throw new Error("NOT_SIGNED_IN");
  }
  if (res.status === 409) {
    // Already saved — but if THIS capture is richer than what we stored (user
    // re-clicked Save on the real job page), quietly upgrade the listing.
    await backfillJob(job).catch(() => {});
    throw new Error("Already in your tracker");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Full detail in the worker console for debugging; short + human in the UI.
    console.warn("JE save failed", res.status, text, job);
    throw new Error(friendlyApiError(res.status, text) || "Save failed");
  }
  return res.json();
}

// Passive backfill: send full details captured from a job page for a job the
// user already saved thin (e.g. from a feed). Server only ever upgrades.
async function backfillJob(job) {
  const token = await getValidToken();
  if (!token) return { updated: false };
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/backfill`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (res.status === 401) {
    await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
    return { updated: false };
  }
  if (!res.ok) return { updated: false };
  return res.json();
}

// Is this job already in the user's tracker? Lets the on-page button show an
// "already saved" state before the user clicks. Returns { saved } or, if not
// signed in, { saved:false, signedIn:false } (a non-error — the page still loads).
async function checkSaved(job) {
  const token = await getValidToken();
  if (!token) return { saved: false, signedIn: false };
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/check`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: job.title || "",
      company: job.company || "",
      location: job.location || "",
      url: job.url || "",
    }),
  });
  if (!res.ok) return { saved: false, signedIn: true };
  const d = await res.json();
  return { saved: !!d.saved, needs_details: !!d.needs_details, signedIn: true };
}

// Claude Scout: is a run open in the app? Asked only from job pages with a full
// posting showing, and cached (60s when open, 15s when not) so normal browsing
// costs at most a tiny request every few seconds of reading jobs.
// `anySite`: a Google Jobs or Local companies run Claude has started, the only
// time pages beyond the three job boards are copied.
let _scoutRun = { at: 0, id: null, anySite: false };

async function scoutRunState(token) {
  // Open and copying anywhere: 60s. Open but not yet started (it may start any
  // moment), or none: re-ask sooner.
  const ttl = _scoutRun.anySite ? 60_000 : _scoutRun.id ? 10_000 : 15_000;
  if (Date.now() - _scoutRun.at < ttl) return _scoutRun;
  let id = null;
  let anySite = false;
  try {
    const res = await fetchWithTimeout(`${cfg.API_BASE}/v1/scout/runs/active`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const d = await res.json();
      id = d.run_id || null;
      anySite = !!d.any_site;
    }
  } catch {
    id = null; // unreachable: try again after the short wait
  }
  _scoutRun = { at: Date.now(), id, anySite };
  return _scoutRun;
}

async function scoutRunOpen(token) {
  return (await scoutRunState(token)).id;
}

// Should a page on some other site look for a job to copy? Only while a run
// that looks beyond the job boards is going.
async function scoutAnySite() {
  const token = await getValidToken();
  if (!token) return { anySite: false };
  return { anySite: (await scoutRunState(token)).anySite };
}

// Send the open posting, word for word, for the Scout run Claude is doing.
// Returns {active:false} when no run is open, else {active:true, stored} (plus
// failed:true when the app errored, so the page sends it again).
async function scoutCapture(job) {
  const token = await getValidToken();
  if (!token) return { active: false };
  if (!(await scoutRunOpen(token))) return { active: false };
  const res = await fetchWithTimeout(`${cfg.API_BASE}/v1/scout/captures`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(job),
  }).catch(() => null);
  if (!res) return { active: false }; // network: let the page try again
  if (!res.ok) return { active: true, stored: false, failed: true }; // e.g. a cold start: try again
  const d = await res.json().catch(() => ({}));
  if (!d.stored) _scoutRun.at = 0; // the run may have just ended: re-ask next time
  return { active: true, stored: !!d.stored };
}

// Everything autofill needs, held by the extension (spec 015): a press never
// waits on the server. See background/autofillCopy.js.
const autofill = createAutofillCopy({
  api: cfg.API_BASE,
  token: () => getValidToken(),
  wakeFetch: (url, opts) => wakeFetch(url, opts),
  toB64: bytesToB64,
  onFresh: (copy) => promoteOnce(copy),
});

// Spec 020: answers taught on one site before 0.36 become answers for every
// site, once per ACCOUNT (src/autofill/promote.js): recorded on the account,
// so another computer never repeats it and an answer deleted in the app stays
// deleted. Retried until it saves.
async function promoteOnce(copy) {
  if (!copy?.email || copy.promoted) return;
  const items = promotions(copy.taught || [], copy.answers || []);
  if (items.length) {
    const out = await saveCustomAnswers(items);
    if (out.error) return; // the next refresh tries again
    const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
    if (held?.email === copy.email) {
      const keys = new Set(items.map((x) => x.question_key));
      held.answers = [...(held.answers || []).filter((a) => !keys.has(a.question_key)), ...items];
      await chrome.storage.local.set({ je_autofill: held });
    }
  }
  const token = await getValidToken();
  if (!token) return;
  const res = await wakeFetch(`${cfg.API_BASE}/v1/autofill/promoted`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) return;
  const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
  if (held?.email === copy.email) await chrome.storage.local.set({ je_autofill: { ...held, promoted: true } });
}

// Per-tab fill sessions (what each frame filled), for the side panel's review.
// Kept in storage.session: they survive the worker sleeping, and go with the
// browser session.
const fillKey = (tabId) => `je_fill:${tabId}`;

// One write at a time: frames reporting together must not overwrite each
// other's read-modify-write.
let fillWrites = Promise.resolve();
function storeFillSession(tabId, frameId, session) {
  fillWrites = fillWrites.catch(() => {}).then(async () => {
    const key = fillKey(tabId);
    const { [key]: held = { frames: {} } } = await chrome.storage.session.get(key);
    // `fillAt`: when this frame last reported a FILL (a panel action's report keeps it).
    const prev = held.frames[frameId];
    held.frames[frameId] = { ...session, at: Date.now(), fillAt: session.action ? prev?.fillAt : Date.now() };
    await chrome.storage.session.set({ [key]: held });
    chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {});
  });
  return fillWrites;
}

// Does each tab have a form, and what is Autofill doing there (spec 016).
const presence = createFillPresence({
  notify: (tabId) => chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {}),
  // An out-of-date Job Catcher's "NEW" shows on every tab (spec 034).
  idleBadge: () => updateBadge(),
});

// Job Catcher's own failures, for the owner's Bugs & ideas (spec 032): the
// kind, the page's site and path, Job Catcher's own words and its version;
// one per kind and page every 10 minutes, never retried, never throwing.
const caught = createCaughtReporter({
  version: chrome.runtime.getManifest().version,
  storage: chrome.storage.session,
  send: async (body) => {
    const token = await getValidToken();
    if (!token) return;
    await fetchWithTimeout(
      `${cfg.API_BASE}/v1/bugs/caught`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      15_000,
    );
  },
});

/**
 * Press Autofill on a tab (panel, toolbar, shortcut, Claude) and keep a real
 * failure: a press that took too long, or got no answer from a page whose
 * reader was there (it had reported a form). Never pages Job Catcher can't
 * run on (the Web Store, a PDF), signed out or the app asleep.
 */
async function pressTab(tabId) {
  const hadForm = await presence.get(tabId).then(
    (p) => !!p?.form,
    () => false,
  );
  const out = await presence.press(tabId);
  if (out?.problem) {
    chrome.tabs
      .get(tabId)
      .then((t) => {
        const said = fillFailure({ problem: out.problem, url: t?.url, hadForm });
        if (said) caught.report("fill_failed", t?.url, said);
      })
      .catch(() => {});
  }
  return out;
}

// Apply with Claude (spec 022): photos, fill on request, the Submit block.
const applyRun = createApplyRun({
  api: async (path, init = {}) => {
    const token = await getValidToken();
    if (!token) return null;
    const json = typeof init.body === "string";
    return fetchWithTimeout(`${cfg.API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
  },
  press: (tabId) => pressTab(tabId),
  fillSession: (tabId) => getFillSession(tabId),
  // A press filling the tab (panel, toolbar): no photos then (spec 037).
  filling: (tabId) => presence.pressingNow(tabId),
  // A fill for another run than the one this tab's file tries were for: they
  // don't count any more (spec 037).
  onRunFill: async (tabId, runId) => {
    const k = filesKey(tabId);
    const { [k]: held } = await chrome.storage.session.get(k);
    if (held && (held.run || "") !== runId) await chrome.storage.session.remove(k);
  },
});
// The worker just started (a reload, an update, Chrome stopped it): an open
// run's requests are carried on at once, not at the next page tick (spec 040).
applyRun.wake().catch(() => {});

async function getFillSession(tabId) {
  const key = fillKey(tabId);
  const pk = pendingKey(tabId);
  const kk = keepKey(tabId);
  const ik = pickKey(tabId);
  const sk = savedKey(tabId);
  const tk = trackedKey(tabId);
  const { [key]: held, [pk]: pending, [kk]: keep, [ik]: pick, [sk]: saved, [tk]: tracked } = await chrome.storage.session.get([key, pk, kk, ik, sk, tk]);
  return {
    ...(held || { frames: {} }),
    pending: pending || { answers: [], profile: {} },
    keep: !!keep?.on,
    presence: await presence.get(tabId),
    pick: pick || null,
    saved: saved || [],
    // A Submit just tracked on this tab (spec 034): the panel says so.
    tracked: tracked && Date.now() - tracked.at < 15 * 60_000 ? tracked : null,
  };
}

// What was saved automatically on this tab (spec 018), for the panel's
// "Saved N answers" with Edit / Undo. Values are the user's own, shown only
// in their panel; kept with the browser session.
const savedKey = (tabId) => `je_saved:${tabId}`;
let savedWrites = Promise.resolve();
function updateSaved(tabId, change) {
  savedWrites = savedWrites
    .catch(() => {})
    .then(async () => {
      const key = savedKey(tabId);
      const { [key]: list = [] } = await chrome.storage.session.get(key);
      await chrome.storage.session.set({ [key]: change(list).slice(-30) });
      chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {});
    });
  return savedWrites;
}

/**
 * Save answers the user gave, now. A company-specific question's answer is
 * kept for this site only ("site|question"); an essay as a saved answer
 * offered with "Use saved answer" ("essay|question"), never filled by itself.
 */
async function autoSaveAnswers(tabId, answers, site, companyKnown = true) {
  const { je_autofill: copy } = await chrome.storage.local.get("je_autofill");
  const before = new Map((copy?.answers || []).map((a) => [a.question_key, a.answer]));
  const items = [];
  for (const a of answers) {
    if (!a?.question_key || !a.answer) continue;
    // One company's answer where the company can't be told apart (Indeed's
    // apply pages, LinkedIn): never saved, so it never reaches another company.
    if (a.company && !a.essay && (!site || !companyKnown)) continue;
    const scope = a.essay ? "essay" : a.company ? "site" : "all";
    const key = answerKey(scope, site, a.question_key);
    items.push({
      question_key: key,
      question_text: String(a.question_text || "").slice(0, 500),
      answer: String(a.answer).slice(0, scope === "essay" ? 4000 : 2000),
      scope,
      site,
      // What it was before: Undo puts it back (never deletes an older answer).
      previous: before.get(key) ?? null,
    });
  }
  if (!items.length) return;
  const out = await saveCustomAnswers(items.map(({ question_key, question_text, answer }) => ({ question_key, question_text, answer })));
  if (out.error) {
    // Not saved (signed out, the app asleep): kept for the panel's "Remember".
    await updatePending(tabId, (held) => {
      for (const x of items) {
        held.answers = held.answers.filter((y) => y.question_key !== x.question_key);
        held.answers.push({ question_key: x.question_key, question_text: x.question_text, answer: x.answer });
      }
      held.answers = held.answers.slice(-40);
    });
    return;
  }
  autofill.refresh();
  await updateSaved(tabId, (list) => [
    ...list.filter((y) => !items.some((x) => x.question_key === y.question_key)),
    ...items.filter((x) => x.previous !== x.answer).map((x) => ({ ...x, at: Date.now() })),
  ]);
}

/** Profile answers typed on a page: the profile's empty fields are filled; changes wait for a tap. */
async function autoSaveProfile(tabId, fields) {
  const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
  const profile = held?.profile || {};
  const fresh = {};
  let changed = {};
  for (const [k, v] of Object.entries(fields)) {
    if (profile[k] == null || profile[k] === "") fresh[k] = v;
    else changed[k] = v;
  }
  if (Object.keys(fresh).length) {
    const out = await saveProfileFields(fresh);
    if (out.ok) {
      autofill.refresh();
      await updateSaved(tabId, (list) => [
        ...list,
        ...Object.entries(fresh).map(([k, v]) => ({ question_key: `profile:${k}`, question_text: k.replace(/_/g, " "), answer: String(v), scope: "profile", at: Date.now() })),
      ]);
    } else {
      changed = { ...changed, ...fresh };
    }
  }
  if (Object.keys(changed).length) {
    await updatePending(tabId, (p) => {
      p.profile = { ...p.profile, ...changed };
    });
  }
}

// The résumé picked for an application (spec 020), kept per saved job (or per
// page when the page isn't a saved job) — never per tab, so going to another
// job in the same tab never takes the last job's résumé along.
const choiceKeyFor = (job, url) => (job ? `je_resume_choice:job:${job.id}` : `je_resume_choice:page:${pageId(url || "")}`);

// The saved jobs, held here so the background can tell which job a page is
// even with the panel closed (the panel's own matching, shared).
const SAVED_CACHE = "je_saved_cache";
const SAVED_CACHE_MS = 2 * 60_000;

async function linkedJob(tab) {
  if (!tab?.url) return null;
  let { [SAVED_CACHE]: cache } = await chrome.storage.local.get(SAVED_CACHE);
  if (!cache || Date.now() - (cache.at || 0) > SAVED_CACHE_MS) {
    await listSaved(cache?.version || null).catch(() => {});
    ({ [SAVED_CACHE]: cache } = await chrome.storage.local.get(SAVED_CACHE));
  }
  return matchJob(tab, cache?.jobs || []);
}

async function matchJob(tab, jobs) {
  if (!jobs.length) return null;
  const { je_not_this: notThis = {}, je_page_job: pinned = {} } = await chrome.storage.local.get(["je_not_this", "je_page_job"]);
  const pid = pageId(tab.url);
  return bestJobMatch({ url: tab.url, title: tab.title || "" }, jobs, notThis[pid] || [], pinned[pid]) || null;
}

/** A message from the extension's own pages (the panel), never a web page. */
function fromExtension(sender) {
  return String(sender?.url || "").startsWith(chrome.runtime.getURL(""));
}

/** A saved job from the list held here, by id. */
async function savedJobById(id) {
  const { [SAVED_CACHE]: cache } = await chrome.storage.local.get(SAVED_CACHE);
  return (cache?.jobs || []).find((j) => j.id === id) || null;
}

/** The saved job a page is by itself (no carrying, never a fetch). */
async function ownJob(tab) {
  if (!tab?.url) return null;
  const { [SAVED_CACHE]: cache } = await chrome.storage.local.get(SAVED_CACHE);
  return matchJob(tab, cache?.jobs || []);
}

async function learnCompanyLink(jobId, url) {
  const token = await getValidToken();
  if (!token) return;
  const res = await fetchWithTimeout(`${cfg.API_BASE}/v1/saved-jobs/${encodeURIComponent(jobId)}/company-link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: String(url).slice(0, 2000) }),
  }).catch(() => null);
  // Learned: the list carries it from now on.
  if (res?.ok && (await res.json().catch(() => null))?.saved) await listSaved(null).catch(() => {});
}

const tabJobs = createTabJobs({
  ownMatch: ownJob,
  learnLink: learnCompanyLink,
  run: { opened: (tab, opener) => applyRun.tabOpened(tab, opener), landed: (tab, openerId) => applyRun.tabLanded(tab, openerId) },
});

/**
 * This application's résumé: a linked job's own (set in the panel or the app
 * — the job is the one source of truth), else one chosen for this page.
 */
async function resumeFor(tab) {
  const job = await linkedJob(tab);
  const key = choiceKeyFor(job, tab?.url);
  const { [key]: held } = await chrome.storage.session.get(key);
  if (job) {
    const resumeId = job.resume_id || null;
    // A failure note only counts for the résumé it was about.
    const failed = !!resumeId && held?.failedFor === resumeId;
    return { key, choice: failed ? { resumeId, filename: held.filename || "", failed: true } : null, resumeId, job };
  }
  return { key, choice: held || null, resumeId: held ? held.resumeId || null : null, job: null };
}

// Your name, email and phone are learned only from an explicit "Always use
// this", never from pointing alone (spec 020 review).
const IDENTITY_LEARN = new Set(["@first_name", "@last_name", "@full_name", "@email", "@email_confirm", "@phone"]);

async function listResumes() {
  const token = await getValidToken();
  if (!token) return { ok: false, error: "NOT_SIGNED_IN" };
  const res = await wakeFetch(`${cfg.API_BASE}/v1/ai/resumes`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) return { ok: false, error: "Couldn't load your résumés" };
  const rows = await res.json().catch(() => []);
  return { ok: true, resumes: (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.id, filename: r.filename, active: !!r.is_active })) };
}

async function setJobResume(jobId, resumeId, usual = false) {
  const token = await getValidToken();
  if (!token) return { ok: false };
  const res = await wakeFetch(`${cfg.API_BASE}/v1/saved-jobs/${encodeURIComponent(jobId)}/resume`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ resume_id: resumeId, usual }),
  }).catch(() => null);
  return { ok: !!res?.ok };
}

/**
 * Remember an answer for a question on every site (spec 020): saved under its
 * learn key, and in the local copy at once so the next fill uses it.
 * Returns the answer it replaced, for Undo.
 */
async function learnAnswer(learn, answer) {
  const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
  const previous = (held?.answers || []).find((a) => a.question_key === learn.key)?.answer ?? null;
  const item = { question_key: learn.key, question_text: String(learn.question_text || learn.key).slice(0, 500), answer: String(answer).slice(0, 2000) };
  const out = await saveCustomAnswers([item]);
  if (out.error) return { ok: false, error: out.error };
  if (held) {
    held.answers = [...(held.answers || []).filter((a) => a.question_key !== item.question_key), item];
    await chrome.storage.local.set({ je_autofill: held });
  }
  autofill.refresh();
  return { ok: true, previous };
}

async function forgetCustomAnswer(questionKey) {
  const token = await getValidToken();
  if (!token) return { ok: false, error: "NOT_SIGNED_IN" };
  const res = await fetch(`${cfg.API_BASE}/v1/users/me/custom-answers/${encodeURIComponent(questionKey)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  return res?.ok ? { ok: true } : { ok: false, error: "Couldn't undo it" };
}

// The panel holds a port while pointing: closing the panel stops it.
try {
  chrome.runtime.onConnect.addListener((port) => {
    const m = /^pick:(\d+)$/.exec(port.name || "");
    if (!m) return;
    port.onDisconnect.addListener(() => {
      const tabId = Number(m[1]);
      chrome.storage.session.get(pickKey(tabId)).then((held) => held[pickKey(tabId)] && stopPick(tabId));
    });
  });
} catch {
  /* runtime unavailable */
}

// "Point at a box" (spec 017): pointing in every frame of the tab, the box the
// user clicked (its question + fingerprint, never a value), and the answer
// they chose — filled in that frame, then remembered in their account.
const pickKey = (tabId) => `je_pick:${tabId}`;
const changed = (tabId) => chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {});

async function startPick(tabId) {
  await chrome.storage.session.set({ [pickKey(tabId)]: { state: "pointing", at: Date.now() } });
  chrome.tabs.sendMessage(tabId, { type: "startPick" }).catch(() => {});
  changed(tabId);
}

async function stopPick(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "stopPick" }).catch(() => {});
  await chrome.storage.session.remove(pickKey(tabId));
  changed(tabId);
}

/** Remember a taught box in the account (it rides in the autofill bundle). */
async function saveTaught({ site, fingerprint, profile_key, answer }) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const res = await fetch(`${cfg.API_BASE}/v1/autofill/taught`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(profile_key ? { site, fingerprint, profile_key } : { site, fingerprint, answer }),
  }).catch(() => null);
  if (!res?.ok) return { error: "Couldn't remember it this time" };
  const body = await res.clone().json().catch(() => ({}));
  // In the copy right away (the next page fills it even before the copy is
  // fetched again), then the account's version.
  const { id } = await res.json().catch(() => ({}));
  const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
  if (held) {
    held.taught = [
      ...(held.taught || []).filter((t) => !(t.site === site && sameBox(t.fingerprint, fingerprint))),
      { id, site, fingerprint, profile_key: profile_key || null, answer: profile_key ? null : answer },
    ];
    await chrome.storage.local.set({ je_autofill: held });
  }
  autofill.refresh();
  chrome.runtime.sendMessage({ type: "taughtChanged" }).catch(() => {});
  return { ok: true, id: body.id };
}

async function taughtApi(method, path = "") {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const res = await fetch(`${cfg.API_BASE}/v1/autofill/taught${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res?.ok) return { error: "Couldn't reach Job Enhancer" };
  if (method === "DELETE") {
    autofill.refresh();
    chrome.runtime.sendMessage({ type: "taughtChanged" }).catch(() => {});
  }
  return { ok: true, items: method === "GET" ? await res.json() : undefined };
}

// What the user typed that the app could remember (answers and profile
// answers), noticed when they moved on — kept per tab until saved or dismissed.
// Never saved without the user's press in the side panel.
const pendingKey = (tabId) => `je_pending:${tabId}`;
const keepKey = (tabId) => `je_keep:${tabId}`;
const filesKey = (tabId) => `je_files:${tabId}`; // file boxes tried (spec 037)

// Hosts that serve many companies' applications: the company is in the path.
const SHARED_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|jobvite\.com)$/i;
const KEEP_MS = 2 * 60 * 60 * 1000; // keep filling lasts an application, not forever

/** Which application a page belongs to: its host (one company's Workday is
 *  vellacor.wd5.myworkdayjobs.com), plus the company's path on shared hosts. */
function siteOf(url) {
  try {
    const u = new URL(url);
    if (SHARED_HOSTS.test(u.hostname)) return `${u.hostname}/${u.pathname.split("/")[1] || ""}`;
    return u.hostname;
  } catch {
    return "";
  }
}

let pendingWrites = Promise.resolve();
function updatePending(tabId, change) {
  pendingWrites = pendingWrites
    .catch(() => {})
    .then(async () => {
      const key = pendingKey(tabId);
      const { [key]: held = { answers: [], profile: {} } } = await chrome.storage.session.get(key);
      change(held);
      await chrome.storage.session.set({ [key]: held });
      chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {});
    });
  return pendingWrites;
}

/** Merge profile fields onto the saved profile (never wiping other fields). */
async function saveProfileFields(fields) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  // Only the chosen fields: the profile save merges, so nothing else changes.
  const res = await fetch(`${cfg.API_BASE}/v1/users/me/application-profile`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (res.ok) return { ok: true };
  return { error: res.status === 422 ? "One of those values isn't valid. Uncheck it and try again." : "Couldn't save your profile" };
}

async function clearFillSession(tabId) {
  await chrome.storage.session.remove(fillKey(tabId)).catch(() => {});
  chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {});
}

try {
  // Which job each tab is applying for (spec 040).
  chrome.tabs.onCreated.addListener((tab) => {
    tabJobs.opened(tab).catch(() => {});
  });
  chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
    if (info.status === "complete") tabJobs.loaded(tab).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabJobs.closed(tabId).catch(() => {});
    clearFillSession(tabId);
    presence.clear(tabId);
    chrome.storage.session.remove([pendingKey(tabId), keepKey(tabId), pickKey(tabId), savedKey(tabId), trackedKey(tabId), `je_edits:${tabId}`, filesKey(tabId)]).catch(() => {});
  });
  // A new page in the tab: last page's review no longer applies.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (!info.url) return;
    clearFillSession(tabId);
    // Pointing ends with the page (an in-page step change keeps the old copy).
    chrome.storage.session.get(pickKey(tabId)).then((held) => {
      if (!held[pickKey(tabId)]) return;
      chrome.tabs.sendMessage(tabId, { type: "stopPick" }).catch(() => {});
      chrome.storage.session.remove(pickKey(tabId)).then(() => changed(tabId));
    });
    // The new page reports its own form; ask again once it has settled, in
    // case a frame reported before this cleared it (an in-page address change).
    presence.clear(tabId).then(() => setTimeout(() => presence.probe(tabId), 1000));
  });
} catch {
  /* tabs API unavailable */
}

// The keyboard shortcut (chrome://extensions/shortcuts): fill the active tab.
try {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "autofill") return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) pressTab(tab.id); // the badge shows how it went
  });
} catch {
  /* commands API unavailable */
}

// AI field mapper: send the fields the deterministic pass couldn't fill; the
// backend grounds the model on the user's data and returns { mappings }.
async function aiMapFields(fields) {
  const token = await getValidToken();
  if (!token) return { mappings: {} };
  const res = await fetch(`${cfg.API_BASE}/v1/ai/autofill-map`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return { mappings: {} };
  return res.json().catch(() => ({ mappings: {} }));
}

// The résumé parsed into structured work history — the extension fills Workday
// "Work Experience" sections from it. Returns { entries: [...] } (never throws).
async function getWorkHistory(resumeId) {
  const token = await getValidToken();
  if (!token) return { entries: [] };
  const qs = resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : "";
  const res = await fetch(`${cfg.API_BASE}/v1/ai/work-history${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return { entries: [] };
  return res.json().catch(() => ({ entries: [] }));
}

// The user's Claude Project link — one source of truth on the account, shared
// with the web app (edit in either, both update).
async function getClaudeProjectUrl() {
  const token = await getValidToken();
  if (!token) return { ok: false, url: "" };
  const res = await fetch(`${cfg.API_BASE}/v1/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, url: "" };
  const me = await res.json().catch(() => ({}));
  return { ok: true, url: me.claude_project_url || "" };
}

async function saveClaudeProjectUrl(url) {
  const token = await getValidToken();
  if (!token) return { ok: false };
  const res = await fetch(`${cfg.API_BASE}/v1/users/me/claude-project`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ claude_project_url: url || "" }),
  });
  return { ok: res.ok };
}

// Save answers the user just taught us (learn-as-you-go). Returns { saved }.
async function saveCustomAnswers(answers) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const res = await fetch(`${cfg.API_BASE}/v1/users/me/custom-answers`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) return { error: "Couldn't save answers" };
  const saved = await res.json().catch(() => []);
  return { saved: Array.isArray(saved) ? saved.length : 0 };
}

// Bump usage insights for remembered answers autofill just reused. Best-effort —
// never blocks or errors the fill flow (returns { ok } quietly).
async function markAnswersUsed(questionKeys) {
  const keys = Array.isArray(questionKeys) ? questionKeys : [];
  if (!keys.length) return { ok: true };
  const token = await getValidToken();
  if (!token) return { ok: false };
  const res = await fetch(`${cfg.API_BASE}/v1/users/me/custom-answers/used`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question_keys: keys }),
  }).catch(() => null);
  return { ok: !!res?.ok };
}

// AI document for the job being applied to, written from the active resume +
// the job's stored description. docType is "cover_letter" or "resume".
// Returns { content, docId } or { error }.
async function generateDocument(jobListingId, docType) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const resumesRes = await fetch(`${cfg.API_BASE}/v1/ai/resumes`, { headers });
  if (resumesRes.status === 401) return { error: "NOT_SIGNED_IN" };
  const resumes = resumesRes.ok ? await resumesRes.json() : [];
  const active = resumes.find((r) => r.is_active);
  if (!active) return { error: "NO_RESUME" };

  const res = await fetch(`${cfg.API_BASE}/v1/ai/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      resume_id: active.id,
      document_type: docType === "resume" ? "resume" : "cover_letter",
      job_listing_id: jobListingId,
    }),
  });
  if (res.status === 429) return { error: "AI rate limit — try again in a minute" };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("JE doc generation failed", res.status, text);
    return { error: friendlyApiError(res.status, text) || "Generation failed" };
  }
  const doc = await res.json();
  return {
    content: doc.edited_content || doc.content || "",
    docId: doc.id,
    resumeFilename: active.filename || "",
  };
}

// The "use my own Claude" bridge: build a ready-to-paste prompt (job + resume +
// instructions) on the server so it matches exactly what NVIDIA is asked. The
// user pastes it into their OWN Claude — no key, no ToS risk. Returns
// { prompt, job_title, company } or { error }.
async function buildPrompt(jobListingId, docType) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const resumesRes = await fetch(`${cfg.API_BASE}/v1/ai/resumes`, { headers });
  if (resumesRes.status === 401) return { error: "NOT_SIGNED_IN" };
  const resumes = resumesRes.ok ? await resumesRes.json() : [];
  const active = resumes.find((r) => r.is_active);
  if (!active) return { error: "NO_RESUME" };

  const res = await fetch(`${cfg.API_BASE}/v1/ai/prompt`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      resume_id: active.id,
      document_type: docType === "resume" ? "resume" : "cover_letter",
      job_listing_id: jobListingId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: friendlyApiError(res.status, text) || "Couldn't build the prompt" };
  }
  const d = await res.json();
  return {
    prompt: d.prompt,
    jobTitle: d.job_title,
    company: d.company,
    resumeId: active.id,
    resumeFilename: active.filename || "",
  };
}

// Save text the user generated in their own Claude (the bridge) so it lands in
// the same document + PDF pipeline as AI-generated docs. Returns { docId } or { error }.
async function saveManualDocument(jobListingId, docType, content, resumeId) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const res = await fetch(`${cfg.API_BASE}/v1/ai/documents/manual`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      resume_id: resumeId || null,
      document_type: docType === "resume" ? "resume" : "cover_letter",
      job_listing_id: jobListingId,
      content,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: friendlyApiError(res.status, text) || "Couldn't save" };
  }
  const doc = await res.json();
  return { docId: doc.id };
}

// A generated document's PDF, base64-encoded so the panel can trigger a
// download (the /pdf endpoint needs the auth header — window.open can't).
async function getDocumentPdf(docId) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const res = await fetch(`${cfg.API_BASE}/v1/ai/documents/${docId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: "Couldn't build the PDF" };
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { b64: btoa(binary) };
}

// A submit tracked on a tab: "Saved and marked applied" in the panel (spec 034).
const trackedKey = (tabId) => `je_tracked:${tabId}`;
const recentSubmits = new Map(); // tab + posting → when (one Submit, one save)

// Auto-track: the user submitted an application on an ATS page (`tab`: the
// page's own tab), or pressed Mark applied in the panel (`job.id`).
async function markApplied(job, tab = null) {
  const token = await getValidToken();
  if (!token) return { matched: false };
  let id = job.id || null;
  if (tab?.id != null) {
    // The page fires twice (a double click): once is enough.
    const once = `${tab.id}|${job.create?.url || job.title}`;
    if (Date.now() - (recentSubmits.get(once) || 0) < 30_000) return { matched: true, repeat: true };
    recentSubmits.set(once, Date.now());
    // On an applicant system's application (Workday, Greenhouse, Lever: its
    // page only reports its final Submit), the saved job this page is — the
    // same posting — no guessing by name. Anywhere else (a search box on a
    // saved job's page) never: the old exact title + company match only.
    if (!id && detectAts(tab.url || "")) id = (await linkedJob(tab).catch(() => null))?.id || null;
  }
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/mark-applied`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // The saved job's own id when it's known: that job, no guessing. A
    // Workday application for a job never saved carries what to save it as.
    body: JSON.stringify({
      title: job.title || "",
      company: job.company || "",
      ...(id ? { saved_job_id: id } : {}),
      ...(!id && job.create ? { create: job.create } : {}),
    }),
  });
  if (!res.ok) return { matched: false };
  const out = await res.json();
  if (out.matched && tab?.id != null) {
    await chrome.storage.session.set({ [trackedKey(tab.id)]: { created: !!out.created, title: job.title || "", at: Date.now() } });
    await listSaved(null).catch(() => {});
    chrome.runtime.sendMessage({ type: "jobSaved" }).catch(() => {});
    chrome.runtime.sendMessage({ type: "sessionChanged", tabId: tab.id }).catch(() => {});
  }
  return out;
}

// Bulk sync: applications the extension read off the user's Indeed "My jobs"
// page → the backend matches each to a saved job (or imports it) at the mapped
// stage. Returns { updated, imported, skipped, outcomes } or { error }.
async function syncApplications(applications) {
  const token = await getValidToken();
  if (!token) return { error: "NOT_SIGNED_IN" };
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/sync-applications`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ applications }),
  });
  if (res.status === 401) {
    await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
    return { error: "NOT_SIGNED_IN" };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("JE sync failed", res.status, text);
    return { error: friendlyApiError(res.status, text) || "Sync failed" };
  }
  return res.json();
}

// Our backend runs on a free tier that SLEEPS after ~15 min idle and takes
// 30-75s to wake. A single fetch during that window fails (network error) or
// returns a 502/503/504 while the dyno boots. wakeFetch retries those transient
// failures with backoff (~50s of waits total) so a cold backend still loads
// instead of looking broken. Supabase auth never sleeps, so only API_BASE calls
// need this.
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _WAKE_BACKOFF_MS = [2000, 3000, 5000]; // retries after the first attempt

// fetch with a HARD timeout. Without this, a stalled connection (which is what a
// cold/half-awake backend can do) leaves the promise pending forever and the
// panel is stuck on "Loading…". AbortController turns that into a clean failure
// we can retry, so the UI always resolves to jobs or a Retry button.
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function wakeFetch(url, options) {
  let lastErr;
  for (let attempt = 0; attempt <= _WAKE_BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options);
      // 502/503/504 = still waking; anything else (200/401/404/4xx) is a real
      // answer, so return it and stop retrying.
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) return res;
      lastErr = new Error(`upstream ${res.status}`);
    } catch (e) {
      lastErr = e; // network error, timeout/abort — backend unreachable or cold
    }
    if (attempt < _WAKE_BACKOFF_MS.length) await _sleep(_WAKE_BACKOFF_MS[attempt]);
  }
  throw lastErr;
}

// Unreachable even after waiting out a cold start. Report the failure — NEVER
// return an empty list here, or the panel shows "no saved jobs" when the real
// problem is the server didn't answer.
const UNREACHABLE =
  "Can't reach Job Enhancer — the server may be waking up or your connection is down.";

// The user's saved jobs for the panel — a change check, not a full download.
// Pass the version from the last answer: if nothing changed the server replies
// {changed:false} without reading the list. Otherwise it sends the slim list
// (title, company, location, URL, applied date). Never the descriptions.
async function listSaved(version) {
  const token = await getValidToken();
  if (!token) return { signedIn: false };
  const qs = version ? `?version=${encodeURIComponent(version)}` : "";
  let res;
  try {
    res = await wakeFetch(`${cfg.API_BASE}/v1/saved-jobs/summary${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { signedIn: true, error: UNREACHABLE };
  }
  // A dead session: clear it so the panel prompts a fresh sign-in instead of
  // silently showing "No saved jobs".
  if (res.status === 401) {
    await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
    return { signedIn: false };
  }
  // A backend from before the change check: use the old list, which the
  // panel's once-a-minute schedule still keeps cheap. Remove after deploy.
  if (res.status === 404) return listSavedLegacy(token);
  if (!res.ok) {
    return { signedIn: true, error: `Couldn't load your saved jobs (error ${res.status}).` };
  }
  const parsed = parseSummary(await res.json().catch(() => null));
  if (parsed.changed && parsed.jobs) await chrome.storage.local.set({ [SAVED_CACHE]: { version: parsed.version, jobs: parsed.jobs, at: Date.now() } });
  else if (parsed.changed === false) {
    const { [SAVED_CACHE]: cache } = await chrome.storage.local.get(SAVED_CACHE);
    if (cache?.version === parsed.version) await chrome.storage.local.set({ [SAVED_CACHE]: { ...cache, at: Date.now() } });
  }
  return { signedIn: true, ...parsed };
}

async function listSavedLegacy(token) {
  let res;
  try {
    res = await wakeFetch(`${cfg.API_BASE}/v1/saved-jobs/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { signedIn: true, error: UNREACHABLE };
  }
  if (!res.ok) {
    return { signedIn: true, error: `Couldn't load your saved jobs (error ${res.status}).` };
  }
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) {
    return { signedIn: true, error: "Unexpected response from the server." };
  }
  const jobs = data.map((sj) => ({
    id: sj.id,
    job_listing_id: sj.job_listing_id,
    title: sj.job_listing?.title || "Untitled",
    company: sj.job_listing?.company || "",
    location: sj.job_listing?.location || "",
    url: sj.job_listing?.apply_url || "",
    applied: !!sj.applied_at,
  }));
  return { signedIn: true, changed: true, version: null, jobs };
}

// ---- "Report a problem here" (spec 032): the owner's only -------------------
// What happened, the page (site and path only), the version, and a picture of
// the visible page if asked: never another tab, never a tab switch.

async function pagePicture(tab) {
  if (!tab?.active) return { reason: "not_showing" };
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!win || win.state === "minimized") return { reason: "not_showing" };
  const shot = await capture(chrome, tab.windowId); // waits for a free slot (2 a second)
  // Only this page: dropped if the tab or its page changed meanwhile.
  const now = await chrome.tabs.get(tab.id).catch(() => null);
  if (!now?.active || placeOf(now.url) !== placeOf(tab.url)) return { reason: "changed" };
  return shot ? { shot } : { reason: "failed" };
}

const NOT_OWNER = "Only the app's owner can send reports from here.";

async function reportProblem({ tabId, what, picture, page }) {
  if (!String(what || "").trim()) return { ok: false, error: "Say what happened." };
  const token = await getValidToken();
  if (!token) return { ok: false, error: "Sign in to Job Catcher first." };
  // The owner only, before anything is captured (the server checks again).
  const { je_is_owner } = await chrome.storage.local.get("je_is_owner");
  if (je_is_owner !== true) return { ok: false, error: NOT_OWNER };
  const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab || !placeOf(tab.url)) return { ok: false, error: "Open the page the problem is on, then report it." };
  // The panel says which page the note was written on: never another one.
  if (page != null && placeOf(tab.url) !== page) {
    return { ok: false, error: "The page changed. Open the report again on this page." };
  }
  // The picture first: the page as the owner sees it now.
  const photo = picture ? await pagePicture(tab) : { reason: "none" };
  const body = ownerReport({ what, url: tab.url, version: chrome.runtime.getManifest().version, browser: browserName() });
  const auth = { Authorization: `Bearer ${token}` };
  // Wake a sleeping server with a harmless GET first; the report itself is
  // sent once (a create is never retried: no duplicate reports).
  await wakeFetch(`${cfg.API_BASE}/health`, {}).catch(() => null);
  let res;
  try {
    res = await fetchWithTimeout(
      `${cfg.API_BASE}/v1/admin/bugs`,
      { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      60_000,
    );
  } catch {
    return { ok: false, error: `${UNREACHABLE} If it went through, it's in Bugs & ideas already.` };
  }
  if (res.status === 403) return { ok: false, error: NOT_OWNER };
  if (res.status === 401) return { ok: false, error: "Job Catcher is signed out. Sign in again, then send." };
  if (!res.ok) return { ok: false, error: friendlyApiError(res.status, await res.text().catch(() => "")) };
  const id = (await res.json().catch(() => null))?.report?.id || null;
  let pictureSent = photo.reason || "none";
  if (photo.shot && id) {
    const up = await fetchWithTimeout(`${cfg.API_BASE}/v1/admin/bugs/${encodeURIComponent(id)}/shots`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/jpeg" },
      body: photo.shot,
    }).catch(() => null);
    pictureSent = up?.ok ? "sent" : "failed";
  }
  return { ok: true, id, picture: pictureSent };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "login") {
        // Another account's copy must never fill this one's forms.
        const { je_email: before } = await chrome.storage.local.get("je_email");
        await login(msg.email, msg.password);
        await chrome.storage.local.remove("je_is_owner"); // the hello says again
        if ((before || "").toLowerCase() !== (msg.email || "").toLowerCase()) await autofill.wipe();
        autofill.refresh();
        hello(true).catch(() => {});
        sendResponse({ ok: true });
      } else if (msg.type === "authStatus") {
        const token = await getValidToken();
        const { je_email, je_latest, je_is_owner } = await chrome.storage.local.get(["je_email", "je_latest", "je_is_owner"]);
        if (token) hello().catch(() => {});
        const version = chrome.runtime.getManifest().version;
        sendResponse({
          ok: true,
          signedIn: !!token,
          email: je_email || "",
          version,
          latest: je_latest || null,
          updateAvailable: isOlder(version, je_latest),
          isOwner: !!token && je_is_owner === true,
        });
      } else if (msg.type === "connectStart") {
        sendResponse(await connect.start());
      } else if (msg.type === "connectStatus") {
        // Reads the state only (and wakes the one poller if it slept).
        sendResponse({ ok: true, ...(await connect.status()) });
      } else if (msg.type === "connectCancel") {
        sendResponse(await connect.cancel());
      } else if (msg.type === "connectOpenTab") {
        await connect.openApproval();
        sendResponse({ ok: true });
      } else if (msg.type === "signOut") {
        await revokePass();
        await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh", "je_email", "je_is_owner", "je_staged_resume", SAVED_CACHE]);
        await autofill.wipe();
        sendResponse({ ok: true });
      } else if (msg.type === "checkSaved") {
        sendResponse({ ok: true, ...(await checkSaved(msg.job)) });
      } else if (msg.type === "scoutAnySite") {
        sendResponse({ ok: true, ...(await scoutAnySite()) });
      } else if (msg.type === "applyTick") {
        // The tab decides (every frame in it, a form embedded from another
        // site included); the frame's own address only goes in the log.
        sendResponse(await applyRun.tick(sender.tab));
      } else if (msg.type === "applyBlocked") {
        // "pending": Job Catcher's own hold while a press goes through (spec 037).
        await applyRun.event("blocked_submit", sender.tab, msg.url, undefined, msg.reason === "pending" ? "pending" : undefined);
        sendResponse({ ok: true });
      } else if (msg.type === "applyPressed") {
        // The user's own press on an Apply, in the page itself (never a frame
        // in it: an ad), on a saved job's page (spec 040): the panel may ask
        // "Applying for…?" on the next page.
        await tabJobs.pressed(sender.tab, sender.frameId);
        sendResponse({ ok: true });
      } else if (msg.type === "getJobSuggestion" || msg.type === "answerLanding") {
        // The side panel's suggestion (spec 040): only the extension's own
        // pages ask or answer, never a web page's script.
        if (!fromExtension(sender)) {
          sendResponse({ ok: false });
          return;
        }
        const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
        if (msg.type === "answerLanding") {
          const out = tab ? await tabJobs.answerLanding(tab, !!msg.yes, String(msg.page || "")).catch(() => ({ refused: true })) : { refused: true };
          if (tab?.id != null) changed(tab.id);
          sendResponse({ ok: !out.refused, ...out });
          return;
        }
        const offered = tab ? await tabJobs.suggestion(tab).catch(() => null) : null;
        const job = offered ? await savedJobById(offered.jobId) : null;
        sendResponse({ ok: true, job: job ? { id: job.id, title: job.title, company: job.company } : null, ask: !!offered?.ask, page: offered?.page || "" });
      } else if (msg.type === "applySubmitPressed") {
        await applyRun.event("submit_pressed", sender.tab, msg.url);
        sendResponse({ ok: true });
      } else if (msg.type === "applySubmitFailed") {
        // Submit pressed, and the page still shows it (an error) 20 s on
        // (spec 037): it didn't go through. The page's error is data.
        await applyRun.event("submit_failed", sender.tab, msg.url, String(msg.error || "").slice(0, 200));
        sendResponse({ ok: true });
      } else if (msg.type === "applyConfirmed") {
        // "Thank you for applying" on the application's tab (spec 023).
        await applyRun.event("confirmation_seen", sender.tab, msg.url, String(msg.words || "").slice(0, 200));
        sendResponse({ ok: true });
      } else if (msg.type === "scoutCapture") {
        sendResponse({ ok: true, ...(await scoutCapture(msg.job)) });
      } else if (msg.type === "backfillJob") {
        sendResponse({ ok: true, ...(await backfillJob(msg.job)) });
      } else if (msg.type === "taughtHere") {
        // Just this site's taught boxes (never the résumé): every frame asks on load.
        const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
        sendResponse({ ok: true, taught: (held?.taught || []).filter((t) => t.site === msg.site || t.site === msg.host) });
      } else if (msg.type === "getAutofillCopy") {
        // The résumé for this application (spec 020): chosen for this job or
        // page, else the linked job's own — worked out here, so a press with
        // the panel closed (toolbar, Alt+Shift+J) uses it too.
        const tab = sender.tab;
        // On a page of an Apply with Claude run, that run's résumé (spec 026):
        // the one made for the job or picked for it, never a guess.
        const runResume = await applyRun.resumeFor(tab).catch(() => null);
        // The cover letter (spec 031): the job's pick, from the run on its
        // tab (undefined = not the run's tab), else the linked saved job.
        const runLetter = await applyRun.coverLetterFor(tab).catch(() => undefined);
        const own = await linkedJob(tab).catch(() => null);
        // The page's own saved job; else the job the user picked in the
        // panel for this one fill of this page (spec 040: "Fill with <job>'s
        // résumé and cover letter"); else none.
        const pickedId = own ? null : await tabJobs.fillJob(tab, null).catch(() => null);
        const picked = pickedId ? await savedJobById(pickedId) : null;
        const linked = own || picked;
        const coverLetterId = runLetter !== undefined ? runLetter : linked?.cover_letter_id || null;
        // The company this application is for (spec 034, "have you worked
        // here before?"): the saved job linked to the page; else the page
        // works it out itself (the Workday job's company, the site's name).
        const company = linked?.company || "";
        if (runResume) {
          // Never the usual résumé in its place: no file, and Claude is told.
          // Its jobs and schools never come from the usual (master) résumé
          // either (spec 029): with this one's not loaded, they're read from
          // it by id (getWorkHistory), else left for Claude.
          const got = await autofill.get({ resumeId: runResume, coverLetterId });
          const failed = got.chosenFailed ? { resume: null, copy: got.copy && { ...got.copy, history: null } } : {};
          sendResponse({ ok: true, ...got, ...failed, resumeId: runResume, company });
        } else {
          const { key, choice, resumeId: chosen } = await resumeFor(tab);
          // A picked job's own résumé (its tailored one), else the usual.
          const resumeId = picked ? picked.resume_id || null : chosen;
          const got = await autofill.get({ resumeId, coverLetterId });
          // Never a silent switch: the panel says the chosen résumé failed.
          if (!picked && resumeId && !!got.chosenFailed !== !!choice?.failed) {
            const { job } = await resumeFor(tab);
            const note = job ? { failedFor: got.chosenFailed ? resumeId : null, filename: choice?.filename || "" } : { ...(choice || { resumeId, filename: "" }), failed: !!got.chosenFailed };
            await chrome.storage.session.set({ [key]: note });
            if (tab?.id != null) changed(tab.id);
          }
          sendResponse({ ok: true, ...got, company });
        }
      } else if (msg.type === "listResumes") {
        sendResponse(await listResumes());
      } else if (msg.type === "chooseResume") {
        // "Filling from … · Change" (spec 020): this job's (or this page's)
        // application uses this résumé; a linked job keeps it in the account.
        // `resumeId` null = your usual résumé, on purpose.
        const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
        const job = await linkedJob(tab);
        const key = choiceKeyFor(job, tab?.url);
        // Checked first: a résumé that can't be loaded is never used silently.
        const loads = msg.resumeId ? await autofill.canLoad(msg.resumeId) : true;
        let saved = true;
        if (job) {
          // A linked job's résumé lives on the job (one source of truth, also
          // changed in the app); only a failure note for that résumé is kept.
          saved = (await setJobResume(job.id, msg.resumeId || null, !msg.resumeId)).ok;
          await listSaved(null).catch(() => {});
          await chrome.storage.session.set({ [key]: { failedFor: loads ? null : msg.resumeId || null, filename: msg.filename || "" } });
        } else {
          await chrome.storage.session.set({ [key]: { resumeId: msg.resumeId || null, filename: msg.filename || "", usual: !msg.resumeId, failed: !loads } });
        }
        changed(msg.tabId);
        sendResponse({ ok: true, saved, loads });
      } else if (msg.type === "getResumeChoice") {
        const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
        const { choice, resumeId, job } = await resumeFor(tab);
        sendResponse({ ok: true, choice: choice || null, resumeId, jobResumeId: job?.resume_id || null, jobId: job?.id || null });
      } else if (msg.type === "refreshAutofillCopy") {
        sendResponse({ ok: await autofill.refresh() });
      } else if (msg.type === "sessionUpdate") {
        if (sender.tab?.id != null) await storeFillSession(sender.tab.id, sender.frameId ?? 0, msg.session || {});

        // A résumé that didn't go into its box: the owner hears (spec 032).
        if (msg.session?.resume === "failed") {
          caught.report("resume_failed", sender.url || sender.tab?.url, "The résumé didn't go into the upload box.");
        }
        sendResponse({ ok: true });
      } else if (msg.type === "answersNoticed") {
        // Saved straight away (spec 018): what the user answered, when they
        // moved on. Shown in the panel with Edit / Undo; kept for review if
        // the app can't be reached. Never while an Apply with Claude run is open
        // (spec 029): Claude typed those, and the app learns only what the
        // user approves at the review.
        if (sender.tab?.id != null && !(await applyRun.inRun().catch(() => true))) {
          await autoSaveAnswers(sender.tab.id, msg.answers || [], msg.site || "", msg.companyKnown !== false);
        }
        sendResponse({ ok: true });
      } else if (msg.type === "profileNoticed") {
        // What the profile was missing is saved; a DIFFERENT value waits for
        // the user's one tap ("Update your profile?"), so a typo never spreads.
        // Never while an Apply with Claude run is open (spec 029).
        if (sender.tab?.id != null && !(await applyRun.inRun().catch(() => true))) {
          await autoSaveProfile(sender.tab.id, msg.fields || {});
        }
        sendResponse({ ok: true });
      } else if (msg.type === "editSavedAnswer") {
        const out = await saveCustomAnswers([{ question_key: msg.question_key, question_text: msg.question_text, answer: String(msg.answer || "").slice(0, 4000) }]);
        if (!out.error) {
          autofill.refresh();
          await updateSaved(msg.tabId, (list) => list.map((x) => (x.question_key === msg.question_key ? { ...x, answer: msg.answer } : x)));
        }
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true });
      } else if (msg.type === "undoSavedAnswer") {
        // Back to what it was before (an older answer is restored, not lost).
        const { [savedKey(msg.tabId)]: list = [] } = await chrome.storage.session.get(savedKey(msg.tabId));
        const entry = list.find((x) => x.question_key === msg.question_key);
        const out = entry?.previous
          ? await saveCustomAnswers([{ question_key: entry.question_key, question_text: entry.question_text, answer: entry.previous }]).then((r) => (r.error ? { ok: false, error: r.error } : { ok: true }))
          : await forgetCustomAnswer(msg.question_key);
        if (out.ok) {
          autofill.refresh();
          await updateSaved(msg.tabId, (list) => list.filter((x) => x.question_key !== msg.question_key));
        }
        sendResponse(out);
      } else if (msg.type === "dismissSaved") {
        await updateSaved(msg.tabId, () => []);
        sendResponse({ ok: true });
      } else if (msg.type === "savePendingAnswers") {
        const tabUrl = (await chrome.tabs.get(msg.tabId).catch(() => null))?.url || "";
        const site = siteKey(tabUrl);
        const out = await saveCustomAnswers(
          (msg.answers || [])
            .filter((a) => !(a.company && !a.essay && !site))
            .map((a) => ({
              question_key: a.essay || a.company ? answerKey(a.essay ? "essay" : "site", site, a.question_key) : a.question_key,
              question_text: a.question_text,
              answer: a.answer,
            })),
        );
        if (!out.error) {
          autofill.refresh();
          const keys = new Set((msg.answers || []).map((a) => a.question_key));
          await updatePending(msg.tabId, (held) => {
            held.answers = held.answers.filter((a) => !keys.has(a.question_key) && !(msg.dismiss || []).includes(a.question_key));
          });
        }
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
      } else if (msg.type === "savePendingProfile") {
        const fields = msg.fields || {};
        const out = Object.keys(fields).length ? await saveProfileFields(fields) : { ok: true };
        if (out.ok) {
          autofill.refresh();
          await updatePending(msg.tabId, (held) => {
            held.profile = {};
          });
        }
        sendResponse(out.ok ? { ok: true } : { ok: false, error: out.error });
      } else if (msg.type === "addToProfile") {
        // "Not in your profile yet" → Add to profile (spec 034): the user's
        // own press, so it's saved even during an Apply with Claude run (it's
        // not learning from typing). Saved once, filled into the box, and
        // every later application has it.
        const key = String(msg.key || "");
        const raw = String(msg.value ?? "").trim().slice(0, 300);
        const value = LEARNABLE_PROFILE.has(key) && raw ? profileValue(key, raw) : null;
        if (value === null || value === "") {
          sendResponse({ ok: false, error: "That doesn't look right for this box. Check it and try again." });
        } else {
          const out = await saveProfileFields({ [key]: value });
          if (!out.ok) {
            sendResponse({ ok: false, error: out.error || "Couldn't save your profile. Try again." });
          } else {
            autofill.refresh();
            const shown = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
            await updateSaved(msg.tabId, (list) => [
              ...list.filter((x) => x.question_key !== `profile:${key}`),
              { question_key: `profile:${key}`, question_text: key.replace(/_/g, " "), answer: shown, scope: "profile", at: Date.now() },
            ]);
            const opts = msg.frameId != null ? { frameId: msg.frameId } : undefined;
            const filled = await chrome.tabs
              .sendMessage(msg.tabId, { type: "fillAction", action: "useProfile", id: msg.id, value: valueForms(key, shown) }, opts)
              .catch(() => null);
            sendResponse({ ok: true, filled: !!filled?.ok });
          }
        }
      } else if (msg.type === "dismissPending") {
        await updatePending(msg.tabId, (held) => {
          if (msg.kind === "profile") held.profile = {};
          else held.answers = [];
        });
        sendResponse({ ok: true });
      } else if (msg.type === "setKeepFilling") {
        // From the page (after a press) or the panel's switch.
        const tabId = msg.tabId ?? sender.tab?.id;
        const url = msg.tabId != null ? (await chrome.tabs.get(msg.tabId).catch(() => null))?.url : sender.tab?.url;
        if (tabId != null) {
          await chrome.storage.session.set({
            [keepKey(tabId)]: msg.on
              ? { on: true, site: siteOf(url || ""), until: Date.now() + KEEP_MS }
              : { on: false, userOff: msg.tabId != null, site: siteOf(url || "") },
          });
          if (msg.tabId != null) chrome.tabs.sendMessage(tabId, { type: "fillAction", action: "keep", value: !!msg.on }).catch(() => {});
          chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {});
        }
        sendResponse({ ok: true });
      } else if (msg.type === "userEdit") {
        // A box the user typed in or chose on this application (spec 020):
        // kept per tab and site so a page that redraws its rows (Back, a
        // resumed draft) still knows it's theirs. Never sent anywhere.
        const tabId = sender.tab?.id;
        if (tabId != null && typeof msg.key === "string" && msg.key && msg.key.length <= 400) {
          const k = `je_edits:${tabId}`;
          const site = siteOf(sender.tab?.url || "");
          const { [k]: held } = await chrome.storage.session.get(k);
          const edits = held?.site === site ? { ...held.edits } : {};
          delete edits[msg.key]; // newest last
          edits[msg.key] = String(msg.value ?? "").slice(0, 500);
          const keys = Object.keys(edits);
          for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete edits[old];
          await chrome.storage.session.set({ [k]: { site, edits } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === "getUserEdits") {
        const tabId = sender.tab?.id;
        const k = `je_edits:${tabId}`;
        const { [k]: held } = tabId != null ? await chrome.storage.session.get(k) : {};
        sendResponse({ ok: true, edits: held?.site === siteOf(sender.tab?.url || "") ? held.edits : {} });
      } else if (msg.type === "resumeUploaded") {
        // The résumé is in this application: automatic steps never upload it again.
        if (sender.tab?.id != null) {
          await chrome.storage.session.set({ [`je_resume:${sender.tab.id}`]: { site: siteOf(sender.tab.url || ""), at: Date.now() } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === "fileTried") {
        // A file box tried on this tab (spec 037): kept for the application,
        // so a press, a step filled by itself or a fresh Job Catcher never
        // attaches it again. Never the file or its name.
        const tabId = sender.tab?.id;
        if (tabId != null && typeof msg.key === "string" && msg.key.length <= 2600) {
          const k = filesKey(tabId);
          const site = siteOf(sender.tab?.url || "");
          const run = (await applyRun.runFor(sender.tab).catch(() => null)) || "";
          const { [k]: held } = await chrome.storage.session.get(k);
          const same = held?.site === site && (held.run || "") === run && Date.now() - (held.at || 0) < KEEP_MS;
          const tried = same ? { ...held.tried } : {};
          const state = msg.state || {};
          if ((state.s === "attached" || state.s === "unverified") && Number.isFinite(state.at)) tried[msg.key] = { s: state.s, at: state.at };
          else delete tried[msg.key];
          const keys = Object.keys(tried);
          for (const old of keys.slice(0, Math.max(0, keys.length - 40))) delete tried[old];
          await chrome.storage.session.set({ [k]: { site, run, at: Date.now(), tried } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === "getFilesTried") {
        // Only this application's, for the run this tab is filling (if any).
        const tabId = sender.tab?.id;
        const k = filesKey(tabId);
        const run = (await applyRun.runFor(sender.tab).catch(() => null)) || "";
        const { [k]: held } = tabId != null ? await chrome.storage.session.get(k) : {};
        const fresh = held?.site === siteOf(sender.tab?.url || "") && (held.run || "") === run && Date.now() - (held.at || 0) < KEEP_MS;
        sendResponse({ ok: true, tried: fresh ? held.tried : {}, run });
      } else if (msg.type === "getKeepFilling") {
        const tabId = sender.tab?.id;
        const { [keepKey(tabId)]: keep } = tabId != null ? await chrome.storage.session.get(keepKey(tabId)) : {};
        // Only on the same site: the application, not wherever the tab goes next.
        const here = siteOf(sender.tab?.url || sender.url || "");
        const rk = `je_resume:${tabId}`;
        const { [rk]: resume } = tabId != null ? await chrome.storage.session.get(rk) : {};
        sendResponse({
          ok: true,
          resumeDone: !!resume && resume.site === here && Date.now() - resume.at < KEEP_MS,
          on: !!keep?.on && keep.site === here && (keep.until || 0) > Date.now(),
          userOff: !!keep?.userOff && keep.site === here,
        });
      } else if (msg.type === "formPresence") {
        if (sender.tab?.id != null) await presence.storePresence(sender.tab.id, sender.frameId ?? 0, msg.presence);
        sendResponse({ ok: true });
      } else if (msg.type === "fillStatus") {
        if (sender.tab?.id != null) await presence.frameStatus(sender.tab.id, msg.status);
        sendResponse({ ok: true });
      } else if (msg.type === "pressAutofill") {
        // The panel's Autofill button (or the page, for a tab id it knows).
        const tabId = msg.tabId ?? sender.tab?.id;
        // The panel's "Fill with <job>'s résumé and cover letter" (`withJob`,
        // spec 040) picks the suggested job for this one fill; its plain
        // Autofill, the usual résumé.
        if (tabId != null && fromExtension(sender)) {
          const tab = await chrome.tabs.get(tabId).catch(() => null);
          if (tab && !(await tabJobs.pick(tab, msg.withJob || null).catch(() => false))) {
            sendResponse({ ok: false, problem: "refresh" });
            return;
          }
        }
        sendResponse(tabId != null ? await pressTab(tabId) : { ok: false, problem: "refresh" });
      } else if (msg.type === "startPick") {
        await startPick(msg.tabId);
        sendResponse({ ok: true });
      } else if (msg.type === "stopPick") {
        await stopPick(msg.tabId);
        sendResponse({ ok: true });
      } else if (msg.type === "picked") {
        // A frame's box was clicked: the other frames stop pointing.
        const tabId = sender.tab?.id;
        if (tabId != null) {
          const { field, fingerprint, site, refused, value, known, learn } = msg;
          const pick = { state: "picked", frameId: sender.frameId ?? 0, field, fingerprint, site, refused: refused || "", value: value || "", known: known || null, learn: learn || null, at: Date.now() };
          chrome.tabs.sendMessage(tabId, { type: "stopPick" }).catch(() => {});
          // A box that already holds something is saved straight away (Undo
          // in the panel) — unless it's what Job Catcher would put there
          // anyway. Spec 020: saved for that question on EVERY site (its
          // "learn" key); a box with no such key stays with this site.
          if (!pick.refused && pick.value && msg.saveable) {
            if (known?.value && known.value.trim().toLowerCase() === pick.value.trim().toLowerCase()) pick.alreadySaved = true;
            else if (pick.learn && IDENTITY_LEARN.has(pick.learn.key)) {
              // Your name, email or phone: only an explicit "Always use this"
              // changes it, never just pointing at a box (spec 020 review).
            } else if (pick.learn) {
              const out = await learnAnswer(pick.learn, pick.value);
              if (out.ok) pick.autoSaved = { key: pick.learn.key, previous: out.previous, answer: pick.value, scope: pick.learn.scope };
            } else {
              const out = await saveTaught({ site, fingerprint, answer: pick.value });
              if (out.ok) pick.autoSaved = { id: out.id, answer: pick.value, scope: "site" };
            }
          }
          await chrome.storage.session.set({ [pickKey(tabId)]: pick });
          changed(tabId);
        }
        sendResponse({ ok: true });
      } else if (msg.type === "pickCancelled") {
        if (sender.tab?.id != null) await stopPick(sender.tab.id);
        sendResponse({ ok: true });
      } else if (msg.type === "fillPicked") {
        // The panel's choice for the picked box: fill it there, remember it,
        // and point again for the next box.
        const { [pickKey(msg.tabId)]: pick } = await chrome.storage.session.get(pickKey(msg.tabId));
        if (!pick?.field || pick.refused) {
          sendResponse({ ok: false, reason: pick?.refused || "gone" });
        } else {
          // "Update my profile": the profile answer changes everywhere first.
          if (msg.updateProfile && pick.known?.key && msg.answer) {
            const v = profileValue(pick.known.key, msg.answer);
            if (v == null) return sendResponse({ ok: false, reason: "not_profile" });
            const saved = await saveProfileFields({ [pick.known.key]: v });
            if (!saved.ok) return sendResponse({ ok: false, reason: "profile" });
            autofill.refresh();
          }
          const out = await chrome.tabs
            .sendMessage(msg.tabId, { type: "fillPicked", fieldId: pick.field.id, profile_key: msg.profile_key, answer: msg.answer }, { frameId: pick.frameId })
            .catch(() => null);
          let remembered = false;
          if (out?.ok && msg.remember) {
            // Every site (spec 020), unless the user chose "Only this site",
            // picked a profile answer for this box, or the box has no key.
            if (msg.answer && !msg.profile_key && msg.scope !== "site" && pick.learn) {
              remembered = (await learnAnswer(pick.learn, msg.answer)).ok;
            } else {
              remembered = !(await saveTaught({ site: pick.site, fingerprint: pick.fingerprint, profile_key: msg.profile_key, answer: msg.answer })).error;
            }
          }
          if (out?.ok) await startPick(msg.tabId);
          sendResponse({ ok: !!out?.ok, reason: out?.reason || (out ? "" : "refresh"), remembered });
        }
      } else if (msg.type === "undoPickSave") {
        // Undo the automatic save of a clicked box.
        const { [pickKey(msg.tabId)]: pick } = await chrome.storage.session.get(pickKey(msg.tabId));
        if (pick?.autoSaved?.key) {
          // Back to the answer it had before (an older answer is never lost).
          if (pick.autoSaved.previous) await learnAnswer({ ...pick.learn, key: pick.autoSaved.key }, pick.autoSaved.previous);
          else await forgetCustomAnswer(pick.autoSaved.key);
          autofill.refresh();
          delete pick.autoSaved;
          await chrome.storage.session.set({ [pickKey(msg.tabId)]: pick });
          changed(msg.tabId);
        } else if (pick?.autoSaved?.id) {
          await taughtApi("DELETE", `/${encodeURIComponent(pick.autoSaved.id)}`);
          const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
          if (held?.taught) {
            held.taught = held.taught.filter((t) => t.id !== pick.autoSaved.id);
            await chrome.storage.local.set({ je_autofill: held });
          }
          delete pick.autoSaved;
          await chrome.storage.session.set({ [pickKey(msg.tabId)]: pick });
          changed(msg.tabId);
        }
        sendResponse({ ok: true });
      } else if (msg.type === "listTaught") {
        sendResponse(await taughtApi("GET"));
      } else if (msg.type === "forgetTaught") {
        sendResponse(await taughtApi("DELETE", `/${encodeURIComponent(msg.id)}`));
      } else if (msg.type === "readAgain") {
        sendResponse(await presence.readAgain(msg.tabId));
      } else if (msg.type === "scanReport") {
        sendResponse({ ok: true, report: await presence.report(msg.tabId) });
      } else if (msg.type === "probeTab") {
        presence.probe(msg.tabId);
        sendResponse({ ok: true });
      } else if (msg.type === "getFillSession") {
        sendResponse({ ok: true, ...(await getFillSession(msg.tabId)) });
      } else if (msg.type === "fillAction") {
        // From the side panel, to the frame that owns the field.
        const opts = msg.frameId != null ? { frameId: msg.frameId } : undefined;
        const out = await chrome.tabs
          .sendMessage(msg.tabId, { type: "fillAction", action: msg.action, id: msg.id, value: msg.value }, opts)
          .catch(() => null);
        sendResponse({ ok: !!out, ...(out || {}) });
      } else if (msg.type === "aiMapFields") {
        sendResponse({ ok: true, ...(await aiMapFields(msg.fields || [])) });
      } else if (msg.type === "getWorkHistory") {
        sendResponse({ ok: true, ...(await getWorkHistory(msg.resumeId || null)) });
      } else if (msg.type === "getClaudeProjectUrl") {
        sendResponse(await getClaudeProjectUrl());
      } else if (msg.type === "saveClaudeProjectUrl") {
        sendResponse(await saveClaudeProjectUrl(msg.url || ""));
      } else if (msg.type === "saveCustomAnswers") {
        const out = await saveCustomAnswers(msg.answers || []);
        if (!out.error) autofill.refresh(); // the next fill knows them
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
      } else if (msg.type === "markAnswersUsed") {
        sendResponse(await markAnswersUsed(msg.question_keys || []));
      } else if (msg.type === "markApplied") {
        // From a page (its Submit): that tab; from the panel: the job it names.
        sendResponse({ ok: true, ...(await markApplied(msg.job || {}, sender.tab || null)) });
      } else if (msg.type === "generateDocument") {
        const out = await generateDocument(msg.job_listing_id, msg.docType);
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
      } else if (msg.type === "buildPrompt") {
        const out = await buildPrompt(msg.job_listing_id, msg.docType);
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
      } else if (msg.type === "saveManualDocument") {
        const out = await saveManualDocument(
          msg.job_listing_id,
          msg.docType,
          msg.content,
          msg.resume_id,
        );
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
      } else if (msg.type === "getDocumentPdf") {
        const out = await getDocumentPdf(msg.docId);
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
      } else if (msg.type === "syncApplications") {
        const out = await syncApplications(msg.applications || []);
        sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
      } else if (msg.type === "listSaved") {
        sendResponse({ ok: true, ...(await listSaved(msg.version || null)) });
      } else if (msg.type === "reportProblem") {
        sendResponse(await reportProblem(msg));
      } else if (msg.type === "saveJob") {
        let saved;
        try {
          saved = await saveJob(msg.job);
        } catch (e) {
          // A real failure (not "already saved", not signed out): the owner hears.
          // The page saved from (a Save button), else the posting's own address (the panel).
          const page = placeOf(sender.tab?.url) ? sender.tab.url : msg.job?.url;
          if (isSaveFailure(e?.message)) caught.report("save_failed", page, e.message || "Save failed");
          throw e;
        }
        sendResponse({ ok: true, saved });
        // If a page (content-script) card triggered it, tell the side panel to
        // update its list. (Panel-initiated saves update themselves.)
        if (sender.tab) {
          chrome.runtime.sendMessage({ type: "jobSaved", job: msg.job }).catch(() => {});
        }
      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // keep the channel open for the async response
});
