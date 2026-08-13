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
  function labelTextFor(el2, doc) {
    const parts = [];
    if (el2.id) {
      const esc = globalThis.CSS?.escape ? globalThis.CSS.escape(el2.id) : el2.id;
      const label = doc.querySelector(`label[for="${esc}"]`);
      if (label) parts.push(label.textContent);
    }
    const wrapping = el2.closest?.("label");
    if (wrapping) parts.push(wrapping.textContent);
    parts.push(el2.getAttribute?.("aria-label"));
    parts.push(el2.getAttribute?.("placeholder"));
    parts.push(el2.getAttribute?.("name"));
    parts.push(el2.id);
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
    { key: "authorized_to_work", re: /authorized[\s\S]*(work|employ)|work[\s_-]*authorization|legally[\s\S]*(work|employ)|eligib[\s\S]*(work|employ|begin)/i },
    { key: "requires_sponsorship", re: /sponsor/i },
    { key: "willing_to_relocate", re: /relocat/i },
    { key: "desired_salary", re: /salary|compensation[\s_-]*expect/i },
    { key: "notice_period", re: /notice[\s_-]*period|start[\s_-]*date/i },
    { key: "today_date", re: /today['’]?s?[\s_-]*date|current[\s_-]*date|date[\s_-]*signed|signature[\s_-]*date|date[\s_-]*today/i }
  ];
  var SKIP = /cover[\s_-]*letter|why[\s\S]*(join|work|interested)|additional[\s_-]*info|comments|token|captcha/i;
  var NOISE = /preference|personaliz|cookie|consent|newsletter|subscrib|marketing|notification/i;
  function keyFor(el2, doc) {
    const type = (el2.getAttribute?.("type") || el2.tagName || "").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio"].includes(type)) return null;
    const ac = (el2.getAttribute?.("autocomplete") || "").toLowerCase().trim();
    if (ac && ac !== "off" && ac !== "on") {
      for (const token of ac.split(/\s+/)) {
        if (AUTOCOMPLETE_MAP[token]) return AUTOCOMPLETE_MAP[token];
      }
    }
    const text = labelTextFor(el2, doc);
    if (type === "file") {
      const accept = (el2.getAttribute?.("accept") || "").toLowerCase();
      const testid = (el2.getAttribute?.("data-testid") || el2.id || el2.name || "").toLowerCase();
      const docLike = /pdf|msword|officedocument|rtf|\.doc/.test(accept);
      if (/resume|cv\b/i.test(text) || /resume|cv/.test(testid) || docLike) return "resume_file";
      return null;
    }
    return keyForText(text);
  }
  function keyForText(text) {
    if (!text || SKIP.test(text)) return null;
    for (const rule of RULES) {
      if (rule.re.test(text)) return rule.key;
    }
    return null;
  }
  var BOOL_KEYS = /* @__PURE__ */ new Set([
    "authorized_to_work",
    "requires_sponsorship",
    "willing_to_relocate"
  ]);
  function collectFields(doc) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const el2 of doc.querySelectorAll("input, select, textarea")) {
      const key = keyFor(el2, doc);
      if (!key) continue;
      if (key !== "resume_file" && seen.has(key)) continue;
      seen.add(key);
      out.push({ el: el2, key });
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
  function visibleLabelFor(el2, doc) {
    const parts = [];
    if (el2.id) {
      const esc = globalThis.CSS?.escape ? globalThis.CSS.escape(el2.id) : el2.id;
      const label = doc.querySelector(`label[for="${esc}"]`);
      if (label) parts.push(label.textContent);
    }
    const wrapping = el2.closest?.("label");
    if (wrapping) parts.push(wrapping.textContent);
    parts.push(el2.getAttribute?.("aria-label"));
    parts.push(el2.getAttribute?.("placeholder"));
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  function normalizeQuestion(text) {
    return String(text || "").toLowerCase().replace(/\(required\)|\(optional\)|required|optional/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 255);
  }
  function collectUnmapped(doc) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const el2 of doc.querySelectorAll("input, textarea, select")) {
      const type = (el2.getAttribute?.("type") || el2.tagName || "").toLowerCase();
      if (UNFILLABLE.has(type)) continue;
      if (keyFor(el2, doc)) continue;
      const questionText = visibleLabelFor(el2, doc);
      if (!questionText || NOISE.test(questionText)) continue;
      const questionKey = normalizeQuestion(questionText);
      if (questionKey.length < 3) continue;
      if (seen.has(questionKey)) continue;
      seen.add(questionKey);
      out.push({ el: el2, questionText, questionKey });
    }
    return out;
  }
  function groupQuestion(els, options, doc) {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 500);
    const legend = els[0].closest?.("fieldset")?.querySelector?.("legend");
    if (legend?.textContent?.trim()) return clean(legend.textContent);
    const grp = els[0].closest?.('[role="radiogroup"]');
    if (grp?.getAttribute?.("aria-label")?.trim()) return clean(grp.getAttribute("aria-label"));
    const lb = grp?.getAttribute?.("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => doc.getElementById(id)?.textContent || "").join(" ").trim();
      if (t) return clean(t);
    }
    let a = els[0];
    while (a && !els.every((e) => a.contains?.(e))) a = a.parentElement;
    for (let hops = 0; a && hops < 5; hops++, a = a.parentElement) {
      let text = clean(a.textContent);
      for (const o of options) if (o.label) text = text.split(o.label).join(" ");
      text = clean(text);
      if (text.length >= 6) return text;
    }
    return "";
  }
  function collectRadioGroups(doc) {
    const byName = /* @__PURE__ */ new Map();
    for (const el2 of doc.querySelectorAll('input[type="radio"]')) {
      const name = el2.getAttribute("name");
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(el2);
    }
    const out = [];
    for (const els of byName.values()) {
      if (els.length < 2) continue;
      const options = els.map((el2) => ({ el: el2, label: visibleLabelFor(el2, doc) || el2.value || "" }));
      const question = groupQuestion(els, options, doc);
      if (NOISE.test(question)) continue;
      const questionKey = normalizeQuestion(question);
      if (questionKey.length < 3) continue;
      const k = keyForText(question);
      out.push({ question, questionKey, key: BOOL_KEYS.has(k) ? k : null, options });
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
  function setNativeValue(el2, value) {
    const proto = el2.tagName === "TEXTAREA" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el2, value);
    else el2.value = value;
    el2.dispatchEvent(new Event("input", { bubbles: true }));
    el2.dispatchEvent(new Event("change", { bubbles: true }));
    el2.dispatchEvent(new Event("blur", { bubbles: true }));
    el2.dispatchEvent(new Event("focusout", { bubbles: true }));
  }
  function setSelectValue(el2, wanted) {
    const target = String(wanted).toLowerCase();
    for (const opt of el2.options ?? el2.querySelectorAll("option")) {
      const text = (opt.textContent || "").trim().toLowerCase();
      const value = (opt.value || "").toLowerCase();
      if (text === target || value === target || text.startsWith(target)) {
        el2.value = opt.value;
        el2.dispatchEvent(new Event("change", { bubbles: true }));
        el2.dispatchEvent(new Event("blur", { bubbles: true }));
        el2.dispatchEvent(new Event("focusout", { bubbles: true }));
        return true;
      }
    }
    return false;
  }
  function setRadioValue(options, wanted) {
    const target = String(wanted).toLowerCase().trim();
    if (!target) return false;
    for (const { el: el2, label } of options) {
      const l = (label || "").toLowerCase().trim();
      const v = (el2.value || "").toLowerCase().trim();
      if (l === target || v === target || l.startsWith(target) || l.length >= 4 && target.startsWith(l)) {
        if (!el2.checked) {
          el2.checked = true;
          el2.dispatchEvent(new Event("click", { bubbles: true }));
          el2.dispatchEvent(new Event("input", { bubbles: true }));
          el2.dispatchEvent(new Event("change", { bubbles: true }));
        }
        el2.classList.add(HIGHLIGHT);
        return true;
      }
    }
    return false;
  }
  function attachFile(el2, file) {
    if (typeof DataTransfer === "undefined") return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      el2.files = dt.files;
      el2.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }
  var HIGHLIGHT = "je-autofilled";
  var _SRC_TITLE = {
    profile: "Filled from your profile",
    learned: "Remembered from a past application",
    ai: "AI-mapped from your saved data"
  };
  function markFilled(el2, source) {
    if (!el2) return;
    el2.classList.add(HIGHLIGHT, "je-src-" + source);
    try {
      el2.title = _SRC_TITLE[source] || "Filled by Job Enhancer";
    } catch {
    }
  }
  function boolAnswer(v) {
    return v === true ? "Yes" : v === false ? "No" : null;
  }
  function fillFields(fields, values, resumeFile) {
    const filled = [];
    const attention = [];
    for (const { el: el2, key } of fields) {
      if (key === "resume_file") {
        if (resumeFile && (!el2.files || el2.files.length === 0)) {
          if (attachFile(el2, resumeFile)) {
            markFilled(el2, "profile");
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
      if (el2.tagName === "SELECT") {
        if (setSelectValue(el2, value)) {
          markFilled(el2, "profile");
          filled.push(key);
        } else {
          attention.push(key);
        }
        continue;
      }
      if ((el2.value || "").trim()) continue;
      setNativeValue(el2, String(value));
      markFilled(el2, "profile");
      filled.push(key);
    }
    return { filled, attention };
  }
  function fillCustomAnswers(unmapped, answers, matchFn) {
    const learned = [];
    const remaining = [];
    for (const { el: el2, questionText, questionKey } of unmapped) {
      if ((el2.value || "").trim()) continue;
      const match = matchFn(questionKey, answers);
      if (!match) {
        remaining.push({ questionText, questionKey });
        continue;
      }
      if (el2.tagName === "SELECT") {
        if (setSelectValue(el2, match.answer)) {
          markFilled(el2, "learned");
          learned.push({ questionKey, questionText, value: match.answer });
        } else {
          remaining.push({ questionText, questionKey });
        }
      } else {
        setNativeValue(el2, String(match.answer));
        markFilled(el2, "learned");
        learned.push({ questionKey, questionText, value: match.answer });
      }
    }
    return { learned, remaining };
  }
  function captureAnswers(unmapped) {
    const out = [];
    for (const { el: el2, questionText, questionKey } of unmapped) {
      let answer = "";
      if (el2.tagName === "SELECT") {
        const opt = el2.options?.[el2.selectedIndex];
        answer = (opt?.textContent || opt?.value || "").trim();
      } else {
        answer = (el2.value || "").trim();
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
  function fillRadioGroups(groups, values, answers, matchFn) {
    const filled = [];
    const learned = [];
    const remaining = [];
    for (const g of groups) {
      if (g.options.some((o) => o.el.checked)) continue;
      let wanted = null;
      let isLearned = false;
      if (g.key) {
        const v = values[g.key];
        wanted = v === true ? "Yes" : v === false ? "No" : null;
      } else {
        const m = matchFn(g.questionKey, answers);
        if (m) {
          wanted = m.answer;
          isLearned = true;
        }
      }
      if (wanted == null || wanted === "") {
        if (!g.key) remaining.push({ questionText: g.question, questionKey: g.questionKey });
        continue;
      }
      if (setRadioValue(g.options, wanted)) {
        markFilled(g.options.find((o) => o.el.checked)?.el, isLearned ? "learned" : "profile");
        if (isLearned) learned.push({ questionKey: g.questionKey, questionText: g.question, value: wanted });
        else filled.push(g.key);
      } else if (!g.key) {
        remaining.push({ questionText: g.question, questionKey: g.questionKey });
      }
    }
    return { filled, learned, remaining };
  }
  function captureRadioAnswers(groups) {
    const out = [];
    for (const g of groups) {
      if (g.key) continue;
      const checked = g.options.find((o) => o.el.checked);
      const answer = (checked?.label || checked?.el.value || "").trim();
      if (!answer) continue;
      out.push({
        question_key: g.questionKey,
        question_text: g.question.slice(0, 500),
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

  // src/autofill/workday.js
  function isWorkdayExperience(doc) {
    return !!doc?.querySelector?.('[data-automation-id="formField-jobTitle"]');
  }
  function inWorkExperience(el2) {
    return !!el2?.closest?.('[data-fkit-id^="workExperience-"]');
  }
  function blockRoots(doc) {
    const roots = [];
    const seen = /* @__PURE__ */ new Set();
    for (const jt of doc.querySelectorAll('[data-automation-id="formField-jobTitle"]')) {
      const root = jt.closest('[data-fkit-id$="--null"]') || jt.parentElement;
      if (root && !seen.has(root)) {
        seen.add(root);
        roots.push(root);
      }
    }
    return roots;
  }
  function collectWorkExperienceBlocks(doc) {
    if (!doc?.querySelectorAll) return [];
    return blockRoots(doc).map((root) => {
      const q = (sel) => root.querySelector(sel);
      return {
        root,
        title: q('[data-automation-id="formField-jobTitle"] input'),
        company: q('[data-automation-id="formField-companyName"] input'),
        location: q('[data-automation-id="formField-location"] input'),
        role: q('[data-automation-id="formField-roleDescription"] textarea'),
        current: q('[data-automation-id="formField-currentlyWorkHere"] input[type="checkbox"]'),
        // Keep the date FIELD containers — the month/year inputs are re-created by
        // Workday when the other part changes, so we must re-query them fresh.
        startDate: q('[data-automation-id="formField-startDate"]'),
        endDate: q('[data-automation-id="formField-endDate"]')
      };
    });
  }
  function fillText(el2, value) {
    if (!el2 || value == null || value === "") return false;
    if ((el2.value || "") === String(value)) return false;
    setNativeValue(el2, String(value));
    markFilled(el2, "profile");
    return true;
  }
  function rawSet(el2, value) {
    const proto = el2.tagName === "TEXTAREA" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el2, String(value));
    else el2.value = String(value);
  }
  var MONTH_SEL = '[data-automation-id="dateSectionMonth-input"]';
  var YEAR_SEL = '[data-automation-id="dateSectionYear-input"]';
  function setFire(el2, value) {
    if (!el2) return;
    rawSet(el2, value);
    el2.dispatchEvent(new Event("input", { bubbles: true }));
    el2.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function fillDate(container, month, year, wait) {
    if (!container || !month || !year) return false;
    setFire(container.querySelector(MONTH_SEL), String(month).padStart(2, "0"));
    await wait(60);
    const yEl = container.querySelector(YEAR_SEL);
    setFire(yEl, String(year));
    if (yEl) {
      yEl.dispatchEvent(new Event("blur", { bubbles: true }));
      yEl.dispatchEvent(new Event("focusout", { bubbles: true }));
    }
    await wait(60);
    const m2 = container.querySelector(MONTH_SEL);
    const y2 = container.querySelector(YEAR_SEL);
    const stuck = (m2?.value || "").trim() && (y2?.value || "").trim();
    if (!stuck) {
      if (m2 && (m2.value || "").trim()) setNativeValue(m2, "");
      if (y2 && (y2.value || "").trim()) setNativeValue(y2, "");
      return false;
    }
    markFilled(m2, "profile");
    markFilled(y2, "profile");
    return true;
  }
  function fixPartialDate(container) {
    if (!container) return;
    const m = container.querySelector(MONTH_SEL);
    const y = container.querySelector(YEAR_SEL);
    const mv = (m?.value || "").trim();
    const yv = (y?.value || "").trim();
    if (mv && !yv || !mv && yv) {
      if (m && mv) setNativeValue(m, "");
      if (y && yv) setNativeValue(y, "");
    }
  }
  async function fillBlock(b, e, wait) {
    let any = false;
    if (fillText(b.title, e.title)) any = true;
    if (fillText(b.company, e.company)) any = true;
    if (fillText(b.location, e.location)) any = true;
    if (fillText(b.role, e.description)) any = true;
    if (e.current && b.current && !b.current.checked) {
      b.current.checked = true;
      b.current.dispatchEvent(new Event("click", { bubbles: true }));
      b.current.dispatchEvent(new Event("change", { bubbles: true }));
      markFilled(b.current, "profile");
      any = true;
    }
    if (e.start_month && e.start_year) await fillDate(b.startDate, e.start_month, e.start_year, wait);
    else fixPartialDate(b.startDate);
    if (!e.current && e.end_month && e.end_year) await fillDate(b.endDate, e.end_month, e.end_year, wait);
    else if (!e.current) fixPartialDate(b.endDate);
    return any;
  }
  async function fillWorkExperience(blocks, entries, opts = {}) {
    const wait = opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let filled = 0;
    const details = [];
    for (let i = 0; i < blocks.length; i++) {
      const e = entries[i];
      if (!e) continue;
      if (await fillBlock(blocks[i], e, wait)) {
        filled++;
        details.push({
          label: `Work Experience ${i + 1}`,
          value: [e.title, e.company].filter(Boolean).join(" \u2014 ")
        });
      }
    }
    return { filled, details };
  }
  function collectWorkdayDropdowns(doc) {
    if (!doc?.querySelectorAll) return [];
    const out = [];
    for (const button of doc.querySelectorAll('button[aria-haspopup="listbox"]')) {
      const field = button.closest('[data-automation-id^="formField-"]');
      if (!field) continue;
      const legend = field.querySelector('legend [data-automation-id="richText"]') || field.querySelector("legend");
      const question = (legend?.textContent || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
      if (!question) continue;
      out.push({ button, field, question, current: (button.textContent || "").trim() });
    }
    return out;
  }
  function dropdownAnswer(question, values, answers) {
    const key = keyForText(question);
    if (key && typeof values[key] === "boolean") return values[key] ? "Yes" : "No";
    const m = matchAnswer(normalizeQuestion(question), answers);
    return m ? m.answer : null;
  }
  var optionLabel = (o) => (o.getAttribute("data-automation-label") || o.textContent || "").replace(/\s+/g, " ").trim();
  var isPlaceholder = (label) => /^(select( one)?|choose( an option)?|-+ ?select ?-+)$/i.test(label);
  async function openOptions(dd, doc, wait) {
    dd.button.click();
    for (let t = 0; t < 20; t++) {
      await wait(40);
      const opts = [...doc.querySelectorAll('[data-automation-id="promptOption"], [role="option"]')];
      if (opts.length) return opts;
    }
    return [];
  }
  function closeDropdown(dd, doc) {
    if (doc.querySelector('[data-automation-id="promptOption"], [role="option"]')) dd.button.click();
  }
  function clickOption(opts, answer) {
    const want = String(answer).replace(/\s+/g, " ").trim().toLowerCase();
    if (!want) return false;
    const match = opts.find((o) => optionLabel(o).toLowerCase() === want) || opts.find((o) => want.length >= 2 && optionLabel(o).toLowerCase().startsWith(want));
    if (match) {
      match.click();
      return true;
    }
    return false;
  }
  async function fillWorkdayDropdowns(doc, values, answers, opts = {}) {
    const wait = opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const aiMap = opts.aiMap;
    const dds = collectWorkdayDropdowns(doc);
    const filled = [];
    const pending = [];
    for (const dd of dds) {
      const known = dropdownAnswer(dd.question, values, answers || []);
      if (known && dd.current.toLowerCase() === known.toLowerCase()) continue;
      const optsEls = await openOptions(dd, doc, wait);
      if (!optsEls.length) continue;
      if (known) {
        if (clickOption(optsEls, known)) {
          markFilled(dd.button, "profile");
          filled.push({ label: dd.question.slice(0, 70), value: known, source: "profile" });
        } else {
          closeDropdown(dd, doc);
        }
        continue;
      }
      const labels = optsEls.map(optionLabel).filter((l) => l && !isPlaceholder(l));
      closeDropdown(dd, doc);
      if (labels.length && aiMap) pending.push({ dd, options: labels });
    }
    if (pending.length && aiMap) {
      const fields = pending.map((p, i) => ({
        id: "d" + i,
        label: p.dd.question,
        type: "select",
        options: p.options
      }));
      const mappings = await aiMap(fields) || {};
      for (let i = 0; i < pending.length; i++) {
        const choice = mappings["d" + i];
        if (!choice) continue;
        const { dd } = pending[i];
        const optsEls = await openOptions(dd, doc, wait);
        if (clickOption(optsEls, choice)) {
          markFilled(dd.button, "ai");
          filled.push({ label: dd.question.slice(0, 70), value: choice, source: "ai" });
        } else {
          closeDropdown(dd, doc);
        }
      }
    }
    return filled;
  }
  async function fillAllWorkExperience(doc, entries, opts = {}) {
    const wait = opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const addBtn = () => doc.querySelector('[data-automation-id="add-button"]');
    let guard = 0;
    while (collectWorkExperienceBlocks(doc).length < entries.length && addBtn() && guard < 12) {
      guard++;
      const before = collectWorkExperienceBlocks(doc).length;
      addBtn().click();
      for (let t = 0; t < 20 && collectWorkExperienceBlocks(doc).length <= before; t++) {
        await wait(100);
      }
    }
    return fillWorkExperience(collectWorkExperienceBlocks(doc), entries, { wait });
  }

  // src/autofill.entry.js
  var ATS = detectAts(location.href);
  var BTN_ID = "je-autofill-btn";
  var REMEMBER_ID = "je-remember-btn";
  var PANEL_ID = "je-autofill-panel";
  var REVIEW_ID = "je-review-panel";
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
    today_date: "Today's date",
    resume_file: "R\xE9sum\xE9 (from your app)"
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
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== "runAutofill") return;
      if (window !== window.top && !hasFillableForm()) return;
      const btn = forceButton();
      run(btn).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
      return true;
    });
  } catch {
  }
  function hasFillableForm() {
    return collectFields(document).length + collectRadioGroups(document).length >= 2;
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
  function forceButton() {
    const existing = document.getElementById(BTN_ID);
    if (existing) return existing;
    injectStyles();
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = LABEL;
    btn.addEventListener("click", () => run(btn));
    document.body.appendChild(btn);
    return btn;
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
    values.today_date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const onWorkday = isWorkdayExperience(document);
    const notWork = (el2) => !onWorkday || !inWorkExperience(el2);
    let workFilled = [];
    if (onWorkday) {
      setState(btn, "busy", "\u{1F4C4} Reading your r\xE9sum\xE9\u2026");
      const wh = await safeSend({ type: "getWorkHistory" }).catch(() => null);
      const entries = wh?.entries || [];
      if (entries.length) {
        const r = await fillAllWorkExperience(document, entries);
        workFilled = r.details.map((d) => ({ label: d.label, value: d.value, source: "profile" }));
      }
    }
    const report = fillFields(collectFields(document).filter((f) => notWork(f.el)), values, resumeFile);
    const answers = res.customAnswers || [];
    const custom = fillCustomAnswers(
      collectUnmapped(document).filter((u) => notWork(u.el)),
      answers,
      matchAnswer
    );
    const radios = fillRadioGroups(
      collectRadioGroups(document).filter((g) => notWork(g.options[0]?.el)),
      values,
      answers,
      matchAnswer
    );
    const aiMap = async (fields) => {
      const res2 = await safeSend({ type: "aiMapFields", fields }).catch(() => null);
      return res2?.mappings || {};
    };
    const ddFilled = await fillWorkdayDropdowns(document, values, answers, { aiMap });
    for (const d of ddFilled) workFilled.push({ label: d.label, value: d.value, source: d.source || "profile" });
    const aiFilled = await aiPass(btn);
    const toAnswerList = [
      ...collectUnmapped(document).filter((u) => !(u.el.value || "").trim() && notWork(u.el)).map((u) => ({ label: u.questionText, el: u.el })),
      ...collectRadioGroups(document).filter((g) => !g.key && !g.options.some((o) => o.el.checked) && notWork(g.options[0]?.el)).map((g) => ({ label: g.question, el: g.options[0]?.el }))
    ];
    const fieldByKey = /* @__PURE__ */ new Map();
    for (const f of collectFields(document)) if (!fieldByKey.has(f.key)) fieldByKey.set(f.key, f.el);
    const groupByKey = /* @__PURE__ */ new Map();
    const groupByQKey = /* @__PURE__ */ new Map();
    for (const g of collectRadioGroups(document)) {
      if (g.key && !groupByKey.has(g.key)) groupByKey.set(g.key, g);
      if (g.questionKey && !groupByQKey.has(g.questionKey)) groupByQKey.set(g.questionKey, g);
    }
    const unmappedByKey = /* @__PURE__ */ new Map();
    for (const u of collectUnmapped(document)) if (!unmappedByKey.has(u.questionKey)) unmappedByKey.set(u.questionKey, u.el);
    const textInfo = (el2) => el2.tagName === "SELECT" ? { el: el2, kind: "select", options: [...el2.options].map((o) => o.text.trim()).filter(Boolean) } : { el: el2, kind: "text" };
    const radioInfo = (g) => ({
      el: g.options.find((o) => o.el.checked)?.el || g.options[0]?.el,
      kind: "radio",
      group: g.options,
      options: g.options.map((o) => o.label)
    });
    const fieldEntry = (k) => {
      const base = { label: LABELS[k] || k, value: displayValue(k, values, resumeFile), source: "profile" };
      if (k === "resume_file") return { ...base, el: fieldByKey.get(k), kind: "file" };
      const el2 = fieldByKey.get(k);
      return el2 ? { ...base, ...textInfo(el2) } : base;
    };
    const radioEntry = (k) => {
      const base = { label: LABELS[k] || k, value: displayValue(k, values, resumeFile), source: "profile" };
      const g = groupByKey.get(k);
      return g ? { ...base, ...radioInfo(g) } : base;
    };
    const learned = [
      ...custom.learned.map((l) => {
        const base = { label: l.questionText, value: String(l.value), source: "learned" };
        const el2 = unmappedByKey.get(l.questionKey);
        return el2 ? { ...base, ...textInfo(el2) } : base;
      }),
      ...radios.learned.map((l) => {
        const base = { label: l.questionText, value: String(l.value), source: "learned" };
        const g = groupByQKey.get(l.questionKey);
        return g ? { ...base, ...radioInfo(g) } : base;
      })
    ];
    const filledList = [
      ...report.filled.map(fieldEntry),
      ...radios.filled.map(radioEntry),
      ...workFilled
    ];
    const filled = filledList.length + learned.length + aiFilled.length;
    const toAnswer = toAnswerList.length;
    setState(
      btn,
      "done",
      toAnswer ? `\u2713 Filled ${filled} \xB7 ${toAnswer} to answer` : `\u2713 Filled ${filled} \u2014 review & submit`
    );
    ensureRememberButton(toAnswer > 0 || learned.length > 0 || aiFilled.length > 0);
    showAutofillPanel({
      filled: filledList,
      learned,
      ai: aiFilled,
      toAnswer: toAnswerList,
      missing: report.attention.filter((k) => k !== "resume_file" || !resumeFile).map((k) => ({ label: LABELS[k] || k }))
    });
  }
  async function aiPass(btn) {
    const targets = [];
    for (const u of collectUnmapped(document)) {
      if ((u.el.value || "").trim()) continue;
      if (inWorkExperience(u.el)) continue;
      const isSelect = u.el.tagName === "SELECT";
      targets.push({
        ref: u.el,
        kind: isSelect ? "select" : "text",
        id: "t" + targets.length,
        label: u.questionText,
        type: isSelect ? "select" : "text",
        options: isSelect ? [...u.el.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 60) : []
      });
    }
    for (const g of collectRadioGroups(document)) {
      if (g.key || g.options.some((o) => o.el.checked)) continue;
      if (inWorkExperience(g.options[0]?.el)) continue;
      targets.push({
        ref: g.options,
        kind: "radio",
        id: "r" + targets.length,
        label: g.question,
        type: "radio",
        options: g.options.map((o) => o.label).slice(0, 60)
      });
    }
    if (!targets.length) return [];
    setState(btn, "busy", "\u{1F916} AI mapping\u2026");
    const res = await safeSend({
      type: "aiMapFields",
      fields: targets.map((t) => ({ id: t.id, label: t.label, type: t.type, options: t.options }))
    }).catch(() => null);
    const mappings = res?.mappings || {};
    const done = [];
    for (const t of targets) {
      const v = mappings[t.id];
      if (v == null || v === "") continue;
      let ok = false;
      let entry = { label: t.label, value: String(v), source: "ai" };
      if (t.kind === "radio") {
        ok = setRadioValue(t.ref, v);
        if (ok) markFilled(t.ref.find((o) => o.el.checked)?.el, "ai");
        entry = { ...entry, kind: "radio", el: t.ref.find((o) => o.el.checked)?.el, group: t.ref, options: t.options };
      } else if (t.kind === "select") {
        ok = setSelectValue(t.ref, v);
        if (ok) markFilled(t.ref, "ai");
        entry = { ...entry, kind: "select", el: t.ref, options: t.options };
      } else {
        setNativeValue(t.ref, String(v));
        markFilled(t.ref, "ai");
        ok = true;
        entry = { ...entry, kind: "text", el: t.ref };
      }
      if (ok) done.push(entry);
    }
    return done;
  }
  function displayValue(key, values, resumeFile) {
    if (key === "resume_file") return resumeFile ? resumeFile.name || "attached" : "";
    const v = values[key];
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v ?? "");
  }
  function flashField(el2) {
    if (!el2) return;
    el2.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      el2.focus({ preventScroll: true });
    } catch {
    }
    el2.classList.add("je-flash");
    setTimeout(() => el2.classList.remove("je-flash"), 1600);
  }
  function el(tag, cls) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }
  function trunc(s, n = 42) {
    s = String(s ?? "");
    return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
  }
  function applyCorrection(it, newVal) {
    if (!it?.el) return false;
    if (it.kind === "radio") {
      if (!newVal) return false;
      const ok = setRadioValue(it.group, newVal);
      if (ok) markFilled(it.group.find((o) => o.el.checked)?.el, it.source || "profile");
      return ok;
    }
    if (it.kind === "select") {
      if (newVal === "") {
        it.el.selectedIndex = 0;
        it.el.dispatchEvent(new Event("change", { bubbles: true }));
        it.el.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      }
      const ok = setSelectValue(it.el, newVal);
      if (ok) markFilled(it.el, it.source || "profile");
      return ok;
    }
    setNativeValue(it.el, String(newVal));
    markFilled(it.el, it.source || "profile");
    return true;
  }
  function buildEditor(it, valSpan, fixBtn) {
    const box = el("div", "je-editor");
    let input;
    if (it.kind === "select" || it.kind === "radio") {
      input = el("select", "je-ed-input");
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "\u2014 choose \u2014";
      input.appendChild(blank);
      for (const opt of it.options || []) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (opt === it.value) o.selected = true;
        input.appendChild(o);
      }
    } else {
      input = el("input", "je-ed-input");
      input.type = "text";
      input.value = it.value || "";
    }
    const apply = el("button", "je-ed-apply");
    apply.type = "button";
    apply.textContent = "Apply";
    apply.addEventListener("click", () => {
      const nv = input.value;
      if (applyCorrection(it, nv)) {
        it.value = nv;
        valSpan.textContent = nv ? trunc(nv, 26) : "\u2014";
        flashField(it.el);
        apply.textContent = "\u2713 Applied";
        setTimeout(() => apply.textContent = "Apply", 1200);
      } else {
        apply.textContent = "no match";
        setTimeout(() => apply.textContent = "Apply", 1500);
      }
    });
    box.append(input, apply);
    if (it.kind === "text" || it.kind === "select") {
      const clr = el("button", "je-ed-clear");
      clr.type = "button";
      clr.textContent = "Clear";
      clr.addEventListener("click", () => {
        applyCorrection(it, "");
        it.value = "";
        valSpan.textContent = "\u2014";
        if (it.kind === "text") input.value = "";
        else input.selectedIndex = 0;
      });
      box.append(clr);
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        apply.click();
      }
    });
    return box;
  }
  function editableRow(it) {
    const row = el("div", "je-erow");
    const main = el("div", "je-erow-main");
    const lab = el("span", "je-erow-label");
    lab.textContent = trunc(it.label, 34);
    const val = el("em", "je-erow-val");
    val.textContent = it.value ? trunc(it.value, 26) : "\u2014";
    main.append(lab, val);
    const canEdit = it.el && it.kind && it.kind !== "file";
    if (it.el) {
      const acts = el("div", "je-erow-acts");
      const jump = el("button", "je-mini");
      jump.type = "button";
      jump.textContent = "\u21A7";
      jump.title = "Show this field on the page";
      jump.addEventListener("click", () => flashField(it.el));
      acts.appendChild(jump);
      if (canEdit) {
        const fix = el("button", "je-mini je-fix");
        fix.type = "button";
        fix.textContent = "\u270E Fix";
        let editor = null;
        fix.addEventListener("click", () => {
          if (editor) {
            editor.remove();
            editor = null;
            fix.textContent = "\u270E Fix";
            return;
          }
          editor = buildEditor(it, val, fix);
          row.appendChild(editor);
          fix.textContent = "Close";
          editor.querySelector(".je-ed-input")?.focus();
        });
        acts.appendChild(fix);
      }
      main.appendChild(acts);
      lab.style.cursor = "pointer";
      lab.title = "Show this field on the page";
      lab.addEventListener("click", () => flashField(it.el));
    }
    row.appendChild(main);
    return row;
  }
  function editableSection(body, title, items, cls) {
    if (!items.length) return;
    const sec = el("div", "je-sec");
    const h = el("div", "je-sec-h " + cls);
    h.textContent = `${title} (${items.length})`;
    sec.appendChild(h);
    for (const it of items) sec.appendChild(editableRow(it));
    body.appendChild(sec);
  }
  function jumpSection(body, title, items, cls) {
    if (!items.length) return;
    const sec = el("div", "je-sec");
    const h = el("div", "je-sec-h " + cls);
    h.textContent = `${title} (${items.length})`;
    sec.appendChild(h);
    for (const i of items) {
      const row = el("div", "je-row je-jump");
      const s = el("span");
      s.textContent = trunc(i.label);
      const hint = el("em", "je-jump-hint");
      hint.textContent = "jump \u2192";
      row.append(s, hint);
      row.addEventListener("click", () => flashField(i.el));
      sec.appendChild(row);
    }
    body.appendChild(sec);
  }
  function plainSection(body, title, items, cls) {
    if (!items.length) return;
    const sec = el("div", "je-sec");
    const h = el("div", "je-sec-h " + cls);
    h.textContent = `${title} (${items.length})`;
    sec.appendChild(h);
    for (const i of items) {
      const row = el("div", "je-row");
      const s = el("span");
      s.textContent = trunc(i.label);
      row.appendChild(s);
      sec.appendChild(row);
    }
    body.appendChild(sec);
  }
  function showAutofillPanel(data) {
    document.getElementById(PANEL_ID)?.remove();
    injectStyles();
    const totalFilled = data.filled.length + data.ai.length + data.learned.length;
    const panel = el("div");
    panel.id = PANEL_ID;
    const head = el("div", "je-p-head");
    head.innerHTML = "<b>Autofill summary</b>";
    const close = el("button", "je-p-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "\u2715";
    close.addEventListener("click", () => panel.remove());
    head.appendChild(close);
    panel.appendChild(head);
    const count = el("div", "je-p-count");
    count.innerHTML = `<span class="je-c-ok">\u2713 ${totalFilled} filled</span>` + (data.toAnswer.length ? `<span class="je-c-warn">${data.toAnswer.length} need you</span>` : "");
    panel.appendChild(count);
    const legend = el("div", "je-p-legend");
    legend.textContent = "\u{1F7E2} profile \xB7 \u{1F7E3} AI \xB7 \u{1F535} remembered \xB7 \u{1F7E0} only you";
    panel.appendChild(legend);
    const tip = el("div", "je-p-tip");
    tip.innerHTML = "Something wrong? Tap <b>\u270E Fix</b> on any row to correct it \u2014 the page updates instantly.";
    panel.appendChild(tip);
    const body = el("div", "je-p-body");
    panel.appendChild(body);
    if (data.missing.length && totalFilled <= 2) {
      const n = el("div", "je-p-nudge");
      n.innerHTML = "Most fields were skipped because your profile is nearly empty. Fill <b>Settings \u2192 Application Profile</b> once and far more will auto-fill next time.";
      body.appendChild(n);
    }
    editableSection(body, "Filled from your profile", data.filled, "ok");
    editableSection(body, "AI-mapped \u2014 double-check these", data.ai, "ai");
    editableSection(body, "Remembered from before", data.learned, "learn");
    jumpSection(body, "Only you can answer these \u2193 tap to jump", data.toAnswer, "warn");
    plainSection(body, "No data saved for these", data.missing, "muted");
    document.body.appendChild(panel);
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
  function rememberAnswers(rb) {
    const answers = [
      ...captureAnswers(collectUnmapped(document)),
      ...captureRadioAnswers(collectRadioGroups(document))
    ];
    if (!answers.length) {
      rb.dataset.state = "";
      rb.textContent = "Answer some questions first";
      setTimeout(() => rb.textContent = "\u{1F4BE} Remember my answers", 2500);
      return;
    }
    showRememberReview(answers, rb);
  }
  function showRememberReview(items, rb) {
    document.getElementById(REVIEW_ID)?.remove();
    injectStyles();
    const panel = document.createElement("div");
    panel.id = REVIEW_ID;
    const head = document.createElement("div");
    head.className = "je-p-head";
    head.innerHTML = "<b>Save these answers?</b>";
    const close = document.createElement("button");
    close.className = "je-p-close";
    close.type = "button";
    close.textContent = "\u2715";
    close.addEventListener("click", () => panel.remove());
    head.appendChild(close);
    panel.appendChild(head);
    const sub = document.createElement("div");
    sub.className = "je-p-legend";
    sub.textContent = "Uncheck anything you don't want stored. Edit an answer if needed.";
    panel.appendChild(sub);
    const body = document.createElement("div");
    body.className = "je-p-body";
    const rows = items.map((it) => {
      const row = document.createElement("div");
      row.className = "je-rv-row";
      const top = document.createElement("label");
      top.className = "je-rv-top";
      const keep = document.createElement("input");
      keep.type = "checkbox";
      keep.checked = true;
      const q = document.createElement("span");
      q.className = "je-rv-q";
      q.textContent = it.question_text;
      top.append(keep, q);
      const a = document.createElement("input");
      a.type = "text";
      a.className = "je-rv-a";
      a.value = it.answer;
      row.append(top, a);
      row._data = { it, keep, a };
      body.appendChild(row);
      return row;
    });
    panel.appendChild(body);
    const foot = document.createElement("div");
    foot.className = "je-rv-foot";
    const cancel = document.createElement("button");
    cancel.className = "je-rv-cancel";
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => panel.remove());
    const save = document.createElement("button");
    save.className = "je-rv-save";
    save.type = "button";
    save.textContent = "\u{1F4BE} Save";
    save.addEventListener("click", async () => {
      const chosen = rows.filter((r) => r._data.keep.checked).map((r) => ({
        question_key: r._data.it.question_key,
        question_text: r._data.it.question_text,
        answer: r._data.a.value.trim()
      })).filter((x) => x.answer);
      if (!chosen.length) {
        panel.remove();
        return;
      }
      save.disabled = true;
      save.textContent = "Saving\u2026";
      const res = await safeSend({ type: "saveCustomAnswers", answers: chosen }).catch(() => null);
      panel.remove();
      if (rb) {
        rb.dataset.state = res?.ok ? "done" : "error";
        rb.textContent = res?.ok ? `\u2713 Remembered ${res.saved}` : "Couldn't save";
        setTimeout(() => rb.remove(), 3e3);
      }
    });
    foot.append(cancel, save);
    panel.appendChild(foot);
    document.body.appendChild(panel);
  }
  function setState(el2, state, text) {
    el2.dataset.state = state;
    el2.textContent = text;
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
    /* Live source labels: color the outline by where the value came from. */
    .je-src-profile.je-autofilled { outline-color: #16a34a99 !important; }
    .je-src-learned.je-autofilled { outline-color: #2563eb99 !important; }
    .je-src-ai.je-autofilled { outline-color: #7c3aedcc !important; }
    /* Review-before-save panel */
    #${REVIEW_ID} {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
      width: 340px; max-height: 72vh; overflow: auto;
      background: #fff; color: #111827; border-radius: 12px;
      box-shadow: 0 12px 34px rgba(0,0,0,.3);
      font: 13px/1.45 system-ui, -apple-system, sans-serif;
    }
    @media (prefers-color-scheme: dark) { #${REVIEW_ID} { background: #1f2937; color: #f3f4f6; } }
    #${REVIEW_ID} .je-p-head {
      position: sticky; top: 0; display: flex; align-items: center;
      justify-content: space-between; padding: 10px 12px; background: inherit;
      border-bottom: 1px solid rgba(148,163,184,.3);
    }
    #${REVIEW_ID} .je-p-close { background: none; border: 0; cursor: pointer; color: inherit; font-size: 13px; }
    #${REVIEW_ID} .je-p-legend { padding: 6px 12px; font-size: 11px; color: #6b7280; }
    #${REVIEW_ID} .je-p-body { padding: 2px 12px; }
    #${REVIEW_ID} .je-rv-row { padding: 8px 0; border-bottom: 1px solid rgba(148,163,184,.18); }
    #${REVIEW_ID} .je-rv-top { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
    #${REVIEW_ID} .je-rv-q { font-weight: 600; font-size: 12px; }
    #${REVIEW_ID} .je-rv-a {
      width: 100%; margin-top: 6px; padding: 7px 9px; border: 1px solid #d1d5db;
      border-radius: 8px; font: inherit; background: transparent; color: inherit;
    }
    #${REVIEW_ID} .je-rv-foot {
      position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 8px;
      padding: 10px 12px; background: inherit; border-top: 1px solid rgba(148,163,184,.3);
    }
    #${REVIEW_ID} .je-rv-save { background: #16a34a; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
    #${REVIEW_ID} .je-rv-cancel { background: transparent; color: inherit; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
    #${PANEL_ID} {
      position: fixed; right: 20px; bottom: 112px; z-index: 2147483647;
      width: 320px; max-height: 62vh; overflow: auto;
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
    #${PANEL_ID} .je-p-count {
      display: flex; gap: 8px; padding: 8px 12px 4px; font-weight: 700; font-size: 15px;
    }
    #${PANEL_ID} .je-c-ok { color: #16a34a; }
    #${PANEL_ID} .je-c-warn { color: #d97706; }
    #${PANEL_ID} .je-p-legend {
      padding: 2px 12px 6px; font-size: 11px; color: #6b7280;
      border-bottom: 1px solid rgba(148,163,184,.2);
    }
    #${PANEL_ID} .je-jump { cursor: pointer; border-radius: 6px; }
    #${PANEL_ID} .je-jump:hover { background: rgba(217,119,6,.12); }
    #${PANEL_ID} .je-jump-hint { color: #d97706; font-style: normal; opacity: .85; }
    .je-flash { outline: 3px solid #f59e0b !important; outline-offset: 1px; border-radius: 4px; transition: outline .2s; }
    #${PANEL_ID} .je-p-nudge {
      margin: 8px 0; padding: 8px 10px; border-radius: 8px; font-size: 12px;
      background: rgba(124,58,237,.1); color: inherit;
    }
    #${PANEL_ID} .je-p-tip {
      margin: 6px 12px 2px; padding: 6px 9px; border-radius: 8px; font-size: 11.5px;
      background: rgba(37,99,235,.1); color: inherit;
    }
    #${PANEL_ID} .je-p-body { padding: 6px 12px 12px; }
    #${PANEL_ID} .je-sec-h {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .05em; margin: 10px 0 4px;
    }
    /* Editable filled rows */
    #${PANEL_ID} .je-erow { padding: 4px 0; border-bottom: 1px solid rgba(148,163,184,.15); }
    #${PANEL_ID} .je-erow-main { display: flex; align-items: center; gap: 8px; }
    #${PANEL_ID} .je-erow-label { flex: 0 0 auto; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${PANEL_ID} .je-erow-val {
      flex: 1 1 auto; color: #6b7280; font-style: normal; text-align: right;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
    }
    #${PANEL_ID} .je-erow-acts { flex: 0 0 auto; display: flex; gap: 4px; }
    #${PANEL_ID} .je-mini {
      border: 1px solid rgba(148,163,184,.4); background: transparent; color: inherit;
      border-radius: 6px; padding: 2px 6px; font-size: 11px; cursor: pointer; line-height: 1.4;
    }
    #${PANEL_ID} .je-mini:hover { background: rgba(148,163,184,.18); }
    #${PANEL_ID} .je-fix { color: #2563eb; border-color: rgba(37,99,235,.4); font-weight: 600; }
    #${PANEL_ID} .je-editor { display: flex; gap: 6px; margin: 6px 0 4px; flex-wrap: wrap; }
    #${PANEL_ID} .je-ed-input {
      flex: 1 1 140px; min-width: 120px; padding: 6px 8px; border: 1px solid #d1d5db;
      border-radius: 7px; font: inherit; background: #fff; color: #111827;
    }
    @media (prefers-color-scheme: dark) {
      #${PANEL_ID} .je-ed-input { background: #111827; color: #f3f4f6; border-color: #374151; }
    }
    #${PANEL_ID} .je-ed-apply {
      background: #16a34a; color: #fff; border: 0; border-radius: 7px;
      padding: 6px 12px; font-weight: 700; cursor: pointer;
    }
    #${PANEL_ID} .je-ed-clear {
      background: transparent; color: inherit; border: 1px solid #d1d5db;
      border-radius: 7px; padding: 6px 10px; cursor: pointer;
    }
    #${PANEL_ID} .je-sec-h.ok { color: #16a34a; }
    #${PANEL_ID} .je-sec-h.ai { color: #7c3aed; }
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
