// "Pick from page" mode — injected on demand by the popup.
// The user hovers (elements highlight) and clicks the JOB TITLE. We capture that
// text, then best-effort scoop the company + location from the surrounding block,
// stash it in extension storage, and tell them to reopen the popup to save.
(() => {
  if (window.__jeePickerActive) return;
  window.__jeePickerActive = true;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;z-index:2147483647;border:2px solid #16a34a;" +
    "background:rgba(22,163,74,.12);pointer-events:none;border-radius:4px;";
  const hint = document.createElement("div");
  hint.textContent = "Click the JOB TITLE to capture it  ·  Esc to cancel";
  hint.style.cssText =
    "position:fixed;top:14px;left:50%;transform:translateX(-50%);" +
    "z-index:2147483647;background:#111827;color:#fff;padding:9px 16px;" +
    "border-radius:9px;font:600 13px system-ui,sans-serif;" +
    "box-shadow:0 6px 18px rgba(0,0,0,.35);";
  document.body.append(overlay, hint);

  let current = null;

  const onMove = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === current || el === overlay || el === hint) return;
    current = el;
    const r = el.getBoundingClientRect();
    overlay.style.top = r.top + "px";
    overlay.style.left = r.left + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
  };

  const cleanup = () => {
    window.__jeePickerActive = false;
    overlay.remove();
    hint.remove();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  };

  const onKey = (e) => {
    if (e.key === "Escape") cleanup();
  };

  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = current || e.target;
    const clean = (s) => (s || "").trim().replace(/\s+/g, " ");
    const title = clean(el.innerText).slice(0, 300);

    // Look at the surrounding "job header" block to infer company + location.
    const block =
      el.closest("article, section, header, [class*='header' i], [class*='job' i], main") ||
      el.parentElement?.parentElement ||
      document.body;
    const text = block.innerText || "";

    let company = "";
    for (const a of block.querySelectorAll("a")) {
      const t = clean(a.innerText);
      if (t && t !== title && t.length <= 60 && !/apply|save|share|report|sign|view/i.test(t)) {
        company = t;
        break;
      }
    }

    let loc = "";
    const m = text.match(/([A-Z][A-Za-z.\-' ]+,\s*[A-Z]{2}(?:\s*\d{5})?)/);
    if (m) loc = clean(m[1]);
    const isRemote = /\bremote\b/i.test(text);

    chrome.storage.local.set({
      je_capture: {
        title,
        company: company.slice(0, 200),
        location: loc.slice(0, 200),
        is_remote: isRemote,
        url: window.location.href,
      },
    });

    hint.textContent = "✓ Captured — review & save it in the side panel.";
    hint.style.background = "#16a34a";
    overlay.remove();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.__jeePickerActive = false;
    setTimeout(() => hint.remove(), 2000);
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
})();
