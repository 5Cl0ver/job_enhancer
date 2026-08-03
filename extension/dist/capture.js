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
    const job2 = postings[0];
    const title = clean(job2.title);
    if (!title) return null;
    const location2 = addressText(job2.jobLocation);
    const description = stripHtml(job2.description);
    const remoteFlag = job2.jobLocationType === "TELECOMMUTE" || !!job2.applicantLocationRequirements || looksRemote(title, location2, description);
    return {
      title,
      company: orgName(job2.hiringOrganization),
      location: location2,
      is_remote: remoteFlag,
      url: clean(job2.url) || url,
      description
    };
  }

  // src/extract/indeed-embedded.js
  function normalizeDetail(detail, url) {
    if (!detail?.jobTitle) return null;
    const description = stripHtml(detail.description || "");
    return {
      title: clean(detail.jobTitle),
      company: clean(detail.companyName),
      location: clean(detail.formattedLocation),
      description,
      is_remote: looksRemote(detail.formattedLocation, detail.jobTitle, description),
      url
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
      url
    };
  }
  function selectedJobKey(url) {
    try {
      const p = new URL(url).searchParams;
      return p.get("vjk") || p.get("jk");
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
    const detail = normalizeDetail(b.detail, url);
    if (detail) return detail;
    if (Array.isArray(b.cards)) {
      const jk = selectedJobKey(url);
      const card = jk ? b.cards.find((c) => c.jobkey === jk) : null;
      if (card) return normalizeCard(card, url);
    }
    return null;
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
    const results = scanScripts(
      doc,
      'mosaic-provider-jobcards"]',
      (d) => d?.metaData?.mosaicProviderJobCardsModel?.results || null
    );
    if (Array.isArray(results)) {
      const jk = selectedJobKey(url);
      const card = jk ? results.find((c) => c.jobkey === jk) : null;
      if (card) return normalizeCard(card, url);
    }
    return null;
  }
  function extractIndeedEmbedded(doc, url) {
    return fromBridge(doc, url) || fromStatic(doc, url);
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

  // src/capture.entry.js
  var job = extractJob(document, location.href);
  chrome.storage.local.set({ je_capture: job });
})();
