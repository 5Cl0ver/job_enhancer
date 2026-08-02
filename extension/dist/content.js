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
    let host2 = "";
    try {
      host2 = new URL(url).hostname;
    } catch {
      host2 = "";
    }
    if (host2.includes("indeed.")) return { via: "indeed", fn: extractIndeed };
    if (host2.includes("linkedin.")) return { via: "linkedin", fn: extractLinkedIn };
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

  // src/inject.js
  var INDEED_TITLE_SELECTORS = [
    "h1.jobsearch-JobInfoHeader-title",
    "[data-testid='jobsearch-JobInfoHeader-title']",
    "h2[data-testid='jobsearch-JobInfoHeader-title']",
    "h1 span[title]"
  ];
  var LINKEDIN_TITLE_SELECTORS = [
    ".top-card-layout__title",
    ".job-details-jobs-unified-top-card__job-title",
    ".jobs-unified-top-card__job-title",
    "h1.topcard__title"
  ];
  function findTitleEl(doc, selectors) {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent.trim()) return el;
    }
    return null;
  }
  function headingFor(titleEl) {
    return titleEl.closest("h1, h2") || titleEl;
  }

  // src/content.entry.js
  var host = location.hostname;
  var IS_INDEED = /(^|\.)indeed\./i.test(host);
  var IS_LINKEDIN = /(^|\.)linkedin\./i.test(host);
  var TITLE_SELECTORS = IS_INDEED ? INDEED_TITLE_SELECTORS : LINKEDIN_TITLE_SELECTORS;
  var BTN_ID = "je-save-btn";
  var FAB_ID = "je-fab";
  var LABEL = "\uFF0B Save to Job Enhancer";
  var currentKey = "";
  if (IS_INDEED || IS_LINKEDIN) {
    injectStyles();
    sync();
    let t;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(sync, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }
  function findTitleEl2() {
    return findTitleEl(document, TITLE_SELECTORS);
  }
  function keyFor(job) {
    return `${job.title}|${job.company}`.toLowerCase();
  }
  function sync() {
    const titleEl = findTitleEl2();
    if (!titleEl) {
      removeInlineButton();
      ensureFab();
      return;
    }
    removeFab();
    const job = extractJob(document, location.href);
    if (!job.title) return;
    const key = keyFor(job);
    let btn = document.getElementById(BTN_ID);
    const heading = headingFor(titleEl);
    if (!btn) {
      btn = makeButton();
      heading.insertAdjacentElement("afterend", btn);
    } else if (!heading.parentElement?.contains(btn)) {
      heading.insertAdjacentElement("afterend", btn);
    }
    if (key !== currentKey || !btn.dataset.state) {
      currentKey = key;
      btn._job = job;
      setState(btn, "checking", "Checking\u2026");
      chrome.runtime.sendMessage({ type: "checkSaved", job }).then((res) => {
        if (keyFor(job) !== currentKey) return;
        if (res?.saved) setState(btn, "saved", "\u2713 Already saved");
        else setState(btn, "idle", LABEL);
      }).catch(() => setState(btn, "idle", LABEL));
    } else {
      btn._job = job;
    }
  }
  function makeButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "je-btn";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSave(btn);
    });
    return btn;
  }
  async function onSave(btn) {
    if (btn.dataset.state === "saved" || btn.dataset.state === "busy") return;
    const job = extractJob(document, location.href);
    btn._job = job;
    if (!job.title) {
      setState(btn, "error", "Can't read here \u2192 use panel Capture");
      setTimeout(() => setState(btn, "idle", LABEL), 3500);
      return;
    }
    setState(btn, "busy", "Saving\u2026");
    const res = await chrome.runtime.sendMessage({ type: "saveJob", job }).catch(() => ({ ok: false, error: "error" }));
    if (res?.ok) {
      setState(btn, "saved", "\u2713 Saved");
    } else if (res?.error === "Already in your tracker") {
      setState(btn, "saved", "\u2713 Already saved");
    } else if (res?.error === "NOT_SIGNED_IN") {
      setState(btn, "error", "Open panel & sign in");
      setTimeout(() => setState(btn, "idle", LABEL), 3e3);
    } else {
      setState(btn, "error", (res?.error || "Failed").slice(0, 28));
      setTimeout(() => setState(btn, "idle", LABEL), 3e3);
    }
  }
  function setState(btn, state, text) {
    btn.dataset.state = state;
    btn.textContent = text;
  }
  function ensureFab() {
    if (document.getElementById(FAB_ID)) return;
    const fab = document.createElement("button");
    fab.id = FAB_ID;
    fab.type = "button";
    fab.className = "je-btn je-fab";
    setState(fab, "idle", LABEL);
    fab.addEventListener("click", () => onSave(fab));
    fab._job = extractJob(document, location.href);
    document.body.appendChild(fab);
  }
  function removeFab() {
    document.getElementById(FAB_ID)?.remove();
  }
  function removeInlineButton() {
    document.getElementById(BTN_ID)?.remove();
    currentKey = "";
  }
  function injectStyles() {
    if (document.getElementById("je-style")) return;
    const style = document.createElement("style");
    style.id = "je-style";
    style.textContent = `
    .je-btn {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 10px 0; padding: 9px 15px; border: 0; border-radius: 999px;
      font: 600 14px/1 system-ui, -apple-system, sans-serif; color: #fff;
      background: #16a34a; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.18);
      transition: background .15s, transform .1s;
    }
    .je-btn:hover { transform: translateY(-1px); }
    .je-btn[data-state="checking"] { background: #9ca3af; cursor: default; }
    .je-btn[data-state="busy"]     { background: #6b7280; cursor: default; }
    .je-btn[data-state="saved"]    { background: #2563eb; cursor: default; }  /* blue */
    .je-btn[data-state="error"]    { background: #dc2626; }
    .je-fab {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
    }
  `;
    document.documentElement.appendChild(style);
  }
})();
