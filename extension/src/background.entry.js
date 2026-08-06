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

importScripts("/config.js");
const cfg = self.JOB_ENHANCER_CONFIG;

// Clicking the toolbar icon opens the side panel (no popup).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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
  const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: je_refresh }),
  });
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
    body: JSON.stringify(job),
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
    }),
  });
  if (!res.ok) return { saved: false, signedIn: true };
  const d = await res.json();
  return { saved: !!d.saved, needs_details: !!d.needs_details, signedIn: true };
}

// Everything ATS autofill needs, in one message: the profile vault, the
// user's email, and the resume file (base64 — messages are JSON-serialized).
async function getAutofillData() {
  const token = await getValidToken();
  if (!token) return { signedIn: false };
  const headers = { Authorization: `Bearer ${token}` };

  const profRes = await fetch(`${cfg.API_BASE}/v1/users/me/application-profile`, {
    headers,
  });
  const profile = profRes.ok ? await profRes.json() : null;

  let { je_email: email } = await chrome.storage.local.get("je_email");
  if (!email) {
    const me = await fetch(`${cfg.API_BASE}/v1/users/me`, { headers });
    if (me.ok) email = (await me.json()).email;
  }

  let resume = null;
  const fileRes = await fetch(`${cfg.API_BASE}/v1/ai/resumes/active/file`, {
    headers,
  });
  if (fileRes.ok) {
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    resume = {
      b64: btoa(binary),
      filename: fileRes.headers.get("X-Resume-Filename") || "resume.pdf",
      mime: fileRes.headers.get("Content-Type") || "application/pdf",
    };
  }

  return { signedIn: true, profile, email: email || "", resume };
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

// The user's saved jobs (for the "Your saved jobs" list in the panel).
async function listSaved() {
  const token = await getValidToken();
  if (!token) return { signedIn: false, jobs: [] };
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // A dead session: clear it so the panel prompts a fresh sign-in instead of
  // silently showing "No saved jobs".
  if (res.status === 401) {
    await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
    return { signedIn: false, jobs: [] };
  }
  if (!res.ok) return { signedIn: true, jobs: [] };
  const data = await res.json().catch(() => []);
  const jobs = (Array.isArray(data) ? data : []).map((sj) => ({
    id: sj.id,
    title: sj.job_listing?.title || "Untitled",
    company: sj.job_listing?.company || "",
    location: sj.job_listing?.location || "",
    url: sj.job_listing?.apply_url || "",
  }));
  return { signedIn: true, jobs };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "login") {
        await login(msg.email, msg.password);
        sendResponse({ ok: true });
      } else if (msg.type === "authStatus") {
        const token = await getValidToken();
        const { je_email } = await chrome.storage.local.get("je_email");
        sendResponse({ ok: true, signedIn: !!token, email: je_email || "" });
      } else if (msg.type === "signOut") {
        await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh", "je_email"]);
        sendResponse({ ok: true });
      } else if (msg.type === "checkSaved") {
        sendResponse({ ok: true, ...(await checkSaved(msg.job)) });
      } else if (msg.type === "backfillJob") {
        sendResponse({ ok: true, ...(await backfillJob(msg.job)) });
      } else if (msg.type === "getAutofillData") {
        sendResponse({ ok: true, ...(await getAutofillData()) });
      } else if (msg.type === "markApplied") {
        sendResponse({ ok: true, ...(await markApplied(msg.job)) });
      } else if (msg.type === "listSaved") {
        sendResponse({ ok: true, ...(await listSaved()) });
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
