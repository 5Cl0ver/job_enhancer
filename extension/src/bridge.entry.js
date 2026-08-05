// MAIN-world bridge (Indeed only). Content scripts run in an ISOLATED world and
// can't see the page's own JavaScript variables — but Indeed keeps the job data
// in `window._initialData` and `window.mosaic`. This script runs in the page's
// MAIN world, reads just the fields we need, and mirrors them onto
// <html data-je-embedded="…"> so the isolated extractor (indeed-embedded.js) can
// read them. Re-checks on an interval because the home feed loads jobs via XHR.
(function () {
  let last = "";

  function snapshot() {
    try {
      const out = {};

      const model = window._initialData?.jobInfoWrapperModel?.jobInfoModel;
      const h = model?.jobInfoHeaderModel;
      if (h?.jobTitle) {
        out.detail = {
          jobKey: window._initialData?.jobKey || model?.jobKey || h?.jobKey || "",
          jobTitle: h.jobTitle,
          companyName: h.companyName,
          formattedLocation: h.formattedLocation,
          description: model?.sanitizedJobDescription?.content || "",
        };
      }

      // Collect job cards from EVERY mosaic provider (the home feed spreads
      // recommendations across several), so the open ?vjk= job is found wherever
      // it lives.
      const providers = window.mosaic?.providerData || {};
      const cards = [];
      for (const key of Object.keys(providers)) {
        const results = providers[key]?.metaData?.mosaicProviderJobCardsModel?.results;
        if (!Array.isArray(results)) continue;
        for (const r of results) {
          const jobkey = r?.jobkey || r?.jobKey;
          if (jobkey) {
            cards.push({
              jobkey,
              title: r.title || r.displayTitle,
              company: r.company,
              formattedLocation: r.formattedLocation,
              snippet: r.snippet,
              remoteLocation: r.remoteLocation,
              // Salary as Indeed's own card data states it (keyed to THIS job).
              extractedSalary: r.extractedSalary || r.estimatedSalary || null,
              salarySnippet: r.salarySnippet?.text || "",
              jobTypes: r.jobTypes || null,
            });
          }
        }
      }
      if (cards.length) out.cards = cards;

      if (!out.detail && !out.cards) return;
      const s = JSON.stringify(out);
      if (s !== last) {
        last = s;
        document.documentElement.setAttribute("data-je-embedded", s);
      }
    } catch {
      /* page shape changed — extractor falls back to selectors */
    }
  }

  snapshot();
  setInterval(snapshot, 800);
})();
