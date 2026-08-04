(() => {
  // src/extract/util.js
  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function stripHtml(s) {
    return clean((s || "").replace(/<[^>]*>/g, " "));
  }
  function looksRemote(...parts) {
    return /\b(remote|work from home|wfh|telecommute|anywhere)\b/i.test(parts.filter(Boolean).join(" "));
  }

  // src/extract/jsonld-map.js
  function collectJobPostings(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) collectJobPostings(n, out);
      return;
    }
    const type = node["@type"];
    const isJob = Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
    if (isJob) out.push(node);
    if (Array.isArray(node["@graph"])) collectJobPostings(node["@graph"], out);
  }
  function orgName(hiringOrganization) {
    if (!hiringOrganization) return "";
    if (typeof hiringOrganization === "string") return clean(hiringOrganization);
    if (Array.isArray(hiringOrganization)) return orgName(hiringOrganization[0]);
    return clean(hiringOrganization.name);
  }
  function numOrNull(n) {
    const v = typeof n === "string" ? parseInt(n.replace(/[^0-9]/g, ""), 10) : n;
    return Number.isFinite(v) ? v : null;
  }
  function salaryFrom(job) {
    const b = job.baseSalary;
    const v = b?.value;
    if (v && typeof v === "object") {
      return {
        salary_min: numOrNull(v.minValue ?? v.value),
        salary_max: numOrNull(v.maxValue ?? v.value)
      };
    }
    return { salary_min: numOrNull(v), salary_max: null };
  }
  function employmentType(job) {
    const t = job.employmentType;
    return clean(Array.isArray(t) ? t[0] : t);
  }
  function addressText(jobLocation) {
    const loc = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
    const addr = loc?.address;
    if (!addr) return "";
    if (typeof addr === "string") return clean(addr);
    const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].map((p) => typeof p === "object" ? p?.name : p).filter(Boolean);
    return clean(parts.join(", "));
  }
  function mapJobPosting(job, url) {
    const title = clean(job.title);
    if (!title) return null;
    const location = addressText(job.jobLocation);
    const description = stripHtml(job.description);
    const remoteFlag = job.jobLocationType === "TELECOMMUTE" || !!job.applicantLocationRequirements || looksRemote(title, location, description);
    const { salary_min, salary_max } = salaryFrom(job);
    return {
      title,
      company: orgName(job.hiringOrganization),
      location,
      is_remote: remoteFlag,
      url: clean(job.url) || url,
      description,
      job_type: employmentType(job),
      salary_min,
      salary_max
    };
  }
  function jobPostingsFromHtml(html) {
    const postings = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while (m = re.exec(html)) {
      try {
        collectJobPostings(JSON.parse(m[1].trim()), postings);
      } catch {
      }
    }
    return postings;
  }

  // src/enrich.js
  function enrichFromHtml(html, url) {
    const out = {};
    const postings = jobPostingsFromHtml(html || "");
    if (!postings.length) return out;
    const f = mapJobPosting(postings[0], url);
    if (!f) return out;
    if (f.description) out.description = f.description;
    if (f.salary_min != null) out.salary_min = f.salary_min;
    if (f.salary_max != null) out.salary_max = f.salary_max;
    if (f.job_type) out.job_type = f.job_type;
    return out;
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
  function hostOf(u) {
    try {
      return new URL(u).hostname;
    } catch {
      return "";
    }
  }
  async function enrichIfThin(job) {
    const host = hostOf(job.url);
    const isIndeedListing = host.endsWith("indeed.com") && /\/viewjob\b/.test(job.url);
    const hasDescription = (job.description || "").length > 200;
    if (!isIndeedListing || hasDescription) return job;
    try {
      const res = await fetch(job.url, {
        credentials: "omit",
        signal: AbortSignal.timeout(5e3)
      });
      if (!res.ok) return job;
      const extra = enrichFromHtml(await res.text(), job.url);
      return {
        ...job,
        description: extra.description || job.description,
        salary_min: job.salary_min ?? extra.salary_min ?? null,
        salary_max: job.salary_max ?? extra.salary_max ?? null,
        job_type: job.job_type || extra.job_type || ""
      };
    } catch {
      return job;
    }
  }
  async function saveJob(job) {
    const token = await getValidToken();
    if (!token) throw new Error("NOT_SIGNED_IN");
    const enriched = await enrichIfThin(job);
    const res = await fetch(`${cfg.API_BASE}/v1/saved-jobs/manual`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(enriched)
    });
    if (res.status === 401) {
      await chrome.storage.local.remove(["je_token", "je_expires", "je_refresh"]);
      throw new Error("NOT_SIGNED_IN");
    }
    if (res.status === 409) throw new Error("Already in your tracker");
    if (!res.ok) throw new Error(await res.text() || "Save failed");
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
    return { saved: !!d.saved, signedIn: true };
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
      title: sj.job_listing?.title || "Untitled",
      company: sj.job_listing?.company || "",
      location: sj.job_listing?.location || "",
      url: sj.job_listing?.apply_url || ""
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
