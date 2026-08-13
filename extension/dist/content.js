(() => {
  // src/extract/util.js
  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function stripHtml(s) {
    const text = (s || "").replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
    return cleanMultiline(text);
  }
  function parseSalaryText(text) {
    const t = clean(text);
    if (!t) return null;
    let period = null;
    if (/\b(a|an|per)\s+year\b|\byearly\b|\bannual/i.test(t)) period = "yearly";
    else if (/\b(a|an|per)\s+hour\b|\bhourly\b|\/\s*hr\b/i.test(t)) period = "hourly";
    if (!period) return null;
    const nums = [...t.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map((m) => Math.round(parseFloat(m[1].replace(/,/g, "")))).filter((n) => Number.isFinite(n) && n >= (period === "yearly" ? 1e3 : 2));
    if (!nums.length) return null;
    return { salary_min: nums[0], salary_max: nums[1] ?? null, salary_period: period };
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
  function posSalary(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const n = Math.round(v);
    return n > 0 ? n : null;
  }
  function looksRemote(...parts) {
    return /\b(remote|work from home|wfh|telecommute|anywhere)\b/i.test(parts.filter(Boolean).join(" "));
  }
  function textAfterHeading(doc, patterns, minLen) {
    if (!doc?.querySelectorAll) return "";
    for (const h of doc.querySelectorAll("h1,h2,h3,h4,strong,b")) {
      const label = clean(h.textContent);
      if (!label || label.length > 60) continue;
      if (!patterns.some((re) => re.test(label))) continue;
      let node = h;
      for (let depth = 0; depth < 3 && node; depth++) {
        let text = "";
        for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
          text += "\n" + stripHtml(sib.innerHTML || "");
        }
        const v = cleanMultiline(text);
        if (v.length >= minLen) return v;
        node = node.parentElement;
      }
    }
    return "";
  }
  var DESCRIPTION_HEADINGS = [
    /^full job description/i,
    /^job description/i,
    /^about the job/i,
    /^about the role/i
  ];
  function descriptionByHeading(doc) {
    return textAfterHeading(doc, DESCRIPTION_HEADINGS, 200);
  }
  var JOB_TYPE_WORDS = [
    "Full-time",
    "Part-time",
    "Contract",
    "Permanent",
    "Temporary",
    "Internship",
    "Apprenticeship",
    "Seasonal",
    "Freelance"
  ];
  function parseJobTypes(text) {
    const t = clean(text);
    if (!t) return "";
    const found = JOB_TYPE_WORDS.filter(
      (w) => new RegExp(`\\b${w.replace("-", "[-\\s]?")}\\b`, "i").test(t)
    );
    return found.join(", ").slice(0, 50);
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
      salary_period: null,
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
        const v = posSalary(c.data?.[field]);
        if (v != null) {
          out[field] = v;
          break;
        }
      }
    }
    for (const c of candidates) {
      if (c.data?.salary_period) {
        out.salary_period = c.data.salary_period;
        break;
      }
    }
    out.is_remote = candidates.some((c) => c.data?.is_remote === true);
    if (!out.url) out.url = url;
    return out;
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
    return Number.isFinite(v) ? Math.round(v) : null;
  }
  function periodFrom(unitText) {
    const u = (unitText || "").toLowerCase();
    if (u.startsWith("year")) return "yearly";
    if (u.startsWith("hour")) return "hourly";
    return null;
  }
  function salaryFrom(job) {
    const b = job.baseSalary;
    const v = b?.value;
    if (v && typeof v === "object") {
      return {
        salary_min: numOrNull(v.minValue ?? v.value),
        salary_max: numOrNull(v.maxValue ?? v.value),
        salary_period: periodFrom(v.unitText || b?.unitText)
      };
    }
    return { salary_min: numOrNull(v), salary_max: null, salary_period: null };
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
    const location2 = addressText(job.jobLocation);
    const description = stripHtml(job.description);
    const remoteFlag = job.jobLocationType === "TELECOMMUTE" || !!job.applicantLocationRequirements || looksRemote(title, location2);
    const { salary_min, salary_max, salary_period } = salaryFrom(job);
    return {
      title,
      company: orgName(job.hiringOrganization),
      location: location2,
      is_remote: remoteFlag,
      url: clean(job.url) || url,
      description,
      job_type: employmentType(job),
      salary_min,
      salary_max,
      salary_period
    };
  }

  // src/extract/jsonld.js
  function extractFromJsonLd(doc, url) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    const postings = [];
    for (const s of scripts) {
      try {
        collectJobPostings(JSON.parse(s.textContent), postings);
      } catch {
        continue;
      }
    }
    if (!postings.length) return null;
    return mapJobPosting(postings[0], url);
  }

  // src/extract/indeed-embedded.js
  function canonicalIndeedUrl(pageUrl) {
    try {
      const u = new URL(pageUrl);
      if (!/(^|\.)indeed\./i.test(u.hostname)) return null;
      if (u.pathname.includes("/viewjob")) return pageUrl;
      const jk = u.searchParams.get("vjk") || u.searchParams.get("jk");
      return jk ? `https://www.indeed.com/viewjob?jk=${jk}` : null;
    } catch {
      return null;
    }
  }
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
      // Structured signals only (location/title) — a description casually saying
      // "remote" must not flag an on-site job as Remote.
      is_remote: looksRemote(detail.formattedLocation, detail.jobTitle),
      url: indeedListingUrl(detail.jobKey, url)
    };
  }
  function cardSalary(card) {
    const es = card?.extractedSalary;
    if (es && (posSalary(es.min) || posSalary(es.max))) {
      const type = (es.type || "yearly").toLowerCase();
      if (type.startsWith("year") || type.startsWith("hour")) {
        return {
          // posSalary drops Indeed's -1 "no max" sentinel.
          salary_min: posSalary(es.min),
          salary_max: posSalary(es.max),
          salary_period: type.startsWith("hour") ? "hourly" : "yearly"
        };
      }
    }
    return parseSalaryText(card?.salarySnippet) || {
      salary_min: null,
      salary_max: null,
      salary_period: null
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
      // Indeed's own remoteLocation flag, or "Remote in …" in the location/title.
      // NOT the snippet — marketing copy mentioning "remote" isn't a remote job.
      is_remote: card.remoteLocation === true || looksRemote(loc, title),
      url: indeedListingUrl(card.jobkey, url),
      // "Part-time, Contract, Full-time" — straight from the card's own data.
      job_type: Array.isArray(card.jobTypes) ? clean(card.jobTypes.join(", ")).slice(0, 50) : "",
      ...cardSalary(card)
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
      "[class*='jobDescriptionText']",
      "[data-testid*='jobDescription']"
    ]) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const t = stripHtml(el.innerHTML || "") || (el.textContent || "").trim();
      if (t) return t;
    }
    return descriptionByHeading(doc);
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
    const detailsText = doc.querySelector("#salaryInfoAndJobType")?.textContent || "" || textAfterHeading(doc, [/^job details/i], 5);
    const salary = parseSalaryText(detailsText) || {};
    const job_type = parseJobTypes(detailsText);
    return {
      title,
      company,
      location: location2,
      description,
      // Only STRUCTURED remote signals: the location line ("Remote in Pomona,
      // CA") or the title. Never scan the whole page — on a feed, some OTHER
      // card always says "remote" and every job got falsely flagged.
      is_remote: looksRemote(location2, title),
      url,
      job_type,
      salary_min: salary.salary_min ?? null,
      salary_max: salary.salary_max ?? null,
      salary_period: salary.salary_period ?? null
    };
  }
  function extractIndeedApply(doc, url) {
    if (!doc?.querySelector) return null;
    const card = doc.querySelector("[data-testid='JobInfoCard-wrapper']") || doc.querySelector(".ia-JobDescription")?.closest("aside") || null;
    if (!card) return null;
    const title = textFrom(card, ["#ia-JobInfoCard-header-title", ".ia-JobHeader-title"]);
    let company = "";
    let location2 = "";
    const sub = clean(card.querySelector(".ia-JobHeader-information span")?.textContent || "");
    const m = /^(.+?)\s+[-–·•]\s+(.+)$/.exec(sub);
    if (m) {
      company = clean(m[1]);
      location2 = clean(m[2]);
    } else if (sub) {
      company = sub;
    }
    const descEl = card.querySelector(".ia-JobDescription");
    const description = descEl ? stripHtml(descEl.innerHTML || "") || clean(descEl.textContent) : "";
    const head = description.slice(0, 300);
    let salary = parseSalaryText(head) || {};
    if (salary.salary_min == null) {
      const s = /salary\b[^$]*\$\s*([\d,]+(?:\.\d+)?)(?:\s*[-–]\s*\$\s*([\d,]+(?:\.\d+)?))?/i.exec(head);
      if (s) {
        const lo = Math.round(parseFloat(s[1].replace(/,/g, "")));
        const hi = s[2] ? Math.round(parseFloat(s[2].replace(/,/g, ""))) : null;
        if (Number.isFinite(lo) && lo >= 1e3) {
          salary = { salary_min: lo, salary_max: hi, salary_period: "yearly" };
        }
      }
    }
    const job_type = parseJobTypes(head);
    if (!title && !description) return null;
    return {
      title,
      company,
      location: location2,
      description,
      is_remote: looksRemote(location2, title, head),
      url,
      job_type,
      salary_min: salary.salary_min ?? null,
      salary_max: salary.salary_max ?? null,
      salary_period: salary.salary_period ?? null
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
    return {
      title: clean(title),
      company: "",
      location: "",
      // Title only — a full-page scan flags on-site jobs as Remote whenever ANY
      // other text on the page mentions remote (feed cards, footers, ads). This
      // guess is OR-ed with every other extractor's in mergeJob, so it must be
      // conservative.
      is_remote: looksRemote(title),
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
      const apply = extractIndeedApply(doc, url);
      if (apply) candidates.push({ via: "indeed-apply", data: apply });
    }
    const jsonld = extractFromJsonLd(doc, url);
    if (jsonld) candidates.push({ via: "jsonld", data: jsonld });
    const site = siteExtractor(url);
    if (site) candidates.push({ via: site.via, data: site.fn(doc, url) });
    candidates.push({ via: "generic", data: extractGeneric(doc, url) });
    const result = mergeJob(candidates, url);
    if (hostOf(url).includes("indeed.")) {
      result.url = canonicalIndeedUrl(result.url) || canonicalIndeedUrl(url) || result.url;
    }
    return result;
  }

  // src/backfill.js
  var MIN_DESCRIPTION = 200;
  function shouldBackfill(job, check) {
    return !!(check?.saved && check?.needs_details && job?.title && (job.description || "").length >= MIN_DESCRIPTION);
  }

  // src/indeed-apply.js
  function isIndeedApplyUrl(url) {
    try {
      const u = new URL(url);
      if (/(^|\.)smartapply\.indeed\.com$/i.test(u.hostname)) return true;
      return /(^|\.)indeed\./i.test(u.hostname) && /apply/i.test(u.pathname);
    } catch {
      return false;
    }
  }
  var SUBMITTED_RE = /your application (?:was|has been) submitted(?:\s+to\s+([^\n.!]+))?/i;
  function submittedCompany(doc) {
    const body = doc?.body?.textContent || "";
    const m = SUBMITTED_RE.exec(body);
    if (!m) return null;
    if (!m[1]) return "";
    const co = m[1].split(/You will|You'll|Thank you|Return to|We['’]ll/i)[0];
    return clean(co).slice(0, 60);
  }
  function isSubmitted(doc) {
    return submittedCompany(doc) !== null;
  }
  var CO_LOC_RE = /^(.{2,80}?)\s+[-–·•]\s+(?:remote|[A-Za-z0-9 .'&,]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i;
  function nearestTitle(el) {
    let node = el;
    for (let hops = 0; hops < 6 && node; hops++) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        const t = clean(sib.textContent);
        if (t && t.length <= 120 && !CO_LOC_RE.test(t)) return t;
      }
      node = node.parentElement;
    }
    return "";
  }
  function scrapeApplyHeader(doc) {
    if (!doc?.querySelectorAll) return null;
    let scanned = 0;
    for (const el of doc.querySelectorAll("h1,h2,h3,h4,p,span,div,a")) {
      if (++scanned > 3e3) break;
      if (el.querySelector?.("*")) continue;
      const t = clean(el.textContent);
      if (t.length > 90) continue;
      const m = CO_LOC_RE.exec(t);
      if (!m) continue;
      const company = clean(m[1]);
      const title = nearestTitle(el);
      if (company) return { title, company };
    }
    return null;
  }

  // src/extract/indeed-myjobs.js
  var STATUS_TO_STAGE = [
    [/not selected|rejected|no longer|not moving forward/i, "Rejected"],
    [/interview/i, "Interview"],
    [/offer/i, "Offer"],
    [/hired/i, "Offer"],
    // "Applied", "Application viewed", "Application submitted", "Job closed or
    // expired" — the user applied; keep them in Applied.
    [/applied|application|submitted|viewed|closed|expired/i, "Applied"]
  ];
  function statusToStage(status) {
    const s = clean(status);
    for (const [re, stage] of STATUS_TO_STAGE) if (re.test(s)) return stage;
    return "Applied";
  }
  function titleText(anchor) {
    const direct = [...anchor.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
    const t = clean(direct);
    if (t) return t;
    return clean(anchor.textContent).replace(/job description opens in a new window/i, "").trim();
  }
  function readApplications(doc) {
    if (!doc?.querySelectorAll) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const card of doc.querySelectorAll(".atw-AppCard")) {
      const anchor = card.querySelector(".atw-JobInfo-jobTitle");
      if (!anchor) continue;
      const title = titleText(anchor);
      if (!title) continue;
      const spans = card.querySelectorAll(".atw-JobInfo-companyLocation span");
      const company = clean(spans[0]?.textContent || "");
      const location2 = clean(spans[1]?.textContent || "");
      const status = clean(
        card.querySelector(".atw-StatusTag-description")?.textContent || card.querySelector(".atw-StatusTag span")?.textContent || ""
      );
      let url = anchor.getAttribute("href") || "";
      try {
        if (url) url = new URL(url, "https://www.indeed.com").href;
      } catch {
      }
      const jobKey = card.getAttribute("data-jobkey") || card.getAttribute("data-id") || "";
      const key = jobKey || `${title}|${company}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, company, location: location2, status, stage: statusToStage(status), url, jobKey });
    }
    return out;
  }

  // src/content.entry.js
  var host = location.hostname;
  var IS_INDEED = /(^|\.)indeed\./i.test(host);
  var IS_LINKEDIN = /(^|\.)linkedin\./i.test(host);
  var BTN_ID = "je-save-btn";
  var LABEL = "\uFF0B Save to Job Enhancer";
  var STALE_LABEL = "\u21BB Refresh page \u2014 extension updated";
  var btn = null;
  var currentKey = "";
  var backfilled = /* @__PURE__ */ new Set();
  function orphaned() {
    try {
      return !chrome.runtime?.id;
    } catch {
      return true;
    }
  }
  function safeSend(msg) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(msg));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  var ON_INDEED_APPLY = IS_INDEED && isIndeedApplyUrl(location.href);
  var ON_INDEED_MYJOBS = IS_INDEED && (host === "myjobs.indeed.com" || /\/myjobs(\b|\/|$)/.test(location.pathname));
  if (ON_INDEED_APPLY) {
    let lastJob = null;
    let fired = false;
    let badge = null;
    let lastBadge = "";
    let saveBtn = null;
    let saved = false;
    let checkedKey = "";
    const setBadge = (text, done) => {
      if (text === lastBadge) return;
      lastBadge = text;
      injectStyles();
      if (!badge || !document.contains(badge)) {
        badge = document.createElement("div");
        badge.id = "je-apply-badge";
        badge.className = "je-btn je-fab je-fab-left";
        document.body.appendChild(badge);
      }
      badge.textContent = text;
      badge.dataset.state = done ? "saved" : "checking";
    };
    const setSaveState = (state, text) => {
      if (!saveBtn) return;
      saveBtn.dataset.state = state;
      saveBtn.textContent = text;
    };
    async function saveApplyJob() {
      if (saved) return;
      if (orphaned()) return;
      const job = extractJob(document, location.href);
      if (!job.title && lastJob?.title) job.title = lastJob.title;
      if (!job.company && lastJob?.company) job.company = lastJob.company;
      job.url = location.href;
      if (!job.title || !job.company) return;
      setSaveState("busy", "Saving\u2026");
      const res = await safeSend({ type: "saveJob", job }).catch(() => ({ ok: false }));
      if (res?.ok || res?.error === "Already in your tracker") {
        saved = true;
        setSaveState("saved", "\u2713 Saved");
      } else if (res?.error === "NOT_SIGNED_IN") {
        setSaveState("error", "Open panel & sign in");
        setTimeout(() => setSaveState("idle", "\uFF0B Save this job"), 3e3);
      } else {
        setSaveState("error", (res?.error || "Failed").slice(0, 22));
        setTimeout(() => setSaveState("idle", "\uFF0B Save this job"), 3e3);
      }
    }
    const ensureSaveBtn = () => {
      if (saveBtn && document.contains(saveBtn)) return;
      injectStyles();
      saveBtn = document.createElement("button");
      saveBtn.id = "je-apply-save";
      saveBtn.type = "button";
      saveBtn.className = "je-btn je-fab je-fab-left";
      saveBtn.style.bottom = "66px";
      saveBtn.addEventListener("click", saveApplyJob);
      document.body.appendChild(saveBtn);
      setSaveState("idle", "\uFF0B Save this job");
    };
    const timer = setInterval(() => {
      if (orphaned()) {
        clearInterval(timer);
        return;
      }
      const header = scrapeApplyHeader(document);
      if (header?.company) lastJob = header;
      if (lastJob?.company && lastJob?.title) {
        ensureSaveBtn();
        const key = `${lastJob.title}|${lastJob.company}`.toLowerCase();
        if (!saved && key !== checkedKey) {
          checkedKey = key;
          safeSend({
            type: "checkSaved",
            job: { title: lastJob.title, company: lastJob.company, location: "" }
          }).then((r) => {
            if (r?.saved) {
              saved = true;
              setSaveState("saved", "\u2713 Already saved");
            }
          }).catch(() => {
          });
        }
      }
      if (!fired && isSubmitted(document)) {
        fired = true;
        const company = lastJob?.company || submittedCompany(document) || "";
        const title = lastJob?.title || "";
        if (company || title) {
          safeSend({ type: "markApplied", job: { title, company } }).catch(() => {
          });
        }
        setBadge("\u2713 Applied \u2014 tracked", true);
        return;
      }
      if (!fired) {
        const name = lastJob?.title || lastJob?.company;
        setBadge(name ? `\u{1F4DD} Applying to ${name}`.slice(0, 46) : "\u{1F4DD} Applying\u2026", false);
      }
    }, 1500);
  }
  if (ON_INDEED_MYJOBS) {
    try {
      const v = chrome.runtime?.getManifest?.().version;
      console.log(
        `[Job Enhancer] My Jobs sync ready \u2014 v${v} \u2014 ${readApplications(document).length} applications detected`
      );
    } catch {
    }
    injectStyles();
    ensureSyncButton();
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        if (t && t.closest && t.closest("#" + SYNC_BTN_ID)) handleSyncClick();
      },
      true
    );
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type !== "readApplications") return;
        try {
          sendResponse({ ok: true, applications: readApplications(document) });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
        return true;
      });
    } catch {
    }
    let _st;
    new MutationObserver(() => {
      clearTimeout(_st);
      _st = setTimeout(ensureSyncButton, 500);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (IS_INDEED && !ON_INDEED_APPLY && !ON_INDEED_MYJOBS || IS_LINKEDIN) {
    injectStyles();
    sync();
    let t;
    const observer = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(sync, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const poll = setInterval(() => {
      if (orphaned()) {
        clearInterval(poll);
        observer.disconnect();
        if (btn) setState(btn, "stale", STALE_LABEL);
        return;
      }
      sync();
    }, 2e3);
  }
  function keyFor(job) {
    return `${job.title}|${job.company}`.toLowerCase();
  }
  function sync() {
    const job = extractJob(document, location.href);
    ensureButton();
    placeButton();
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
    safeSend({ type: "checkSaved", job }).then((res) => {
      if (!btn || keyFor(btn._job) !== key) return;
      if (res?.saved && btn.dataset.state === "idle") setState(btn, "saved", "\u2713 Already saved");
      if (shouldBackfill(job, res) && !backfilled.has(key)) {
        backfilled.add(key);
        safeSend({ type: "backfillJob", job }).then((r) => {
          if (r?.updated && btn && keyFor(btn._job) === key) {
            setState(btn, "saved", "\u2713 Details updated");
          }
        }).catch(() => {
        });
      }
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
        if (btn.dataset.state === "stale") {
          location.reload();
          return;
        }
        onSave();
      });
      btn._wired = true;
    }
  }
  function placeButton() {
    if (!btn.classList.contains("je-fab")) btn.classList.add("je-fab");
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
  }
  async function onSave() {
    if (!btn || btn.dataset.state === "busy" || btn.dataset.state === "saved") return;
    if (orphaned()) {
      setState(btn, "stale", STALE_LABEL);
      return;
    }
    const job = extractJob(document, location.href);
    btn._job = job;
    if (!job.title) {
      setState(btn, "error", "Can't read here \u2192 use panel Capture");
      setTimeout(() => btn && setState(btn, "idle", LABEL), 3500);
      return;
    }
    setState(btn, "busy", "Saving\u2026");
    const res = await Promise.race([
      safeSend({ type: "saveJob", job }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "Timed out \u2014 try again" }), 12e3))
    ]).catch((e) => ({
      ok: false,
      error: /context invalidated/i.test(String(e?.message)) ? "STALE" : "error"
    }));
    if (res?.ok) {
      setState(btn, "saved", "\u2713 Saved");
    } else if (res?.error === "Already in your tracker") {
      setState(btn, "saved", "\u2713 Already saved");
    } else if (res?.error === "STALE") {
      setState(btn, "stale", STALE_LABEL);
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
  var SYNC_BTN_ID = "je-sync-btn";
  var SYNC_PANEL_ID = "je-sync-panel";
  var STAGE_OPTIONS = [
    "Interested",
    "Referral Sent",
    "Applied",
    "Phone Screen",
    "Take-Home Assignment",
    "Interview",
    "Offer",
    "Rejected"
  ];
  var _handlingSyncClick = false;
  function handleSyncClick() {
    if (_handlingSyncClick) return;
    _handlingSyncClick = true;
    setTimeout(() => _handlingSyncClick = false, 300);
    const sb = document.getElementById(SYNC_BTN_ID);
    try {
      openSyncReview();
      if (!document.getElementById(SYNC_PANEL_ID) && sb) {
        const n = readApplications(document).length;
        sb.dataset.state = "busy";
        sb.textContent = `\u26A0 read ${n}, but panel didn't open`;
        setTimeout(() => sb && (sb.dataset.state = "", ensureSyncButton()), 4e3);
      }
    } catch (e) {
      console.error("[Job Enhancer] sync failed:", e);
      if (sb) {
        sb.dataset.state = "busy";
        sb.textContent = "\u26A0 " + String(e && e.message || e).slice(0, 42);
        setTimeout(() => sb && (sb.dataset.state = "", ensureSyncButton()), 6e3);
      }
    }
  }
  function ensureSyncButton() {
    let sb = document.getElementById(SYNC_BTN_ID);
    const apps = readApplications(document);
    if (!apps.length) {
      sb?.remove();
      return;
    }
    if (!sb) {
      sb = document.createElement("button");
      sb.id = SYNC_BTN_ID;
      sb.type = "button";
      sb.className = "je-btn je-fab je-sync-fab";
      sb.addEventListener("click", handleSyncClick);
      document.body.appendChild(sb);
    }
    if (sb.dataset.state !== "busy") {
      let v = "?";
      try {
        v = chrome.runtime.getManifest().version;
      } catch {
      }
      sb.textContent = `\u{1F504} Sync ${apps.length} Indeed applications \xB7 v${v}`;
    }
  }
  function openSyncReview() {
    document.getElementById(SYNC_PANEL_ID)?.remove();
    injectStyles();
    const apps = readApplications(document);
    if (!apps.length) return;
    const panel = document.createElement("div");
    panel.id = SYNC_PANEL_ID;
    const head = document.createElement("div");
    head.className = "je-sp-head";
    const headTitle = document.createElement("b");
    headTitle.textContent = "Sync your Indeed applications";
    head.appendChild(headTitle);
    const close = document.createElement("button");
    close.className = "je-sp-close";
    close.type = "button";
    close.textContent = "\u2715";
    close.addEventListener("click", () => panel.remove());
    head.appendChild(close);
    panel.appendChild(head);
    const sub = document.createElement("div");
    sub.className = "je-sp-sub";
    sub.textContent = `${apps.length} found \u2014 matches update their status, the rest import. Uncheck any to skip.`;
    panel.appendChild(sub);
    const body = document.createElement("div");
    body.className = "je-sp-body";
    const rows = apps.map((app) => {
      const row = document.createElement("div");
      row.className = "je-sp-row";
      const top = document.createElement("label");
      top.className = "je-sp-top";
      const keep = document.createElement("input");
      keep.type = "checkbox";
      keep.checked = true;
      const meta = document.createElement("div");
      meta.className = "je-sp-meta";
      const t = document.createElement("div");
      t.className = "je-sp-title";
      t.textContent = app.title;
      const c = document.createElement("div");
      c.className = "je-sp-co";
      c.textContent = [app.company, app.location].filter(Boolean).join(" \xB7 ");
      meta.append(t, c);
      top.append(keep, meta);
      const stageWrap = document.createElement("div");
      stageWrap.className = "je-sp-stage";
      const badge = document.createElement("span");
      badge.className = "je-sp-badge";
      badge.textContent = app.status || "Applied";
      const arrow = document.createElement("span");
      arrow.className = "je-sp-arrow";
      arrow.textContent = "\u2192";
      const sel = document.createElement("select");
      sel.className = "je-sp-sel";
      for (const s of STAGE_OPTIONS) {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = s;
        if (s === app.stage) o.selected = true;
        sel.appendChild(o);
      }
      stageWrap.append(badge, arrow, sel);
      row.append(top, stageWrap);
      row._data = { app, keep, sel };
      body.appendChild(row);
      return row;
    });
    panel.appendChild(body);
    const foot = document.createElement("div");
    foot.className = "je-sp-foot";
    const status = document.createElement("div");
    status.className = "je-sp-status";
    status.style.display = "none";
    const setStatus = (text, kind) => {
      status.textContent = text || "";
      status.dataset.kind = kind || "info";
      status.style.display = text ? "block" : "none";
    };
    const btnRow = document.createElement("div");
    btnRow.className = "je-sp-btnrow";
    const cancel = document.createElement("button");
    cancel.className = "je-sp-cancel";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => panel.remove());
    const sync2 = document.createElement("button");
    sync2.className = "je-sp-sync";
    sync2.type = "button";
    const chosenCount = () => rows.filter((r) => r._data.keep.checked).length;
    const relabel = () => sync2.textContent = `\u{1F504} Sync ${chosenCount()}`;
    relabel();
    body.addEventListener("change", relabel);
    sync2.addEventListener("click", async () => {
      if (orphaned()) {
        setStatus("Extension was updated \u2014 refresh this page, then Sync.", "error");
        return;
      }
      const chosen = rows.filter((r) => r._data.keep.checked).map((r) => ({
        title: r._data.app.title,
        company: r._data.app.company,
        location: r._data.app.location || "Not specified",
        url: r._data.app.url || void 0,
        stage: r._data.sel.value
      }));
      if (!chosen.length) {
        setStatus("Nothing selected \u2014 check at least one application.", "error");
        return;
      }
      sync2.disabled = true;
      sync2.textContent = "Syncing\u2026";
      setStatus(`Syncing ${chosen.length}\u2026`, "info");
      console.log("[Job Enhancer] sync \u2192", chosen.length, "applications", chosen);
      const res = await Promise.race([
        safeSend({ type: "syncApplications", applications: chosen }),
        new Promise((r) => setTimeout(() => r({ ok: false, error: "Timed out \u2014 is the app running?" }), 3e4))
      ]).catch((e) => ({
        ok: false,
        error: /context invalidated/i.test(String(e?.message)) ? "STALE" : String(e?.message || e)
      }));
      console.log("[Job Enhancer] sync \u2190", res);
      if (res?.ok) {
        showSyncResult(panel, res);
        return;
      }
      sync2.disabled = false;
      relabel();
      if (res?.error === "STALE") {
        setStatus("Extension was updated \u2014 refresh this page, then Sync.", "error");
      } else if (res?.error === "NOT_SIGNED_IN") {
        setStatus("Not signed in \u2014 open the Job Enhancer side panel, sign in, then Sync again.", "error");
      } else {
        setStatus(`Couldn't sync: ${res?.error || "unknown error"}. Is the app running at localhost:8000?`, "error");
      }
    });
    btnRow.append(cancel, sync2);
    foot.append(status, btnRow);
    panel.appendChild(foot);
    document.body.appendChild(panel);
  }
  function showSyncResult(panel, res) {
    panel.querySelector(".je-sp-body")?.remove();
    panel.querySelector(".je-sp-sub")?.remove();
    const foot = panel.querySelector(".je-sp-foot");
    const done = document.createElement("div");
    done.className = "je-sp-done";
    const big = document.createElement("div");
    big.className = "je-sp-done-big";
    big.textContent = "\u2713 Synced";
    const line = document.createElement("div");
    const skipped = res.skipped ? ` \xB7 ${res.skipped} skipped` : "";
    line.textContent = `${res.updated || 0} updated \xB7 ${res.imported || 0} imported${skipped}`;
    done.append(big, line);
    panel.insertBefore(done, foot);
    const outcomes = Array.isArray(res.outcomes) ? res.outcomes : [];
    const results = document.createElement("div");
    results.className = "je-sp-results";
    const group = (title, action, cls) => {
      const items = outcomes.filter((o) => o.action === action);
      if (!items.length) return;
      const sec = document.createElement("div");
      sec.className = "je-sp-rgroup";
      const h = document.createElement("div");
      h.className = `je-sp-rhead ${cls}`;
      h.textContent = `${title} (${items.length})`;
      sec.appendChild(h);
      for (const o of items) {
        const row = document.createElement("div");
        row.className = "je-sp-rrow";
        const name = document.createElement("span");
        name.className = "je-sp-rname";
        name.textContent = [o.title, o.company].filter(Boolean).join(" \u2014 ");
        const st = document.createElement("span");
        st.className = "je-sp-rstage";
        st.textContent = action === "skipped" ? "skipped" : `\u2192 ${o.stage}`;
        row.append(name, st);
        sec.appendChild(row);
      }
      results.appendChild(sec);
    };
    group("Updated (already tracked)", "updated", "updated");
    group("Imported (new to your tracker)", "imported", "imported");
    group("Skipped", "skipped", "skipped");
    if (results.childElementCount) panel.insertBefore(results, foot);
    const note = document.createElement("div");
    note.className = "je-sp-done-note";
    note.textContent = "Open Job Enhancer to see your board.";
    panel.insertBefore(note, foot);
    if (foot) {
      foot.querySelector(".je-sp-status")?.remove();
      foot.querySelector(".je-sp-cancel")?.remove();
      const sync2 = foot.querySelector(".je-sp-sync");
      if (sync2) {
        sync2.disabled = false;
        sync2.textContent = "Done";
        sync2.onclick = () => panel.remove();
      }
    }
    const sb = document.getElementById(SYNC_BTN_ID);
    if (sb) sb.textContent = "\u2713 Synced to Job Enhancer";
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
    .je-btn[data-state="stale"]    { background: #d97706; }  /* amber: refresh me */
    .je-fab {
      position: fixed; right: 20px; bottom: 20px;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
    }
    /* Apply-flow badge + save go bottom-LEFT so they never overlap the
       autofill/remember buttons (a different content script) on the right. */
    .je-fab-left { left: 20px; right: auto; }
    .je-sync-fab { background: #7c3aed; }  /* purple: the sync action */
    .je-sync-fab[data-state="busy"] { background: #6b7280; }
    /* Sync review panel */
    #${SYNC_PANEL_ID} {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 380px; max-height: 78vh; overflow: auto;
      background: #fff; color: #111827; border-radius: 12px;
      box-shadow: 0 12px 34px rgba(0,0,0,.3);
      font: 13px/1.45 system-ui, -apple-system, sans-serif;
    }
    @media (prefers-color-scheme: dark) { #${SYNC_PANEL_ID} { background: #1f2937; color: #f3f4f6; } }
    #${SYNC_PANEL_ID} .je-sp-head {
      position: sticky; top: 0; display: flex; align-items: center;
      justify-content: space-between; padding: 11px 13px; background: inherit;
      border-bottom: 1px solid rgba(148,163,184,.3); font-size: 14px;
    }
    #${SYNC_PANEL_ID} .je-sp-close { background: none; border: 0; cursor: pointer; color: inherit; font-size: 13px; }
    #${SYNC_PANEL_ID} .je-sp-sub { padding: 8px 13px; font-size: 12px; color: #6b7280; }
    #${SYNC_PANEL_ID} .je-sp-body { padding: 2px 13px; }
    #${SYNC_PANEL_ID} .je-sp-row { padding: 9px 0; border-bottom: 1px solid rgba(148,163,184,.18); }
    #${SYNC_PANEL_ID} .je-sp-top { display: flex; gap: 9px; align-items: flex-start; cursor: pointer; }
    #${SYNC_PANEL_ID} .je-sp-top input { margin-top: 3px; }
    #${SYNC_PANEL_ID} .je-sp-title { font-weight: 600; font-size: 12.5px; }
    #${SYNC_PANEL_ID} .je-sp-co { font-size: 11.5px; color: #6b7280; margin-top: 1px; }
    #${SYNC_PANEL_ID} .je-sp-stage {
      display: flex; align-items: center; gap: 6px; margin: 7px 0 0 26px;
    }
    #${SYNC_PANEL_ID} .je-sp-badge {
      font-size: 11px; padding: 2px 7px; border-radius: 999px;
      background: rgba(37,99,235,.14); color: #2563eb; white-space: nowrap;
    }
    #${SYNC_PANEL_ID} .je-sp-arrow { color: #9ca3af; }
    #${SYNC_PANEL_ID} .je-sp-sel {
      flex: 1 1 auto; padding: 5px 7px; border: 1px solid #d1d5db; border-radius: 7px;
      font: inherit; background: #fff; color: #111827;
    }
    @media (prefers-color-scheme: dark) {
      #${SYNC_PANEL_ID} .je-sp-sel { background: #111827; color: #f3f4f6; border-color: #374151; }
    }
    #${SYNC_PANEL_ID} .je-sp-foot {
      position: sticky; bottom: 0; display: flex; flex-direction: column; gap: 8px;
      padding: 11px 13px; background: inherit; border-top: 1px solid rgba(148,163,184,.3);
    }
    #${SYNC_PANEL_ID} .je-sp-btnrow { display: flex; justify-content: flex-end; gap: 8px; }
    #${SYNC_PANEL_ID} .je-sp-status {
      padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.4;
    }
    #${SYNC_PANEL_ID} .je-sp-status[data-kind="info"] { background: rgba(37,99,235,.12); color: #2563eb; }
    #${SYNC_PANEL_ID} .je-sp-status[data-kind="error"] { background: rgba(220,38,38,.12); color: #dc2626; }
    #${SYNC_PANEL_ID} .je-sp-sync { background: #7c3aed; color: #fff; border: 0; border-radius: 8px; padding: 9px 15px; font-weight: 700; cursor: pointer; }
    #${SYNC_PANEL_ID} .je-sp-sync:disabled { background: #6b7280; cursor: default; }
    #${SYNC_PANEL_ID} .je-sp-cancel { background: transparent; color: inherit; border: 1px solid #d1d5db; border-radius: 8px; padding: 9px 13px; cursor: pointer; }
    #${SYNC_PANEL_ID} .je-sp-done { padding: 16px 13px 8px; text-align: center; }
    #${SYNC_PANEL_ID} .je-sp-done-big { font-size: 20px; font-weight: 800; color: #16a34a; margin-bottom: 4px; }
    #${SYNC_PANEL_ID} .je-sp-done-note { padding: 8px 13px 12px; text-align: center; font-size: 12px; color: #6b7280; }
    #${SYNC_PANEL_ID} .je-sp-results { padding: 2px 13px; }
    #${SYNC_PANEL_ID} .je-sp-rgroup { margin-bottom: 8px; }
    #${SYNC_PANEL_ID} .je-sp-rhead {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .05em; margin: 8px 0 4px;
    }
    #${SYNC_PANEL_ID} .je-sp-rhead.updated { color: #2563eb; }
    #${SYNC_PANEL_ID} .je-sp-rhead.imported { color: #16a34a; }
    #${SYNC_PANEL_ID} .je-sp-rhead.skipped { color: #9ca3af; }
    #${SYNC_PANEL_ID} .je-sp-rrow {
      display: flex; justify-content: space-between; gap: 10px; padding: 3px 0;
      border-bottom: 1px solid rgba(148,163,184,.15); font-size: 12px;
    }
    #${SYNC_PANEL_ID} .je-sp-rname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${SYNC_PANEL_ID} .je-sp-rstage { flex: 0 0 auto; color: #6b7280; }
  `;
    document.documentElement.appendChild(style);
  }
})();
