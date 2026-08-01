// Content script — injects a "+ Save" button onto each job card on the major
// boards. Clicking it reads that card's fields and asks the background worker to
// save the job (content scripts can't call the API directly). Selectors are
// best-effort per site and may need tuning as the boards change their markup;
// the side panel's "Pick from page" always works as a universal fallback.
(() => {
  const host = location.hostname;
  const clean = (s) => (s || "").trim().replace(/\s+/g, " ");

  const text = (card, sels) => {
    for (const sel of sels) {
      const el = card.querySelector(sel);
      const t = el?.getAttribute?.("title") || el?.innerText;
      if (t && t.trim()) return clean(t);
    }
    return "";
  };
  const href = (card, sels) => {
    for (const sel of sels) {
      const el = card.querySelector(sel);
      if (el?.href) return el.href;
    }
    return location.href;
  };

  const SITES = [
    {
      match: () => host.includes("indeed."),
      cards:
        ".job_seen_beacon, .cardOutline, [data-testid='slider_item'], .jobsearch-SerpJobCard",
      title: (c) =>
        text(c, [
          "h2.jobTitle a span[title]",
          "h2.jobTitle span",
          ".jobTitle",
          "h2 a span",
        ]),
      company: (c) =>
        text(c, ["[data-testid='company-name']", ".companyName", "[data-company-name]"]),
      location: (c) =>
        text(c, ["[data-testid='text-location']", ".companyLocation"]),
      link: (c) =>
        href(c, ["h2.jobTitle a", "a.jcs-JobTitle", "a[href*='viewjob']", "a[data-jk]"]),
    },
    {
      match: () => host.includes("linkedin."),
      cards:
        ".job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item",
      title: (c) =>
        text(c, [
          ".job-card-list__title",
          "a.job-card-container__link span[aria-hidden='true']",
          ".artdeco-entity-lockup__title",
        ]),
      company: (c) =>
        text(c, [
          ".job-card-container__company-name",
          ".artdeco-entity-lockup__subtitle",
          ".job-card-container__primary-description",
        ]),
      location: (c) =>
        text(c, [".job-card-container__metadata-item", ".artdeco-entity-lockup__caption"]),
      link: (c) =>
        href(c, ["a.job-card-container__link", "a[href*='/jobs/view/']"]),
    },
    {
      match: () => host.includes("glassdoor."),
      cards: "[data-test='jobListing'], li.react-job-listing",
      title: (c) => text(c, ["[data-test='job-title']"]),
      company: (c) => text(c, ["[data-test='employer-short-name']"]),
      location: (c) => text(c, ["[data-test='emp-location']"]),
      link: (c) => href(c, ["a[data-test='job-link']", "a[href*='/job-listing/']"]),
    },
  ];

  const site = SITES.find((s) => s.match());
  if (!site) return;

  const flash = (btn, msg) => {
    btn.textContent = msg;
    btn.classList.add("je-err");
    setTimeout(() => {
      btn.textContent = "+ Save";
      btn.classList.remove("je-err");
    }, 2500);
  };

  const attach = (card) => {
    if (card.querySelector(":scope > .je-save-btn")) return;
    const btn = document.createElement("button");
    btn.className = "je-save-btn";
    btn.type = "button";
    btn.textContent = "+ Save";
    btn.addEventListener(
      "click",
      async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const title = site.title(card);
        if (!title) return flash(btn, "No title");
        const job = {
          title: title.slice(0, 300),
          company: (site.company(card) || "Unknown").slice(0, 200),
          location: (site.location(card) || "Not specified").slice(0, 200),
          is_remote: /\bremote\b/i.test(card.innerText || ""),
          url: site.link(card),
        };
        btn.disabled = true;
        btn.textContent = "Saving…";
        const res = await chrome.runtime
          .sendMessage({ type: "saveJob", job })
          .catch(() => ({ ok: false, error: "error" }));
        btn.disabled = false;
        if (res?.ok) {
          btn.textContent = "✓ Saved";
          btn.classList.add("je-saved");
        } else if (res?.error === "NOT_SIGNED_IN") {
          flash(btn, "Open panel & sign in");
        } else {
          flash(btn, res?.error?.slice(0, 20) || "Failed");
        }
      },
      true,
    );
    if (getComputedStyle(card).position === "static") card.style.position = "relative";
    card.appendChild(btn);
  };

  const scan = () => document.querySelectorAll(site.cards).forEach(attach);

  scan();
  // SPA feeds load cards lazily — re-scan on DOM changes (debounced).
  let t;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(scan, 400);
  }).observe(document.body, { childList: true, subtree: true });
})();
