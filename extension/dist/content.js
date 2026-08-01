(() => {
  // src/extract/util.js
  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function stripHtml(s) {
    return clean((s || "").replace(/<[^>]*>/g, " "));
  }
  function textFrom(root, selectors) {
    if (!root) return "";
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (!el) continue;
      const t = el.getAttribute?.("content") || el.getAttribute?.("title") || el.textContent;
      const v = clean(t);
      if (v) return v;
    }
    return "";
  }
  function looksRemote(...parts) {
    return /\b(remote|work from home|wfh|telecommute|anywhere)\b/i.test(parts.filter(Boolean).join(" "));
  }
  function mergeJob(candidates, url) {
    const out = { title: "", company: "", location: "", is_remote: false, url, description: "", _via: "" };
    for (const field of ["title", "company", "location", "description", "url"]) {
      for (const c of candidates) {
        const v = clean(c.data?.[field]);
        if (v) {
          out[field] = v;
          if (field === "title" && !out._via) out._via = c.via;
          break;
        }
      }
    }
    out.is_remote = candidates.some((c) => c.data?.is_remote === true);
    if (!out.url) out.url = url;
    return out;
  }

  // src/extract/jsonld.js
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
  function addressText(jobLocation) {
    const loc = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
    const addr = loc?.address;
    if (!addr) return "";
    if (typeof addr === "string") return clean(addr);
    const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].map((p) => typeof p === "object" ? p?.name : p).filter(Boolean);
    return clean(parts.join(", "));
  }
  function extractFromJsonLd(doc, url) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    const postings = [];
    for (const s of scripts) {
      let parsed;
      try {
        parsed = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      collectJobPostings(parsed, postings);
    }
    if (!postings.length) return null;
    const job = postings[0];
    const title = clean(job.title);
    if (!title) return null;
    const location2 = addressText(job.jobLocation);
    const description = stripHtml(job.description);
    const remoteFlag = job.jobLocationType === "TELECOMMUTE" || !!job.applicantLocationRequirements || looksRemote(title, location2, description);
    return {
      title,
      company: orgName(job.hiringOrganization),
      location: location2,
      is_remote: remoteFlag,
      url: clean(job.url) || url,
      description
    };
  }

  // src/extract/indeed.js
  function extractIndeed(doc, url) {
    const title = textFrom(doc, [
      "h1.jobsearch-JobInfoHeader-title",
      "[data-testid='jobsearch-JobInfoHeader-title']",
      "h2[data-testid='jobsearch-JobInfoHeader-title']",
      "h1 span[title]"
    ]);
    const company = textFrom(doc, [
      "[data-testid='inlineHeader-companyName'] a",
      "[data-testid='inlineHeader-companyName']",
      "[data-company-name='true']",
      ".jobsearch-CompanyInfoContainer a"
    ]);
    const location2 = textFrom(doc, [
      "[data-testid='inlineHeader-companyLocation']",
      "[data-testid='job-location']",
      ".jobsearch-JobInfoHeader-subtitle div:last-child"
    ]);
    const body = doc.body?.textContent || "";
    return { title, company, location: location2, is_remote: looksRemote(location2, title, body), url };
  }

  // src/extract/linkedin.js
  function extractLinkedIn(doc, url) {
    const title = textFrom(doc, [
      "h1.top-card-layout__title",
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      "h1.topcard__title",
      "h1"
    ]);
    const company = textFrom(doc, [
      "a.topcard__org-name-link",
      ".topcard__org-name-link",
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name"
    ]);
    const location2 = textFrom(doc, [
      ".topcard__flavor--bullet",
      ".job-details-jobs-unified-top-card__bullet",
      ".jobs-unified-top-card__bullet",
      ".topcard__flavor-row .topcard__flavor:not(.topcard__flavor--metadata)"
    ]);
    const body = doc.body?.textContent || "";
    return { title, company, location: location2, is_remote: looksRemote(location2, title, body), url };
  }

  // src/extract/generic.js
  var CHROME = /^(jobs?|careers?|search|sign in|log ?in|home|welcome|indeed|linkedin|glassdoor)\b/i;
  function extractGeneric(doc, url) {
    let title = textFrom(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
    if (!title || CHROME.test(title)) {
      title = textFrom(doc, ["h1"]);
    }
    if (CHROME.test(title)) title = "";
    const body = doc.body?.textContent || "";
    return {
      title: clean(title),
      company: "",
      location: "",
      is_remote: looksRemote(title, body),
      url
    };
  }

  // src/extract/index.js
  function siteExtractor(url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      host = "";
    }
    if (host.includes("indeed.")) return { via: "indeed", fn: extractIndeed };
    if (host.includes("linkedin.")) return { via: "linkedin", fn: extractLinkedIn };
    return null;
  }
  function extractJob(doc, url) {
    const candidates = [];
    const jsonld = extractFromJsonLd(doc, url);
    if (jsonld) candidates.push({ via: "jsonld", data: jsonld });
    const site = siteExtractor(url);
    if (site) candidates.push({ via: site.via, data: site.fn(doc, url) });
    candidates.push({ via: "generic", data: extractGeneric(doc, url) });
    return mergeJob(candidates, url);
  }

  // src/content.entry.js
  var FAB_ID = "je-fab";
  var SUPPORTED = /(^|\.)(indeed|linkedin)\./i;
  if (SUPPORTED.test(location.hostname)) init();
  function init() {
    if (document.getElementById(FAB_ID)) return;
    injectStyles();
    const fab = document.createElement("button");
    fab.id = FAB_ID;
    fab.type = "button";
    setLabel(fab, "\uFF0B Save to Job Enhancer");
    fab.addEventListener("click", () => onSave(fab));
    document.body.appendChild(fab);
  }
  function setLabel(fab, text, state) {
    fab.textContent = text;
    fab.dataset.state = state || "idle";
  }
  async function onSave(fab) {
    if (fab.dataset.busy === "1") return;
    const job = extractJob(document, location.href);
    if (!job.title) {
      setLabel(fab, "Open a job first \u2197", "error");
      reset(fab, "\uFF0B Save to Job Enhancer");
      return;
    }
    fab.dataset.busy = "1";
    setLabel(fab, "Saving\u2026", "busy");
    const res = await chrome.runtime.sendMessage({ type: "saveJob", job }).catch(() => ({ ok: false, error: "error" }));
    fab.dataset.busy = "0";
    if (res?.ok) {
      setLabel(fab, "\u2713 Saved", "saved");
      reset(fab, "\uFF0B Save to Job Enhancer", 2500);
    } else if (res?.error === "NOT_SIGNED_IN") {
      setLabel(fab, "Open panel & sign in", "error");
      reset(fab, "\uFF0B Save to Job Enhancer", 3e3);
    } else {
      setLabel(fab, (res?.error || "Failed").slice(0, 24), "error");
      reset(fab, "\uFF0B Save to Job Enhancer", 3e3);
    }
  }
  function reset(fab, text, delay = 2e3) {
    setTimeout(() => setLabel(fab, text), delay);
  }
  function injectStyles() {
    if (document.getElementById("je-fab-style")) return;
    const style = document.createElement("style");
    style.id = "je-fab-style";
    style.textContent = `
    #${FAB_ID} {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      padding: 11px 16px; border: 0; border-radius: 999px; cursor: pointer;
      font: 600 14px/1 system-ui, -apple-system, sans-serif; color: #fff;
      background: #16a34a; box-shadow: 0 6px 20px rgba(0,0,0,.28);
      transition: background .15s, transform .1s;
    }
    #${FAB_ID}:hover { transform: translateY(-1px); }
    #${FAB_ID}[data-state="busy"]  { background: #6b7280; cursor: default; }
    #${FAB_ID}[data-state="saved"] { background: #15803d; }
    #${FAB_ID}[data-state="error"] { background: #dc2626; }
  `;
    document.documentElement.appendChild(style);
  }
})();
