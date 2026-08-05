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
    if (!t || !/\b(a|an|per)\s+year\b|\byearly\b|\bannual/i.test(t)) return null;
    const nums = [...t.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map((m) => Math.round(parseFloat(m[1].replace(/,/g, "")))).filter((n) => Number.isFinite(n) && n > 1e3);
    if (!nums.length) return null;
    return { salary_min: nums[0], salary_max: nums[1] ?? null };
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
  var DESCRIPTION_HEADINGS = [
    /^full job description/i,
    /^job description/i,
    /^about the job/i,
    /^about the role/i
  ];
  function descriptionByHeading(doc) {
    if (!doc?.querySelectorAll) return "";
    for (const h of doc.querySelectorAll("h1,h2,h3,h4,strong,b")) {
      const label = clean(h.textContent);
      if (!label || label.length > 60) continue;
      if (!DESCRIPTION_HEADINGS.some((re) => re.test(label))) continue;
      let node = h;
      for (let depth = 0; depth < 3 && node; depth++) {
        let text = "";
        for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
          text += "\n" + stripHtml(sib.innerHTML || "");
        }
        const v = cleanMultiline(text);
        if (v.length >= 200) return v;
        node = node.parentElement;
      }
    }
    return "";
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
          out[field] = typeof v === "number" ? Math.round(v) : v;
          break;
        }
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
    return Number.isFinite(v) ? v : null;
  }
  function salaryFrom(job2) {
    const b = job2.baseSalary;
    const v = b?.value;
    if (v && typeof v === "object") {
      return {
        salary_min: numOrNull(v.minValue ?? v.value),
        salary_max: numOrNull(v.maxValue ?? v.value)
      };
    }
    return { salary_min: numOrNull(v), salary_max: null };
  }
  function employmentType(job2) {
    const t = job2.employmentType;
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
  function mapJobPosting(job2, url) {
    const title = clean(job2.title);
    if (!title) return null;
    const location2 = addressText(job2.jobLocation);
    const description = stripHtml(job2.description);
    const remoteFlag = job2.jobLocationType === "TELECOMMUTE" || !!job2.applicantLocationRequirements || looksRemote(title, location2, description);
    const { salary_min, salary_max } = salaryFrom(job2);
    return {
      title,
      company: orgName(job2.hiringOrganization),
      location: location2,
      is_remote: remoteFlag,
      url: clean(job2.url) || url,
      description,
      job_type: employmentType(job2),
      salary_min,
      salary_max
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
      is_remote: looksRemote(detail.formattedLocation, detail.jobTitle, description),
      url: indeedListingUrl(detail.jobKey, url)
    };
  }
  function cardSalary(card) {
    const es = card?.extractedSalary;
    if (es && (es.min || es.max) && /^year/i.test(es.type || "yearly")) {
      return {
        salary_min: es.min ? Math.round(es.min) : null,
        salary_max: es.max ? Math.round(es.max) : null
      };
    }
    return parseSalaryText(card?.salarySnippet) || { salary_min: null, salary_max: null };
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
      url: indeedListingUrl(card.jobkey, url),
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
    const result = mergeJob(candidates, url);
    if (hostOf(url).includes("indeed.")) {
      result.url = canonicalIndeedUrl(result.url) || canonicalIndeedUrl(url) || result.url;
    }
    return result;
  }

  // src/capture.entry.js
  var job = extractJob(document, location.href);
  chrome.storage.local.set({ je_capture: job });
})();
