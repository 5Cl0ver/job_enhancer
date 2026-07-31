// Job Enhancer — Job Catcher popup logic (plain JS, no build step).
const cfg = window.JOB_ENHANCER_CONFIG;
const $ = (id) => document.getElementById(id);

function show(view) {
  $("login-view").hidden = view !== "login";
  $("capture-view").hidden = view !== "capture";
}

// --- Auth (Supabase Auth REST — the token is stored in extension storage) ---
async function getToken() {
  const { je_token, je_expires } = await chrome.storage.local.get([
    "je_token",
    "je_expires",
  ]);
  // Treat as valid if not expired (30s buffer).
  if (je_token && (!je_expires || je_expires * 1000 > Date.now() + 30_000)) {
    return je_token;
  }
  return null;
}

async function login(email, password) {
  const res = await fetch(
    `${cfg.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || "Sign-in failed");
  await chrome.storage.local.set({
    je_token: data.access_token,
    je_expires: data.expires_at,
  });
}

async function signOut() {
  await chrome.storage.local.remove(["je_token", "je_expires"]);
  show("login");
}

// --- Read the current page for job details (runs in the tab's context) ---
async function extractJob() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const fallback = { url: tab?.url || "", title: tab?.title || "", company: "" };
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const pick = (selectors) => {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            const t = el?.innerText?.trim() || el?.content?.trim();
            if (t) return t;
          }
          return "";
        };
        const title =
          pick([
            "h1",
            '[data-testid="jobsearch-JobInfoHeader-title"]',
            ".top-card-layout__title",
            ".jobsearch-JobInfoHeader-title",
          ]) || document.title;
        const company = pick([
          '[data-testid="inlineHeader-companyName"]',
          ".topcard__org-name-link",
          '[data-company-name]',
          'a[data-tn-element="companyName"]',
          '[data-testid="jobsearch-CompanyInfoContainer"] a',
          'meta[property="og:site_name"]',
        ]);
        return {
          url: location.href,
          title: (title || "").slice(0, 300),
          company: (company || "").slice(0, 200),
        };
      },
    });
    return result || fallback;
  } catch {
    // e.g. chrome:// pages where scripts can't run
    return fallback;
  }
}

async function initCapture() {
  const job = await extractJob();
  $("f-title").value = job.title || "";
  $("f-company").value = job.company || "";
  $("f-url").value = job.url || "";
  show("capture");
}

// --- Save to the tracker ---
async function saveJob(job, token) {
  const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/manual`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (res.status === 401) {
    await chrome.storage.local.remove(["je_token", "je_expires"]);
    throw new Error("Session expired — please sign in again.");
  }
  if (res.status === 409) throw new Error("This job is already in your tracker.");
  if (!res.ok) throw new Error((await res.text()) || "Save failed");
  return res.json();
}

// --- Wire up ---
document.addEventListener("DOMContentLoaded", async () => {
  if (await getToken()) initCapture();
  else show("login");

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    const btn = e.submitter;
    btn.disabled = true;
    try {
      await login($("l-email").value, $("l-password").value);
      await initCapture();
    } catch (err) {
      $("login-error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("save-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("save-status");
    status.className = "status";
    status.textContent = "Saving…";
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const token = await getToken();
      if (!token) return show("login");
      await saveJob(
        {
          url: $("f-url").value.trim(),
          title: $("f-title").value.trim(),
          company: $("f-company").value.trim() || "Unknown",
          location: $("f-location").value.trim() || "Not specified",
          is_remote: $("f-remote").checked,
        },
        token,
      );
      status.className = "status ok";
      status.textContent = "✓ Saved to your tracker!";
    } catch (err) {
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("signout").addEventListener("click", signOut);
});
