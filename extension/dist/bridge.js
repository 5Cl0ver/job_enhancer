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
            jobKey: window._initialData?.jobKey || model?.jobKey || h?.jobKey || "",
            jobTitle: h.jobTitle,
            companyName: h.companyName,
            formattedLocation: h.formattedLocation,
            description: model?.sanitizedJobDescription?.content || ""
          };
        }
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
                remoteLocation: r.remoteLocation
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
      }
    }
    snapshot();
    setInterval(snapshot, 800);
  })();
})();
