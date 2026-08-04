(() => {
  // src/extract/util.js
  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function stripHtml(s) {
    return clean((s || "").replace(/<[^>]*>/g, " "));
  }
  function cleanMultiline(s) {
    return (s || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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
    const out = {
      title: "",
      company: "",
      location: "",
      is_remote: false,
      url,
      description: "",
      job_type: "",
      salary_min: null,
      salary_max: null,
      _via: ""
    };
    for (const field of ["title", "company", "location", "job_type", "url"]) {
      for (const c of candidates) {
        const v = clean(c.data?.[field]);
        if (v) {
          out[field] = v;
          if (field === "title" && !out._via) out._via = c.via;
          break;
        }
      }
    }
    for (const c of candidates) {
      const v = cleanMultiline(c.data?.description || "");
      if (v.length > out.description.length) out.description = v;
    }
    for (const field of ["salary_min", "salary_max"]) {
      for (const c of candidates) {
        const v = c.data?.[field];
        if (v != null) {
          out[field] = v;
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
    const { salary_min, salary_max } = salaryFrom(job);
    return {
      title,
      company: orgName(job.hiringOrganization),
      location: location2,
      is_remote: remoteFlag,
      url: clean(job.url) || url,
      description,
      job_type: employmentType(job),
      salary_min,
      salary_max
    };
  }

  // src/extract/indeed-embedded.js
  function indeedListingUrl(jobKey, url) {
    let jk = jobKey;
    if (!jk) {
      try {
        jk = new URL(url).searchParams.get("jk");
      } catch {
        jk = null;
      }
    }
    return jk ? `https://www.indeed.com/viewjob?jk=${jk}` : url;
  }
  function normalizeDetail(detail, url) {
    if (!detail?.jobTitle) return null;
    const description = stripHtml(detail.description || "");
    return {
      title: clean(detail.jobTitle),
      company: clean(detail.companyName),
      location: clean(detail.formattedLocation),
      description,
      is_remote: looksRemote(detail.formattedLocation, detail.jobTitle, description),
      url: indeedListingUrl(detail.jobKey, url)
    };
  }
  function normalizeCard(card, url) {
    const title = card?.title || card?.displayTitle;
    if (!title) return null;
    const loc = clean(card.formattedLocation);
    return {
      title: clean(title),
      company: clean(card.company),
      location: loc,
      description: stripHtml(card.snippet || ""),
      is_remote: card.remoteLocation === true || looksRemote(loc, title, card.snippet),
      url: indeedListingUrl(card.jobkey, url)
    };
  }
  function openCardKey(url) {
    try {
      return new URL(url).searchParams.get("vjk");
    } catch {
      return null;
    }
  }
  function fromBridge(doc, url) {
    const raw = doc.documentElement?.getAttribute?.("data-je-embedded");
    if (!raw) return null;
    let b;
    try {
      b = JSON.parse(raw);
    } catch {
      return null;
    }
    const vjk = openCardKey(url);
    if (vjk) {
      const card = Array.isArray(b.cards) ? b.cards.find((c) => c.jobkey === vjk) : null;
      if (card) return normalizeCard(card, url);
      if (b.detail?.jobKey && b.detail.jobKey === vjk) return normalizeDetail(b.detail, url);
      return null;
    }
    return normalizeDetail(b.detail, url);
  }
  function balanced(str, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        if (--depth === 0) return str.slice(start, i + 1);
      }
    }
    return null;
  }
  function scanScripts(doc, marker, pick) {
    for (const s of doc.querySelectorAll("script")) {
      const t = s.textContent || "";
      let idx = t.indexOf(marker);
      while (idx !== -1) {
        const start = t.indexOf("{", idx);
        if (start !== -1) {
          const json = balanced(t, start);
          if (json) {
            try {
              const got = pick(JSON.parse(json));
              if (got) return got;
            } catch {
            }
          }
        }
        idx = t.indexOf(marker, idx + marker.length);
      }
    }
    return null;
  }
  function fromStatic(doc, url) {
    const vjk = openCardKey(url);
    if (vjk) {
      const results = scanScripts(
        doc,
        'mosaic-provider-jobcards"]',
        (d) => d?.metaData?.mosaicProviderJobCardsModel?.results || null
      );
      const card = Array.isArray(results) ? results.find((c) => c.jobkey === vjk) : null;
      return card ? normalizeCard(card, url) : null;
    }
    const model = scanScripts(
      doc,
      "_initialData",
      (d) => d?.jobInfoWrapperModel?.jobInfoModel ? d.jobInfoWrapperModel.jobInfoModel : null
    );
    const h = model?.jobInfoHeaderModel;
    if (h?.jobTitle) {
      return normalizeDetail(
        {
          jobTitle: h.jobTitle,
          companyName: h.companyName,
          formattedLocation: h.formattedLocation,
          description: model?.sanitizedJobDescription?.content || ""
        },
        url
      );
    }
    return null;
  }
  function extractIndeedEmbedded(doc, url) {
    return fromBridge(doc, url) || fromStatic(doc, url);
  }

  // src/extract/indeed.js
  function descriptionText(doc) {
    for (const sel of [
      "#jobDescriptionText",
      "[id^='jobDescriptionText']",
      ".jobsearch-JobComponent-description",
      "[class*='jobDescriptionText']"
    ]) {
      const el = doc.querySelector(sel);
      const t = (el?.textContent || "").trim();
      if (t) return t;
    }
    return "";
  }
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
    const description = descriptionText(doc);
    const body = doc.body?.textContent || "";
    return {
      title,
      company,
      location: location2,
      description,
      is_remote: looksRemote(location2, title, body),
      url
    };
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
  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }
  function extractJob(doc, url) {
    const candidates = [];
    if (hostOf(url).includes("indeed.")) {
      const embedded = extractIndeedEmbedded(doc, url);
      if (embedded) candidates.push({ via: "indeed-embedded", data: embedded });
    }
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
  var LABEL = "\uFF0B Save to Job Enhancer";
  var btn = null;
  var currentKey = "";
  if (IS_INDEED || IS_LINKEDIN) {
    injectStyles();
    sync();
    let t;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(sync, 300);
    }).observe(document.body, { childList: true, subtree: true });
    setInterval(sync, 1e3);
  }
  function keyFor(job) {
    return `${job.title}|${job.company}`.toLowerCase();
  }
  function sync() {
    const job = extractJob(document, location.href);
    const titleEl = findTitleEl(document, TITLE_SELECTORS);
    ensureButton();
    placeButton(titleEl);
    btn._job = job;
    const key = job.title ? keyFor(job) : "";
    if (!key) {
      if (currentKey !== "" || !btn.dataset.state) {
        currentKey = "";
        setState(btn, "idle", LABEL);
      }
      return;
    }
    if (key === currentKey) return;
    currentKey = key;
    setState(btn, "idle", LABEL);
    chrome.runtime.sendMessage({ type: "checkSaved", job }).then((res) => {
      if (!btn || keyFor(btn._job) !== key) return;
      if (res?.saved && btn.dataset.state === "idle") setState(btn, "saved", "\u2713 Already saved");
    }).catch(() => {
    });
  }
  function ensureButton() {
    if (btn && document.contains(btn)) return;
    btn = document.getElementById(BTN_ID) || document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    if (!btn._wired) {
      btn.className = "je-btn";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSave();
      });
      btn._wired = true;
    }
  }
  function placeButton(titleEl) {
    if (titleEl) {
      const heading = headingFor(titleEl);
      if (btn.previousElementSibling !== heading || btn.classList.contains("je-fab")) {
        btn.classList.remove("je-fab");
        heading.insertAdjacentElement("afterend", btn);
      }
    } else if (!btn.classList.contains("je-fab") || !document.contains(btn)) {
      btn.classList.add("je-fab");
      document.body.appendChild(btn);
    }
  }
  async function onSave() {
    if (!btn || btn.dataset.state === "busy" || btn.dataset.state === "saved") return;
    const job = extractJob(document, location.href);
    btn._job = job;
    if (!job.title) {
      setState(btn, "error", "Can't read here \u2192 use panel Capture");
      setTimeout(() => btn && setState(btn, "idle", LABEL), 3500);
      return;
    }
    setState(btn, "busy", "Saving\u2026");
    const res = await Promise.race([
      chrome.runtime.sendMessage({ type: "saveJob", job }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "Timed out \u2014 try again" }), 12e3))
    ]).catch(() => ({ ok: false, error: "error" }));
    if (res?.ok) {
      setState(btn, "saved", "\u2713 Saved");
    } else if (res?.error === "Already in your tracker") {
      setState(btn, "saved", "\u2713 Already saved");
    } else if (res?.error === "NOT_SIGNED_IN") {
      setState(btn, "error", "Open panel & sign in");
      setTimeout(() => btn && setState(btn, "idle", LABEL), 3e3);
    } else {
      setState(btn, "error", (res?.error || "Failed").slice(0, 28));
      setTimeout(() => btn && setState(btn, "idle", LABEL), 3e3);
    }
  }
  function setState(el, state, text) {
    el.dataset.state = state;
    el.textContent = text;
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
      transition: background .15s, transform .1s; z-index: 2147483647;
    }
    .je-btn:hover { transform: translateY(-1px); }
    .je-btn[data-state="checking"] { background: #9ca3af; cursor: default; }
    .je-btn[data-state="busy"]     { background: #6b7280; cursor: default; }
    .je-btn[data-state="saved"]    { background: #2563eb; cursor: default; }  /* blue */
    .je-btn[data-state="error"]    { background: #dc2626; }
    .je-fab {
      position: fixed; right: 20px; bottom: 20px;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
    }
  `;
    document.documentElement.appendChild(style);
  }
})();
