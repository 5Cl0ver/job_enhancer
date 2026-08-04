// Background service worker — the ONLY place that talks to Supabase Auth and the
// Job Enhancer API. The side panel and the on-page Save buttons send it messages;
// it handles login, token refresh, saving, and enriching a saved job with the
// full listing detail. Centralizing here avoids CORS and keeps one source of truth.
//
// Bundled by esbuild (it imports the shared enrichment module). config.js is
// loaded at runtime from the extension root.
import { enrichFromHtml } from "./enrich.js";

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

function hostOf(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

// If a saved Indeed job is missing a real description, fetch its /viewjob page
// and pull the full description + salary + job type from the page's JSON-LD.
// This is what gets full detail for home-feed captures (where the on-page
// snippet is short/empty) and the extra fields worth filtering on later.
async function enrichIfThin(job) {
  const host = hostOf(job.url);
  const isIndeedListing = host.endsWith("indeed.com") && /\/viewjob\b/.test(job.url);
  const hasDescription = (job.description || "").length > 200;
  if (!isIndeedListing || hasDescription) return job;
  try {
    // Hard 5s cap — enrichment must NEVER hold up (or hang) the save. If Indeed
    // is slow/blocks, we save without it.
    const res = await fetch(job.url, {
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return job;
    const extra = enrichFromHtml(await res.text(), job.url);
    return {
      ...job,
      description: extra.description || job.description,
      salary_min: job.salary_min ?? extra.salary_min ?? null,
      salary_max: job.salary_max ?? extra.salary_max ?? null,
      job_type: job.job_type || extra.job_type || "",
    };
  } catch {
    return job; // enrichment is best-effort; never block a save on it
  }
}

async function saveJob(job) {
  const token = await getValidToken();
  if (!token) throw new Error("NOT_SIGNED_IN");
  const enriched = await enrichIfThin(job);
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/manual`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(enriched),
  });
  if (res.status === 401) {
    await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
    throw new Error("NOT_SIGNED_IN");
  }
  if (res.status === 409) throw new Error("Already in your tracker");
  if (!res.ok) throw new Error((await res.text()) || "Save failed");
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
  return { saved: !!d.saved, signedIn: true };
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
