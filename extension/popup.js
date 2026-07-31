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
// Strategy (most reliable first): schema.org JobPosting JSON-LD → site-specific
// selectors (LinkedIn/Indeed/Glassdoor) → generic og: meta → page title.
async function extractJob() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const fallback = {
    url: tab?.url || "",
    title: tab?.title || "",
    company: "",
    location: "",
    is_remote: false,
  };
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clip = (s, n) =>
          (s ?? "").toString().trim().replace(/\s+/g, " ").slice(0, n);
        const pick = (sels) => {
          for (const s of sels) {
            const el = document.querySelector(s);
            const t = el?.getAttribute?.("content") ?? el?.innerText;
            if (t && t.trim()) return t.trim();
          }
          return "";
        };

        // 1) schema.org JobPosting (JSON-LD) — the gold standard.
        const fromJsonLd = () => {
          for (const sc of document.querySelectorAll(
            'script[type="application/ld+json"]',
          )) {
            let data;
            try {
              data = JSON.parse(sc.textContent);
            } catch {
              continue;
            }
            const nodes = Array.isArray(data) ? data : data["@graph"] || [data];
            for (const node of nodes) {
              const type = node && node["@type"];
              const isJob =
                type === "JobPosting" ||
                (Array.isArray(type) && type.includes("JobPosting"));
              if (!isJob) continue;
              const org = node.hiringOrganization;
              const company = typeof org === "string" ? org : org?.name || "";
              const loc = Array.isArray(node.jobLocation)
                ? node.jobLocation[0]
                : node.jobLocation;
              const addr = loc?.address;
              const location = addr
                ? [
                    addr.addressLocality,
                    addr.addressRegion,
                    addr.addressCountry?.name || addr.addressCountry,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : "";
              return {
                title: node.title || "",
                company,
                location,
                is_remote: node.jobLocationType === "TELECOMMUTE",
              };
            }
          }
          return null;
        };

        // 2) Site-specific selectors.
        const host = location.hostname;
        const site = () => {
          if (host.includes("linkedin")) {
            return {
              title: pick([
                "h1.top-card-layout__title",
                ".job-details-jobs-unified-top-card__job-title",
                "h1.topcard__title",
              ]),
              company: pick([
                ".topcard__org-name-link",
                ".job-details-jobs-unified-top-card__company-name a",
                ".topcard__flavor",
              ]),
              location: pick([
                ".topcard__flavor--bullet",
                ".job-details-jobs-unified-top-card__primary-description-container span",
              ]),
            };
          }
          if (host.includes("indeed")) {
            return {
              title: pick([
                'h2[data-testid="jobsearch-JobInfoHeader-title"]',
                ".jobsearch-JobInfoHeader-title",
                'h2[data-testid="simpler-jobTitle"]',
              ]),
              company: pick([
                '[data-testid="inlineHeader-companyName"]',
                '[data-company-name="true"]',
                '[data-testid="companyName"]',
                ".jobsearch-CompanyInfoContainer a",
              ]),
              location: pick([
                '[data-testid="inlineHeader-companyLocation"]',
                '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
              ]),
            };
          }
          if (host.includes("glassdoor")) {
            return {
              title: pick(['[data-test="job-title"]']),
              company: pick(['[data-test="employer-name"]']),
              location: pick(['[data-test="location"]']),
            };
          }
          return {};
        };

        const j = fromJsonLd() || {};
        const s = site();
        const title =
          j.title || s.title || pick(['meta[property="og:title"]']) || document.title;
        const company =
          j.company || s.company || pick(['meta[property="og:site_name"]']) || "";
        const locVal = j.location || s.location || "";
        const is_remote =
          !!j.is_remote || /\bremote\b/i.test(title) || /\bremote\b/i.test(locVal);

        return {
          url: location.href,
          title: clip(title, 300),
          company: clip(company, 200),
          location: clip(locVal, 200),
          is_remote,
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
  $("f-location").value = job.location || "";
  $("f-remote").checked = !!job.is_remote;
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
