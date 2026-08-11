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
      const esc2 = globalThis.CSS?.escape ? globalThis.CSS.escape(el.id) : el.id;
      const label = doc.querySelector(`label[for="${esc2}"]`);
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
  var AUTOCOMPLETE_MAP = {
    "given-name": "first_name",
    "family-name": "last_name",
    name: "full_name",
    email: "email",
    tel: "phone",
    "tel-national": "phone",
    "street-address": "address_line1",
    "address-line1": "address_line1",
    "address-line2": "address_line2",
    "address-level2": "city",
    // city/locality
    "address-level1": "state",
    // state/province
    "postal-code": "postal_code",
    country: "country",
    "country-name": "country",
    url: "portfolio_url"
  };
  var RULES = [
    { key: "first_name", re: /first[\s_-]*name|given[\s_-]*name/i },
    { key: "last_name", re: /last[\s_-]*name|surname|family[\s_-]*name/i },
    { key: "full_name", re: /full[\s_-]*name|your[\s_-]*name|^name$/i },
    { key: "email", re: /e-?mail/i },
    { key: "phone", re: /phone|mobile|telephone/i },
    { key: "linkedin_url", re: /linked[\s_-]*in/i },
    { key: "github_url", re: /git[\s_-]*hub/i },
    { key: "portfolio_url", re: /portfolio|personal[\s_-]*(web)?site|website/i },
    // A single combined "location" field (Greenhouse/Lever) — checked before the
    // granular address rules so it wins over the discrete city/state of forms
    // like Amazon (whose "City" field has no "location" in its text).
    { key: "location", re: /location/i },
    { key: "address_line2", re: /address[\s_-]*line[\s_-]*2|apartment|apt\b|unit\b|suite/i },
    { key: "address_line1", re: /address[\s_-]*line[\s_-]*1|street[\s_-]*address|^street|^address\b/i },
    { key: "city", re: /\bcity\b|town/i },
    { key: "postal_code", re: /postal|zip/i },
    { key: "country", re: /country/i },
    { key: "state", re: /\bstate\b|province|region/i },
    { key: "authorized_to_work", re: /authorized[\s\S]*work|work[\s_-]*authorization|legally[\s\S]*work|eligib[\s\S]*work/i },
    { key: "requires_sponsorship", re: /sponsor/i },
    { key: "willing_to_relocate", re: /relocat/i },
    { key: "desired_salary", re: /salary|compensation[\s_-]*expect/i },
    { key: "notice_period", re: /notice[\s_-]*period|start[\s_-]*date/i }
  ];
  var SKIP = /cover[\s_-]*letter|why[\s\S]*(join|work|interested)|additional[\s_-]*info|comments|token|captcha/i;
  function keyFor(el, doc) {
    const type = (el.getAttribute?.("type") || el.tagName || "").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return null;
    const ac = (el.getAttribute?.("autocomplete") || "").toLowerCase().trim();
    if (ac && ac !== "off" && ac !== "on") {
      for (const token of ac.split(/\s+/)) {
        if (AUTOCOMPLETE_MAP[token]) return AUTOCOMPLETE_MAP[token];
      }
    }
    const text = labelTextFor(el, doc);
    if (type === "file") {
      return /resume|cv\b/i.test(text) ? "resume_file" : null;
    }
    if (!text || SKIP.test(text)) return null;
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
  var UNFILLABLE = /* @__PURE__ */ new Set([
    "hidden",
    "submit",
    "button",
    "checkbox",
    "radio",
    "file",
    "password",
    "search"
  ]);
  function visibleLabelFor(el, doc) {
    const parts = [];
    if (el.id) {
      const esc2 = globalThis.CSS?.escape ? globalThis.CSS.escape(el.id) : el.id;
      const label = doc.querySelector(`label[for="${esc2}"]`);
      if (label) parts.push(label.textContent);
    }
    const wrapping = el.closest?.("label");
    if (wrapping) parts.push(wrapping.textContent);
    parts.push(el.getAttribute?.("aria-label"));
    parts.push(el.getAttribute?.("placeholder"));
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  function normalizeQuestion(text) {
    return String(text || "").toLowerCase().replace(/\(required\)|\(optional\)|required|optional/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 255);
  }
  function collectUnmapped(doc) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const el of doc.querySelectorAll("input, textarea, select")) {
      const type = (el.getAttribute?.("type") || el.tagName || "").toLowerCase();
      if (UNFILLABLE.has(type)) continue;
      if (keyFor(el, doc)) continue;
      const questionText = visibleLabelFor(el, doc);
      const questionKey = normalizeQuestion(questionText);
      if (questionKey.length < 3) continue;
      if (seen.has(questionKey)) continue;
      seen.add(questionKey);
      out.push({ el, questionText, questionKey });
    }
    return out;
  }
  function matchAnswer(questionKey, answers) {
    if (!answers?.length) return null;
    const exact = answers.find((a) => a.question_key === questionKey);
    if (exact) return exact;
    const qTokens = new Set(questionKey.split(" ").filter((t) => t.length > 2));
    if (qTokens.size < 2) return null;
    let best = null;
    let bestScore = 0;
    for (const a of answers) {
      const aTokens = new Set((a.question_key || "").split(" ").filter((t) => t.length > 2));
      if (!aTokens.size) continue;
      let shared = 0;
      for (const t of qTokens) if (aTokens.has(t)) shared++;
      const score = shared / (/* @__PURE__ */ new Set([...qTokens, ...aTokens])).size;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return bestScore >= 0.6 ? best : null;
  }

  // src/autofill/fill.js
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.dispatchEvent(new Event("focusout", { bubbles: true }));
  }
  function setSelectValue(el, wanted) {
    const target = String(wanted).toLowerCase();
    for (const opt of el.options ?? el.querySelectorAll("option")) {
      const text = (opt.textContent || "").trim().toLowerCase();
      const value = (opt.value || "").toLowerCase();
      if (text === target || value === target || text.startsWith(target)) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        el.dispatchEvent(new Event("focusout", { bubbles: true }));
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
  function fillCustomAnswers(unmapped, answers, matchFn) {
    const learned = [];
    const remaining = [];
    for (const { el, questionText, questionKey } of unmapped) {
      if ((el.value || "").trim()) continue;
      const match = matchFn(questionKey, answers);
      if (!match) {
        remaining.push({ questionText, questionKey });
        continue;
      }
      if (el.tagName === "SELECT") {
        if (setSelectValue(el, match.answer)) {
          el.classList.add(HIGHLIGHT);
          learned.push({ questionKey, questionText, value: match.answer });
        } else {
          remaining.push({ questionText, questionKey });
        }
      } else {
        setNativeValue(el, String(match.answer));
        el.classList.add(HIGHLIGHT);
        learned.push({ questionKey, questionText, value: match.answer });
      }
    }
    return { learned, remaining };
  }
  function captureAnswers(unmapped) {
    const out = [];
    for (const { el, questionText, questionKey } of unmapped) {
      let answer = "";
      if (el.tagName === "SELECT") {
        const opt = el.options?.[el.selectedIndex];
        answer = (opt?.textContent || opt?.value || "").trim();
      } else {
        answer = (el.value || "").trim();
      }
      if (!answer || answer.length > 2e3) continue;
      out.push({
        question_key: questionKey,
        question_text: questionText.slice(0, 500),
        answer
      });
    }
    return out;
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
      address_line1: p.address_line1,
      address_line2: p.address_line2,
      city: p.city,
      state: p.state,
      postal_code: p.postal_code,
      country: p.country,
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
  var REMEMBER_ID = "je-remember-btn";
  var PANEL_ID = "je-autofill-panel";
  var LABEL = "\u26A1 Autofill from Job Enhancer";
  var LABELS = {
    first_name: "First name",
    last_name: "Last name",
    full_name: "Full name",
    email: "Email",
    phone: "Phone",
    address_line1: "Address line 1",
    address_line2: "Address line 2",
    city: "City",
    state: "State",
    postal_code: "Postal / ZIP",
    country: "Country",
    location: "Location",
    linkedin_url: "LinkedIn",
    github_url: "GitHub",
    portfolio_url: "Portfolio / website",
    authorized_to_work: "Work authorization",
    requires_sponsorship: "Needs sponsorship",
    willing_to_relocate: "Willing to relocate",
    desired_salary: "Desired salary",
    notice_period: "Notice period / start date",
    resume_file: "R\xE9sum\xE9"
  };
  if (document.body) {
    injectStyles();
    ensureButton();
    let _t;
    new MutationObserver(() => {
      clearTimeout(_t);
      _t = setTimeout(ensureButton, 500);
    }).observe(document.body, { childList: true, subtree: true });
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
  function safeSend(msg) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(msg));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  async function run(btn) {
    if (btn.dataset.state === "busy") return;
    try {
      if (!chrome.runtime?.id) {
        setState(btn, "error", "\u21BB Refresh page \u2014 extension updated");
        return;
      }
    } catch {
      setState(btn, "error", "\u21BB Refresh page \u2014 extension updated");
      return;
    }
    setState(btn, "busy", "Filling\u2026");
    const res = await safeSend({ type: "getAutofillData" }).catch(() => null);
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
    const values = buildValues(res.profile, res.email);
    const report = fillFields(collectFields(document), values, resumeFile);
    const custom = fillCustomAnswers(
      collectUnmapped(document),
      res.customAnswers || [],
      matchAnswer
    );
    const filled = report.filled.length + custom.learned.length;
    const toAnswer = custom.remaining.length;
    setState(
      btn,
      "done",
      toAnswer ? `\u2713 Filled ${filled} \xB7 ${toAnswer} to answer` : `\u2713 Filled ${filled} \u2014 review & submit`
    );
    ensureRememberButton(toAnswer > 0 || custom.learned.length > 0);
    showAutofillPanel({
      filled: report.filled.map((k) => ({ label: LABELS[k] || k, value: displayValue(k, values, resumeFile) })),
      learned: custom.learned.map((l) => ({ label: l.questionText, value: String(l.value) })),
      toAnswer: custom.remaining.map((r) => ({ label: r.questionText })),
      missing: report.attention.filter((k) => k !== "resume_file" || !resumeFile).map((k) => ({ label: LABELS[k] || k }))
    });
  }
  function displayValue(key, values, resumeFile) {
    if (key === "resume_file") return resumeFile ? resumeFile.name || "attached" : "";
    const v = values[key];
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v ?? "");
  }
  function esc(s) {
    return String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
    );
  }
  function showAutofillPanel(data) {
    document.getElementById(PANEL_ID)?.remove();
    const trunc = (s) => s.length > 42 ? s.slice(0, 41) + "\u2026" : s;
    const section = (title, items, cls, withValue) => {
      if (!items.length) return "";
      const rows = items.map(
        (i) => `<div class="je-row"><span>${esc(trunc(i.label))}</span>${withValue && i.value ? `<em>${esc(trunc(i.value))}</em>` : ""}</div>`
      ).join("");
      return `<div class="je-sec"><div class="je-sec-h ${cls}">${title} (${items.length})</div>${rows}</div>`;
    };
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `<div class="je-p-head"><b>Autofill summary</b><button class="je-p-close" type="button" aria-label="Close">\u2715</button></div><div class="je-p-body">` + section("Filled", data.filled, "ok", true) + section("Learned", data.learned, "learn", true) + section("Answer these", data.toAnswer, "warn", false) + section("No data saved", data.missing, "muted", false) + `</div>`;
    document.body.appendChild(panel);
    panel.querySelector(".je-p-close").addEventListener("click", () => panel.remove());
  }
  function ensureRememberButton(show) {
    let rb = document.getElementById(REMEMBER_ID);
    if (!show) {
      rb?.remove();
      return;
    }
    if (rb) return;
    rb = document.createElement("button");
    rb.id = REMEMBER_ID;
    rb.type = "button";
    rb.textContent = "\u{1F4BE} Remember my answers";
    rb.addEventListener("click", () => rememberAnswers(rb));
    document.body.appendChild(rb);
  }
  async function rememberAnswers(rb) {
    rb.dataset.state = "busy";
    rb.textContent = "Saving\u2026";
    const answers = captureAnswers(collectUnmapped(document));
    if (!answers.length) {
      rb.dataset.state = "";
      rb.textContent = "Answer some questions first";
      setTimeout(() => rb.textContent = "\u{1F4BE} Remember my answers", 2500);
      return;
    }
    const res = await safeSend({ type: "saveCustomAnswers", answers }).catch(() => null);
    if (res?.ok) {
      rb.dataset.state = "done";
      rb.textContent = `\u2713 Remembered ${res.saved} \u2014 reused next time`;
      setTimeout(() => rb.remove(), 3500);
    } else {
      rb.dataset.state = "error";
      rb.textContent = res?.error === "NOT_SIGNED_IN" ? "Sign in first" : "Couldn't save";
      setTimeout(() => {
        rb.dataset.state = "";
        rb.textContent = "\u{1F4BE} Remember my answers";
      }, 3e3);
    }
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
        safeSend({ type: "markApplied", job }).catch(() => {
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
    #${REMEMBER_ID} {
      position: fixed; right: 20px; bottom: 66px; z-index: 2147483647;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 15px; border: 0; border-radius: 999px;
      font: 600 13px/1 system-ui, -apple-system, sans-serif; color: #fff;
      background: #2563eb; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.28);
    }
    #${REMEMBER_ID}[data-state="busy"] { background: #6b7280; cursor: default; }
    #${REMEMBER_ID}[data-state="done"] { background: #16a34a; }
    #${REMEMBER_ID}[data-state="error"] { background: #dc2626; }
    .je-autofilled { outline: 2px solid #7c3aed55 !important; border-radius: 4px; }
    #${PANEL_ID} {
      position: fixed; right: 20px; bottom: 112px; z-index: 2147483647;
      width: 300px; max-height: 46vh; overflow: auto;
      background: #fff; color: #111827; border-radius: 12px;
      box-shadow: 0 12px 34px rgba(0,0,0,.28);
      font: 13px/1.45 system-ui, -apple-system, sans-serif;
    }
    @media (prefers-color-scheme: dark) { #${PANEL_ID} { background: #1f2937; color: #f3f4f6; } }
    #${PANEL_ID} .je-p-head {
      position: sticky; top: 0; display: flex; align-items: center;
      justify-content: space-between; padding: 10px 12px; background: inherit;
      border-bottom: 1px solid rgba(148,163,184,.3);
    }
    #${PANEL_ID} .je-p-close { background: none; border: 0; cursor: pointer; color: inherit; font-size: 13px; }
    #${PANEL_ID} .je-p-body { padding: 6px 12px 12px; }
    #${PANEL_ID} .je-sec-h {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .05em; margin: 10px 0 4px;
    }
    #${PANEL_ID} .je-sec-h.ok { color: #16a34a; }
    #${PANEL_ID} .je-sec-h.learn { color: #2563eb; }
    #${PANEL_ID} .je-sec-h.warn { color: #d97706; }
    #${PANEL_ID} .je-sec-h.muted { color: #9ca3af; }
    #${PANEL_ID} .je-row {
      display: flex; justify-content: space-between; gap: 10px; padding: 3px 0;
      border-bottom: 1px solid rgba(148,163,184,.15);
    }
    #${PANEL_ID} .je-row em {
      color: #6b7280; font-style: normal; text-align: right;
      max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  `;
    document.documentElement.appendChild(style);
  }
})();
