(() => {
  // src/errors.js
  function friendlyApiError(status, text) {
    try {
      const d = JSON.parse(text);
      if (typeof d.detail === "string") return d.detail;
      if (Array.isArray(d.detail)) {
        const parts = d.detail.map((e) => {
          const field = (e.loc || []).filter((p) => p !== "body").join(".");
          return field && e.msg ? `${field}: ${e.msg}` : e.msg || "";
        }).filter(Boolean);
        if (parts.length) return parts.join("; ").slice(0, 140);
      }
    } catch {
    }
    return (text || "").slice(0, 140) || `Request failed (${status})`;
  }

  // src/background.entry.js
  importScripts("/config.js");
  var cfg = self.JOB_ENHANCER_CONFIG;
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    });
  });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  });
  async function storeSession(d, email) {
    const patch = {
      je_token: d.access_token,
      je_expires: d.expires_at,
      je_refresh: d.refresh_token
    };
    if (email) patch.je_email = email;
    await chrome.storage.local.set(patch);
  }
  var _refreshInFlight = null;
  async function refreshToken(je_refresh) {
    const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: je_refresh })
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
      "je_refresh"
    ]);
    if (je_token && je_expires && je_expires * 1e3 > Date.now() + 3e4) {
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
      body: JSON.stringify({ email, password })
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
      body: JSON.stringify(job)
    });
    if (res.status === 401) {
      await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
      throw new Error("NOT_SIGNED_IN");
    }
    if (res.status === 409) {
      await backfillJob(job).catch(() => {
      });
      throw new Error("Already in your tracker");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("JE save failed", res.status, text, job);
      throw new Error(friendlyApiError(res.status, text) || "Save failed");
    }
    return res.json();
  }
  async function backfillJob(job) {
    const token = await getValidToken();
    if (!token) return { updated: false };
    const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/backfill`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(job)
    });
    if (res.status === 401) {
      await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
      return { updated: false };
    }
    if (!res.ok) return { updated: false };
    return res.json();
  }
  async function checkSaved(job) {
    const token = await getValidToken();
    if (!token) return { saved: false, signedIn: false };
    const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: job.title || "",
        company: job.company || "",
        location: job.location || ""
      })
    });
    if (!res.ok) return { saved: false, signedIn: true };
    const d = await res.json();
    return { saved: !!d.saved, needs_details: !!d.needs_details, signedIn: true };
  }
  async function getAutofillData() {
    const token = await getValidToken();
    if (!token) return { signedIn: false };
    const headers = { Authorization: `Bearer ${token}` };
    const profRes = await fetch(`${cfg.API_BASE}/v1/users/me/application-profile`, {
      headers
    });
    const profile = profRes.ok ? await profRes.json() : null;
    let { je_email: email } = await chrome.storage.local.get("je_email");
    if (!email) {
      const me = await fetch(`${cfg.API_BASE}/v1/users/me`, { headers });
      if (me.ok) email = (await me.json()).email;
    }
    let resume = null;
    const fileRes = await fetch(`${cfg.API_BASE}/v1/ai/resumes/active/file`, {
      headers
    });
    if (fileRes.ok) {
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      }
      resume = {
        b64: btoa(binary),
        filename: fileRes.headers.get("X-Resume-Filename") || "resume.pdf",
        mime: fileRes.headers.get("Content-Type") || "application/pdf"
      };
    }
    return { signedIn: true, profile, email: email || "", resume };
  }
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
        job_listing_id: jobListingId
      })
    });
    if (res.status === 429) return { error: "AI rate limit \u2014 try again in a minute" };
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("JE doc generation failed", res.status, text);
      return { error: friendlyApiError(res.status, text) || "Generation failed" };
    }
    const doc = await res.json();
    return { content: doc.edited_content || doc.content || "", docId: doc.id };
  }
  async function getDocumentPdf(docId) {
    const token = await getValidToken();
    if (!token) return { error: "NOT_SIGNED_IN" };
    const res = await fetch(`${cfg.API_BASE}/v1/ai/documents/${docId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return { error: "Couldn't build the PDF" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    return { b64: btoa(binary) };
  }
  async function markApplied(job) {
    const token = await getValidToken();
    if (!token) return { matched: false };
    const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/mark-applied`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: job.title || "", company: job.company || "" })
    });
    if (!res.ok) return { matched: false };
    return res.json();
  }
  async function listSaved() {
    const token = await getValidToken();
    if (!token) return { signedIn: false, jobs: [] };
    const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) {
      await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
      return { signedIn: false, jobs: [] };
    }
    if (!res.ok) return { signedIn: true, jobs: [] };
    const data = await res.json().catch(() => []);
    const jobs = (Array.isArray(data) ? data : []).map((sj) => ({
      id: sj.id,
      job_listing_id: sj.job_listing_id,
      title: sj.job_listing?.title || "Untitled",
      company: sj.job_listing?.company || "",
      location: sj.job_listing?.location || "",
      url: sj.job_listing?.apply_url || "",
      applied: !!sj.applied_at
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
          sendResponse({ ok: true, ...await checkSaved(msg.job) });
        } else if (msg.type === "backfillJob") {
          sendResponse({ ok: true, ...await backfillJob(msg.job) });
        } else if (msg.type === "getAutofillData") {
          sendResponse({ ok: true, ...await getAutofillData() });
        } else if (msg.type === "markApplied") {
          sendResponse({ ok: true, ...await markApplied(msg.job) });
        } else if (msg.type === "generateDocument") {
          const out = await generateDocument(msg.job_listing_id, msg.docType);
          sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
        } else if (msg.type === "getDocumentPdf") {
          const out = await getDocumentPdf(msg.docId);
          sendResponse(out.error ? { ok: false, error: out.error } : { ok: true, ...out });
        } else if (msg.type === "listSaved") {
          sendResponse({ ok: true, ...await listSaved() });
        } else if (msg.type === "saveJob") {
          const saved = await saveJob(msg.job);
          sendResponse({ ok: true, saved });
          if (sender.tab) {
            chrome.runtime.sendMessage({ type: "jobSaved", job: msg.job }).catch(() => {
            });
          }
        } else {
          sendResponse({ ok: false, error: "unknown message" });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });
})();
