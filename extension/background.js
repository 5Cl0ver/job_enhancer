// Background service worker — the ONLY place that talks to Supabase Auth and the
// Job Enhancer API. The side panel and the on-page Save buttons send it messages;
// it handles login, token refresh, and saving. Centralizing here avoids CORS
// (content scripts can't call the API directly) and keeps one source of truth.

importScripts("config.js");
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

async function getValidToken() {
  const { je_token, je_expires, je_refresh } = await chrome.storage.local.get([
    "je_token",
    "je_expires",
    "je_refresh",
  ]);
  if (je_token && je_expires && je_expires * 1000 > Date.now() + 30_000) {
    return je_token;
  }
  if (je_refresh) {
    const res = await fetch(
      `${cfg.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: je_refresh }),
      },
    );
    if (res.ok) {
      const d = await res.json();
      await storeSession(d);
      return d.access_token;
    }
  }
  return null;
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
  if (res.status === 409) throw new Error("Already in your tracker");
  if (!res.ok) throw new Error((await res.text()) || "Save failed");
  return res.json();
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
        await chrome.storage.local.remove([
          "je_token",
          "je_expires",
          "je_refresh",
          "je_email",
        ]);
        sendResponse({ ok: true });
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
