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
import { sameBox } from "./autofill/fingerprint.js";
import { answerKey } from "./autofill/classify/answers.js";
import { siteKey } from "./autofill/hosts.js";
import { profileValue } from "./autofill/session.js";

importScripts("/config.js");
const cfg = self.JOB_ENHANCER_CONFIG;

// Clicking the toolbar icon opens the side panel (no popup).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Installed or updated: put the current scripts into the tabs already open,
  // so nothing needs a refresh (spec 015). Not on a Chrome update: the same
  // version is already running in those tabs.
  if (reason === "install" || reason === "update") reinjectOpenTabs().catch(() => {});
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
  if (!res.ok) return null;
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
});

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
    held.frames[frameId] = { ...session, at: Date.now() };
    await chrome.storage.session.set({ [key]: held });
    chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {});
  });
  return fillWrites;
}

// Does each tab have a form, and what is Autofill doing there (spec 016).
const presence = createFillPresence({
  notify: (tabId) => chrome.runtime.sendMessage({ type: "sessionChanged", tabId }).catch(() => {}),
});

async function getFillSession(tabId) {
  const key = fillKey(tabId);
  const pk = pendingKey(tabId);
  const kk = keepKey(tabId);
  const ik = pickKey(tabId);
  const sk = savedKey(tabId);
  const { [key]: held, [pk]: pending, [kk]: keep, [ik]: pick, [sk]: saved } = await chrome.storage.session.get([key, pk, kk, ik, sk]);
  return {
    ...(held || { frames: {} }),
    pending: pending || { answers: [], profile: {} },
    keep: !!keep?.on,
    presence: await presence.get(tabId),
    pick: pick || null,
    saved: saved || [],
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
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearFillSession(tabId);
    presence.clear(tabId);
    chrome.storage.session.remove([pendingKey(tabId), keepKey(tabId), pickKey(tabId), savedKey(tabId)]).catch(() => {});
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
    if (tab?.id) presence.press(tab.id); // the badge shows how it went
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
async function getWorkHistory() {
  const token = await getValidToken();
  if (!token) return { entries: [] };
  const res = await fetch(`${cfg.API_BASE}/v1/ai/work-history`, {
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
  const res = await fetch(`${cfg.API_BASE}/v1/users/me`, {
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

// Auto-track: the user submitted an application on an ATS page.
async function markApplied(job) {
  const token = await getValidToken();
  if (!token) return { matched: false };
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/mark-applied`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: job.title || "", company: job.company || "" }),
  });
  if (!res.ok) return { matched: false };
  return res.json();
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "login") {
        // Another account's copy must never fill this one's forms.
        const { je_email: before } = await chrome.storage.local.get("je_email");
        await login(msg.email, msg.password);
        if ((before || "").toLowerCase() !== (msg.email || "").toLowerCase()) await autofill.wipe();
        autofill.refresh();
        sendResponse({ ok: true });
      } else if (msg.type === "authStatus") {
        const token = await getValidToken();
        const { je_email } = await chrome.storage.local.get("je_email");
        sendResponse({ ok: true, signedIn: !!token, email: je_email || "" });
      } else if (msg.type === "signOut") {
        await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh", "je_email", "je_staged_resume"]);
        await autofill.wipe();
        sendResponse({ ok: true });
      } else if (msg.type === "checkSaved") {
        sendResponse({ ok: true, ...(await checkSaved(msg.job)) });
      } else if (msg.type === "scoutAnySite") {
        sendResponse({ ok: true, ...(await scoutAnySite()) });
      } else if (msg.type === "scoutCapture") {
        sendResponse({ ok: true, ...(await scoutCapture(msg.job)) });
      } else if (msg.type === "backfillJob") {
        sendResponse({ ok: true, ...(await backfillJob(msg.job)) });
      } else if (msg.type === "taughtHere") {
        // Just this site's taught boxes (never the résumé): every frame asks on load.
        const { je_autofill: held } = await chrome.storage.local.get("je_autofill");
        sendResponse({ ok: true, taught: (held?.taught || []).filter((t) => t.site === msg.site || t.site === msg.host) });
      } else if (msg.type === "getAutofillCopy") {
        sendResponse({ ok: true, ...(await autofill.get()) });
      } else if (msg.type === "refreshAutofillCopy") {
        sendResponse({ ok: await autofill.refresh() });
      } else if (msg.type === "sessionUpdate") {
        if (sender.tab?.id != null) await storeFillSession(sender.tab.id, sender.frameId ?? 0, msg.session || {});
        sendResponse({ ok: true });
      } else if (msg.type === "answersNoticed") {
        // Saved straight away (spec 018): what the user answered, when they
        // moved on. Shown in the panel with Edit / Undo; kept for review if
        // the app can't be reached.
        if (sender.tab?.id != null) await autoSaveAnswers(sender.tab.id, msg.answers || [], msg.site || "", msg.companyKnown !== false);
        sendResponse({ ok: true });
      } else if (msg.type === "profileNoticed") {
        // What the profile was missing is saved; a DIFFERENT value waits for
        // the user's one tap ("Update your profile?"), so a typo never spreads.
        if (sender.tab?.id != null) await autoSaveProfile(sender.tab.id, msg.fields || {});
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
      } else if (msg.type === "resumeUploaded") {
        // The résumé is in this application: automatic steps never upload it again.
        if (sender.tab?.id != null) {
          await chrome.storage.session.set({ [`je_resume:${sender.tab.id}`]: { site: siteOf(sender.tab.url || ""), at: Date.now() } });
        }
        sendResponse({ ok: true });
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
        sendResponse(tabId != null ? await presence.press(tabId) : { ok: false, problem: "refresh" });
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
          const { field, fingerprint, site, refused, value, known } = msg;
          const pick = { state: "picked", frameId: sender.frameId ?? 0, field, fingerprint, site, refused: refused || "", value: value || "", known: known || null, at: Date.now() };
          chrome.tabs.sendMessage(tabId, { type: "stopPick" }).catch(() => {});
          // A box that already holds something is saved for this box on this
          // site, straight away (Undo in the panel) — unless it's what Job
          // Catcher would put there anyway. The profile never changes here.
          if (!pick.refused && pick.value && msg.saveable) {
            if (known?.value && known.value.trim().toLowerCase() === pick.value.trim().toLowerCase()) pick.alreadySaved = true;
            else {
              const out = await saveTaught({ site, fingerprint, answer: pick.value });
              if (out.ok) pick.autoSaved = { id: out.id, answer: pick.value };
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
            remembered = !(await saveTaught({ site: pick.site, fingerprint: pick.fingerprint, profile_key: msg.profile_key, answer: msg.answer })).error;
          }
          if (out?.ok) await startPick(msg.tabId);
          sendResponse({ ok: !!out?.ok, reason: out?.reason || (out ? "" : "refresh"), remembered });
        }
      } else if (msg.type === "undoPickSave") {
        // Undo the automatic save of a clicked box.
        const { [pickKey(msg.tabId)]: pick } = await chrome.storage.session.get(pickKey(msg.tabId));
        if (pick?.autoSaved?.id) {
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
        sendResponse({ ok: true, ...(await getWorkHistory()) });
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
        sendResponse({ ok: true, ...(await markApplied(msg.job)) });
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
      } else if (msg.type === "saveJob") {
        const saved = await saveJob(msg.job);
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
