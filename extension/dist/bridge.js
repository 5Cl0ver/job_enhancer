(() => {
  // src/bridge.entry.js
  (function() {
    let last = "";
    function snapshot() {
      try {
        const out = {};
        const model = window._initialData?.jobInfoWrapperModel?.jobInfoModel;
        const h = model?.jobInfoHeaderModel;
        if (h?.jobTitle) {
          out.detail = {
            jobTitle: h.jobTitle,
            companyName: h.companyName,
            formattedLocation: h.formattedLocation,
            description: model?.sanitizedJobDescription?.content || ""
          };
        }
        const results = window.mosaic?.providerData?.["mosaic-provider-jobcards"]?.metaData?.mosaicProviderJobCardsModel?.results;
        if (Array.isArray(results)) {
          out.cards = results.map((r) => ({
            jobkey: r.jobkey,
            title: r.title || r.displayTitle,
            company: r.company,
            formattedLocation: r.formattedLocation,
            snippet: r.snippet,
            remoteLocation: r.remoteLocation
          }));
        }
        if (!out.detail && !out.cards) return;
        const s = JSON.stringify(out);
        if (s !== last) {
          last = s;
          document.documentElement.setAttribute("data-je-embedded", s);
        }
      } catch {
      }
    }
    snapshot();
    setInterval(snapshot, 800);
  })();
})();
