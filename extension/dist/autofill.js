(() => {
  // src/autofill/mapper.js
  function detectAts(url) {
    let host = "", path = "";
    try {
      const u = new URL(url);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
    if (/(^|\.)greenhouse\.io$/i.test(host)) return "greenhouse";
    if (/(^|\.)lever\.co$/i.test(host) && /\/(apply|application)/i.test(path)) return "lever";
    if (/(^|\.)lever\.co$/i.test(host)) return "lever";
    return null;
  }
  function labelTextFor(el, doc) {
    const parts = [];
    if (el.id) {
      const esc = globalThis.CSS?.escape ? globalThis.CSS.escape(el.id) : el.id;
      const label = doc.querySelector(`label[for="${esc}"]`);
      if (label) parts.push(label.textContent);
    }
    const wrapping = el.closest?.("label");
    if (wrapping) parts.push(wrapping.textContent);
    parts.push(el.getAttribute?.("aria-label"));
    parts.push(el.getAttribute?.("placeholder"));
    parts.push(el.getAttribute?.("name"));
    parts.push(el.id);
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  var RULES = [
    { key: "first_name", re: /first[\s_-]*name/i },
    { key: "last_name", re: /last[\s_-]*name|surname|family[\s_-]*name/i },
    { key: "full_name", re: /full[\s_-]*name|your[\s_-]*name|^name$/i },
    { key: "email", re: /e-?mail/i },
    { key: "phone", re: /phone|mobile/i },
    { key: "linkedin_url", re: /linked[\s_-]*in/i },
    { key: "github_url", re: /git[\s_-]*hub/i },
    { key: "portfolio_url", re: /portfolio|personal[\s_-]*(web)?site|website/i },
    { key: "location", re: /location|current[\s_-]*city|^city$/i },
    { key: "authorized_to_work", re: /authorized[\s\S]*work|work[\s_-]*authorization|legally[\s\S]*work/i },
    { key: "requires_sponsorship", re: /sponsor/i },
    { key: "willing_to_relocate", re: /relocat/i },
    { key: "desired_salary", re: /salary|compensation[\s_-]*expect/i },
    { key: "notice_period", re: /notice[\s_-]*period|start[\s_-]*date/i }
  ];
  var SKIP = /cover[\s_-]*letter|why[\s\S]*(join|work|interested)|additional[\s_-]*info|comments|token|captcha/i;
  function keyFor(el, doc) {
    const type = (el.getAttribute?.("type") || el.tagName || "").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return null;
    const text = labelTextFor(el, doc);
    if (!text || SKIP.test(text)) return null;
    if (type === "file") {
      return /resume|cv\b/i.test(text) ? "resume_file" : null;
    }
    for (const rule of RULES) {
      if (rule.re.test(text)) return rule.key;
    }
    return null;
  }
  function collectFields(doc) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const el of doc.querySelectorAll("input, select, textarea")) {
      const key = keyFor(el, doc);
      if (!key) continue;
      if (key !== "resume_file" && seen.has(key)) continue;
      seen.add(key);
      out.push({ el, key });
    }
    return out;
  }

  // src/autofill/fill.js
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function setSelectValue(el, wanted) {
    const target = String(wanted).toLowerCase();
    for (const opt of el.options ?? el.querySelectorAll("option")) {
      const text = (opt.textContent || "").trim().toLowerCase();
      const value = (opt.value || "").toLowerCase();
      if (text === target || value === target || text.startsWith(target)) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }
  function attachFile(el, file) {
    if (typeof DataTransfer === "undefined") return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }
  var HIGHLIGHT = "je-autofilled";
  function boolAnswer(v) {
    return v === true ? "Yes" : v === false ? "No" : null;
  }
  function fillFields(fields, values, resumeFile) {
    const filled = [];
    const attention = [];
    for (const { el, key } of fields) {
      if (key === "resume_file") {
        if (resumeFile && (!el.files || el.files.length === 0)) {
          if (attachFile(el, resumeFile)) {
            el.classList.add(HIGHLIGHT);
            filled.push(key);
          } else {
            attention.push(key);
          }
        } else if (!resumeFile) {
          attention.push(key);
        }
        continue;
      }
      let value = values[key];
      if (typeof value === "boolean" || key === "authorized_to_work" || key === "requires_sponsorship" || key === "willing_to_relocate") {
        value = boolAnswer(values[key]);
      }
      if (value == null || value === "") {
        attention.push(key);
        continue;
      }
      if (el.tagName === "SELECT") {
        if (setSelectValue(el, value)) {
          el.classList.add(HIGHLIGHT);
          filled.push(key);
        } else {
          attention.push(key);
        }
        continue;
      }
      if ((el.value || "").trim()) continue;
      setNativeValue(el, String(value));
      el.classList.add(HIGHLIGHT);
      filled.push(key);
    }
    return { filled, attention };
  }
  function buildValues(profile, email) {
    const p = profile || {};
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ");
    const location2 = [p.city, p.state].filter(Boolean).join(", ");
    return {
      first_name: p.first_name,
      last_name: p.last_name,
      full_name: fullName || null,
      email: email || null,
      phone: p.phone,
      location: location2 || null,
      linkedin_url: p.linkedin_url,
      github_url: p.github_url,
      portfolio_url: p.portfolio_url,
      authorized_to_work: p.authorized_to_work,
      requires_sponsorship: p.requires_sponsorship,
      willing_to_relocate: p.willing_to_relocate,
      desired_salary: p.desired_salary,
      notice_period: p.notice_period
    };
  }

  // src/autofill.entry.js
  var ATS = detectAts(location.href);
  var BTN_ID = "je-autofill-btn";
  var LABEL = "\u26A1 Autofill from Job Enhancer";
  if (ATS) {
    injectStyles();
    ensureButton();
    new MutationObserver(() => ensureButton()).observe(document.body, {
      childList: true,
      subtree: true
    });
    watchForSubmit();
  }
  function hasFillableForm() {
    return collectFields(document).length >= 2;
  }
  function ensureButton() {
    let btn = document.getElementById(BTN_ID);
    if (!hasFillableForm()) {
      btn?.remove();
      return;
    }
    if (btn) return;
    btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = LABEL;
    btn.addEventListener("click", () => run(btn));
    document.body.appendChild(btn);
  }
  async function run(btn) {
    if (btn.dataset.state === "busy") return;
    setState(btn, "busy", "Filling\u2026");
    const res = await chrome.runtime.sendMessage({ type: "getAutofillData" }).catch(() => null);
    if (!res?.ok || !res.signedIn) {
      setState(btn, "error", "Open panel & sign in");
      setTimeout(() => setState(btn, "idle", LABEL), 3500);
      return;
    }
    let resumeFile = null;
    if (res.resume?.b64) {
      try {
        const bytes = Uint8Array.from(atob(res.resume.b64), (c) => c.charCodeAt(0));
        resumeFile = new File([bytes], res.resume.filename || "resume.pdf", {
          type: res.resume.mime || "application/pdf"
        });
      } catch {
      }
    }
    const report = fillFields(
      collectFields(document),
      buildValues(res.profile, res.email),
      resumeFile
    );
    const left = report.attention.length;
    setState(
      btn,
      "done",
      left ? `\u2713 Filled ${report.filled.length} \xB7 ${left} need you` : `\u2713 Filled ${report.filled.length} \u2014 review & submit`
    );
  }
  function setState(el, state, text) {
    el.dataset.state = state;
    el.textContent = text;
  }
  function jobInfo() {
    if (ATS === "greenhouse") {
      const m = /job application for (.+) at (.+)/i.exec(document.title);
      return {
        title: document.querySelector(".app-title, h1")?.textContent?.trim() || m?.[1] || "",
        company: document.querySelector(".company-name")?.textContent?.replace(/^\s*at\s+/i, "").trim() || m?.[2] || ""
      };
    }
    const [company, ...rest] = (document.title || "").split(" - ");
    return {
      title: document.querySelector(".posting-headline h2")?.textContent?.trim() || rest.join(" - ").trim(),
      company: (company || "").trim()
    };
  }
  function watchForSubmit() {
    let sent = false;
    document.addEventListener(
      "submit",
      () => {
        if (sent) return;
        sent = true;
        const job = jobInfo();
        if (!job.title) return;
        chrome.runtime.sendMessage({ type: "markApplied", job }).catch(() => {
        });
        const btn = document.getElementById(BTN_ID);
        if (btn) setState(btn, "done", "\u2713 Tracked in Job Enhancer");
      },
      true
      // capture — before the page's own handler navigates away
    );
  }
  function injectStyles() {
    if (document.getElementById("je-autofill-style")) return;
    const style = document.createElement("style");
    style.id = "je-autofill-style";
    style.textContent = `
    #${BTN_ID} {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 11px 17px; border: 0; border-radius: 999px;
      font: 600 14px/1 system-ui, -apple-system, sans-serif; color: #fff;
      background: #7c3aed; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,.28);
      transition: background .15s, transform .1s;
    }
    #${BTN_ID}:hover { transform: translateY(-1px); }
    #${BTN_ID}[data-state="busy"] { background: #6b7280; cursor: default; }
    #${BTN_ID}[data-state="done"] { background: #16a34a; }
    #${BTN_ID}[data-state="error"] { background: #dc2626; }
    .je-autofilled { outline: 2px solid #7c3aed55 !important; border-radius: 4px; }
  `;
    document.documentElement.appendChild(style);
  }
})();
