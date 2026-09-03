// Content script for ATS application pages (Greenhouse / Lever / Workday; the
// universal passes also run on any other site with a form).
//
// Shows one floating "⚡ Autofill" button. Click → background fetches the
// profile vault + resume file → the tested fill engine writes them into the
// form (never overwriting, skipping essays) → button reports "Filled 9 · 2
// need you". We NEVER submit — the user reviews and submits themselves.
//
// Auto-track rides along: when the user submits, tell the backend so the
// matching saved job moves to Applied by itself.
import {
  detectAts,
  collectFields,
  collectUnmapped,
  collectRadioGroups,
  matchAnswer,
  normalizeQuestion,
} from "./autofill/mapper.js";
import {
  fillFields,
  buildValues,
  fillCustomAnswers,
  fillRadioGroups,
  captureAnswers,
  captureRadioAnswers,
  setNativeValue,
  setSelectValue,
  setRadioValue,
  markFilled,
} from "./autofill/fill.js";
import {
  isWorkdayExperience,
  fillAllWorkExperience,
  fillWorkdayDropdowns,
  captureWorkdayDropdowns,
  inWorkExperience,
} from "./autofill/workday.js";

const ATS = detectAts(location.href); // still used for submit auto-tracking
const BTN_ID = "je-autofill-btn";
const REMEMBER_ID = "je-remember-btn";
const PANEL_ID = "je-autofill-panel";
const REVIEW_ID = "je-review-panel";
const LABEL = "⚡ Autofill from Job Enhancer";

// Pretty names for the summary popout.
const LABELS = {
  first_name: "First name", last_name: "Last name", full_name: "Full name",
  email: "Email", phone: "Phone", address_line1: "Address line 1",
  address_line2: "Address line 2", city: "City", state: "State",
  postal_code: "Postal / ZIP", country: "Country", location: "Location",
  linkedin_url: "LinkedIn", github_url: "GitHub", portfolio_url: "Portfolio / website",
  authorized_to_work: "Work authorization", requires_sponsorship: "Needs sponsorship",
  willing_to_relocate: "Willing to relocate", desired_salary: "Desired salary",
  notice_period: "Notice period / start date", today_date: "Today's date",
  resume_file: "Résumé (from your app)",
};

// Universal: run on ANY page. The button only appears when the page actually
// has an application form (see hasFillableForm), so random sites stay clean.
if (document.body) {
  injectStyles();
  ensureButton();
  // Forms render/replace via JS — keep the button in sync, but DEBOUNCE so busy
  // pages (Amazon/Workday) don't thrash on every mutation.
  let _t;
  new MutationObserver(() => {
    clearTimeout(_t);
    _t = setTimeout(ensureButton, 500);
  }).observe(document.body, { childList: true, subtree: true });
  watchForSubmit();
}

// The side panel can trigger autofill directly — reliable even when the on-page
// button hasn't appeared (sparse pages). Only the frame with the form responds.
try {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "runAutofill") return;
    if (window !== window.top && !hasFillableForm()) return; // skip empty iframes
    const btn = forceButton();
    run(btn)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // keep the channel open for the async response
  });
} catch {
  /* no runtime (orphaned) */
}

function hasFillableForm() {
  // Count text/select fields AND radio groups, so question-only steps (e.g.
  // Amazon's "Work Eligibility") still show the button.
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

/** Create the button unconditionally (used by the panel-triggered autofill). */
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

// Orphan-safe messaging: after an extension update, this script's copy in an
// already-open tab loses chrome.runtime — never let that hang the button.
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
      setState(btn, "error", "↻ Refresh page — extension updated");
      return;
    }
  } catch {
    setState(btn, "error", "↻ Refresh page — extension updated");
    return;
  }
  setState(btn, "busy", "Filling…");

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
        type: res.resume.mime || "application/pdf",
      });
    } catch {
      /* corrupt transfer — fill everything else */
    }
  }

  const values = buildValues(res.profile, res.email);
  values.today_date = new Date().toISOString().slice(0, 10); // signature "date" fields → today

  // Workday "Work Experience" FIRST: fill each block from the résumé's STRUCTURED
  // history (title+employer+location+dates kept together per job). This section
  // is off-limits to the generic + AI passes below (see `notWork`) so they can't
  // mismatch fields or write a lone year — the filler owns it end to end.
  const onWorkday = isWorkdayExperience(document);
  const notWork = (el) => !onWorkday || !inWorkExperience(el);
  let workFilled = [];
  if (onWorkday) {
    setState(btn, "busy", "📄 Reading your résumé…");
    const wh = await safeSend({ type: "getWorkHistory" }).catch(() => null);
    const entries = wh?.entries || [];
    if (entries.length) {
      // Adds a block per job ("Add Another") then fills them all — async.
      const r = await fillAllWorkExperience(document, entries);
      workFilled = r.details.map((d) => ({ label: d.label, value: d.value, source: "profile" }));
    }
  }

  const report = fillFields(collectFields(document).filter((f) => notWork(f.el)), values, resumeFile);

  // Learn-as-you-go: fill custom questions we've learned before, and count the
  // ones we still don't know (the user answers those, then hits Remember).
  const answers = res.customAnswers || [];
  const custom = fillCustomAnswers(
    collectUnmapped(document).filter((u) => notWork(u.el)),
    answers,
    matchAnswer,
  );
  // Yes/no radio questions (work eligibility, "previously applied?", etc.).
  const radios = fillRadioGroups(
    collectRadioGroups(document).filter((g) => notWork(g.options[0]?.el)),
    values,
    answers,
    matchAnswer,
  );

  // Workday questionnaire dropdowns (custom listbox widgets the generic passes
  // can't see): profile Yes/No + learned answers first, then an AI FALLBACK that
  // reads the widget's own options and lets the grounded model pick — so new
  // questions don't need hand-mapping.
  // ONE batched AI call for ALL unknown dropdowns on the page (not per-dropdown).
  const aiMap = async (fields) => {
    const res = await safeSend({ type: "aiMapFields", fields }).catch(() => null);
    return res?.mappings || {};
  };
  const ddFilled = await fillWorkdayDropdowns(document, values, answers, { aiMap });
  for (const d of ddFilled) {
    const entry = { label: d.label, value: d.value, source: d.source || "profile" };
    // AI/remembered dropdown answers are learnable (profile Yes/No ones aren't) —
    // carry the key/text so the correction can be saved from the summary.
    if (d.source !== "profile" && d.questionKey) {
      entry.learnKey = d.questionKey;
      entry.learnText = d.question || d.label;
    }
    workFilled.push(entry);
  }

  // Usage insights: tell the backend which REMEMBERED answers we just reused, so
  // the Answer Library can show "used 4× · last used 3d ago". Fire-and-forget.
  const usedKeys = [
    ...custom.learned.map((l) => l.questionKey),
    ...radios.learned.map((l) => l.questionKey),
    ...ddFilled.filter((d) => d.source === "learned" && d.questionKey).map((d) => d.questionKey),
  ].filter(Boolean);
  if (usedKeys.length) {
    safeSend({ type: "markAnswersUsed", question_keys: usedKeys }).catch(() => {});
  }

  // AI pass: whatever the deterministic passes couldn't fill goes to a grounded
  // model that maps it from the user's data — this is what makes it work on ANY
  // site without per-field rules. Degrades gracefully (no AI → nothing changes).
  const aiFilled = await aiPass(btn);

  // Recompute what's genuinely left AFTER every pass, so counts are honest.
  // Work-experience fields are excluded — the résumé filler owns those.
  const toAnswerList = [
    ...collectUnmapped(document)
      .filter((u) => !(u.el.value || "").trim() && notWork(u.el))
      .map((u) => ({ label: u.questionText, el: u.el })),
    ...collectRadioGroups(document)
      .filter((g) => !g.key && !g.options.some((o) => o.el.checked) && notWork(g.options[0]?.el))
      .map((g) => ({ label: g.question, el: g.options[0]?.el })),
  ];

  // Re-index the live controls so each summary row can carry a reference to its
  // field — that's what powers the inline "✎ Fix" (re-apply a corrected value)
  // and jump-to-field. Cheap DOM walks; consistent with the passes above.
  const fieldByKey = new Map();
  for (const f of collectFields(document)) if (!fieldByKey.has(f.key)) fieldByKey.set(f.key, f.el);
  const groupByKey = new Map();
  const groupByQKey = new Map();
  for (const g of collectRadioGroups(document)) {
    if (g.key && !groupByKey.has(g.key)) groupByKey.set(g.key, g);
    if (g.questionKey && !groupByQKey.has(g.questionKey)) groupByQKey.set(g.questionKey, g);
  }
  const unmappedByKey = new Map();
  for (const u of collectUnmapped(document)) if (!unmappedByKey.has(u.questionKey)) unmappedByKey.set(u.questionKey, u.el);

  const textInfo = (el) =>
    el.tagName === "SELECT"
      ? { el, kind: "select", options: [...el.options].map((o) => o.text.trim()).filter(Boolean) }
      : { el, kind: "text" };
  const radioInfo = (g) => ({
    el: g.options.find((o) => o.el.checked)?.el || g.options[0]?.el,
    kind: "radio",
    group: g.options,
    options: g.options.map((o) => o.label),
  });

  const fieldEntry = (k) => {
    const base = { label: LABELS[k] || k, value: displayValue(k, values, resumeFile), source: "profile" };
    if (k === "resume_file") return { ...base, el: fieldByKey.get(k), kind: "file" };
    const el = fieldByKey.get(k);
    return el ? { ...base, ...textInfo(el) } : base;
  };
  const radioEntry = (k) => {
    const base = { label: LABELS[k] || k, value: displayValue(k, values, resumeFile), source: "profile" };
    const g = groupByKey.get(k);
    return g ? { ...base, ...radioInfo(g) } : base;
  };
  const learned = [
    ...custom.learned.map((l) => {
      const base = {
        label: l.questionText,
        value: String(l.value),
        source: "learned",
        learnKey: l.questionKey,
        learnText: l.questionText,
      };
      const el = unmappedByKey.get(l.questionKey);
      return el ? { ...base, ...textInfo(el) } : base;
    }),
    ...radios.learned.map((l) => {
      const base = {
        label: l.questionText,
        value: String(l.value),
        source: "learned",
        learnKey: l.questionKey,
        learnText: l.questionText,
      };
      const g = groupByQKey.get(l.questionKey);
      return g ? { ...base, ...radioInfo(g) } : base;
    }),
  ];
  const filledList = [
    ...report.filled.map(fieldEntry),
    ...radios.filled.map(radioEntry),
    ...workFilled,
  ];

  const filled = filledList.length + learned.length + aiFilled.length;
  const toAnswer = toAnswerList.length;
  setState(
    btn,
    "done",
    toAnswer
      ? `✓ Filled ${filled} · ${toAnswer} to answer`
      : `✓ Filled ${filled} — review & submit`,
  );
  ensureRememberButton(
    toAnswer > 0 || learned.length > 0 || aiFilled.length > 0 || ddFilled.length > 0,
  );

  showAutofillPanel({
    filled: filledList,
    learned,
    ai: aiFilled,
    toAnswer: toAnswerList,
    missing: report.attention
      .filter((k) => k !== "resume_file" || !resumeFile)
      .map((k) => ({ label: LABELS[k] || k })),
  });
}

// Send the still-unfilled fields to the AI mapper and apply what comes back.
async function aiPass(btn) {
  const targets = [];
  for (const u of collectUnmapped(document)) {
    if ((u.el.value || "").trim()) continue;
    if (inWorkExperience(u.el)) continue; // owned by the Workday résumé filler
    const isSelect = u.el.tagName === "SELECT";
    targets.push({
      ref: u.el,
      kind: isSelect ? "select" : "text",
      id: "t" + targets.length,
      label: u.questionText,
      type: isSelect ? "select" : "text",
      options: isSelect
        ? [...u.el.options].map((o) => o.text.trim()).filter(Boolean).slice(0, 60)
        : [],
    });
  }
  for (const g of collectRadioGroups(document)) {
    if (g.key || g.options.some((o) => o.el.checked)) continue;
    if (inWorkExperience(g.options[0]?.el)) continue; // owned by the Workday filler
    targets.push({
      ref: g.options,
      kind: "radio",
      id: "r" + targets.length,
      label: g.question,
      type: "radio",
      options: g.options.map((o) => o.label).slice(0, 60),
    });
  }
  if (!targets.length) return [];

  setState(btn, "busy", "🤖 AI mapping…");
  const res = await safeSend({
    type: "aiMapFields",
    fields: targets.map((t) => ({ id: t.id, label: t.label, type: t.type, options: t.options })),
  }).catch(() => null);
  const mappings = res?.mappings || {};

  const done = [];
  for (const t of targets) {
    const v = mappings[t.id];
    if (v == null || v === "") continue;
    let ok = false;
    // Every AI target came from an UNMAPPED (custom) question, so it's learnable:
    // carry the question key/text so a "✎ Fix" can remember the correction.
    let entry = {
      label: t.label,
      value: String(v),
      source: "ai",
      learnKey: normalizeQuestion(t.label),
      learnText: t.label,
    };
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

// A small, dismissible card that shows what autofill detected and did — filled
// fields (with values), learned answers, questions still needing you, and
// fields we could fill but have no data for.
function flashField(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* radios may not focus */
  }
  el.classList.add("je-flash");
  setTimeout(() => el.classList.remove("je-flash"), 1600);
}

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function trunc(s, n = 42) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Re-apply a corrected value to the actual page control. Returns whether it
// took (a select/radio "no match" is reported so the user can pick again).
function applyCorrection(it, newVal) {
  if (!it?.el) return false;
  if (it.kind === "radio") {
    if (!newVal) return false; // radios can't be un-checked back to "none"
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

// One editor drawer under a row: a text input (or a dropdown of the real
// options for selects/radios) + Apply, and Clear for free-text/selects.
function buildEditor(it, valSpan, fixBtn) {
  const box = el("div", "je-editor");
  let input;
  if (it.kind === "select" || it.kind === "radio") {
    input = el("select", "je-ed-input");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "— choose —";
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
    if (!applyCorrection(it, nv)) {
      apply.textContent = "no match";
      setTimeout(() => (apply.textContent = "Apply"), 1500);
      return;
    }
    it.value = nv;
    valSpan.textContent = nv ? trunc(nv, 26) : "—";
    flashField(it.el);
    // Phase 1 — close the learn loop: when the corrected field is a custom
    // question (AI-mapped or previously remembered), persist the fix so we
    // never get it wrong again. Profile fields have no learnKey → DOM-only.
    if (it.learnKey && nv.trim()) {
      apply.textContent = "Saving…";
      safeSend({
        type: "saveCustomAnswers",
        answers: [{ question_key: it.learnKey, question_text: it.learnText || it.label, answer: nv.trim() }],
      })
        .then(() => {
          it.source = "learned"; // it's now a remembered answer
          apply.textContent = "✓ Remembered";
        })
        .catch(() => {
          apply.textContent = "✓ Applied"; // fill worked; save didn't
        })
        .finally(() => setTimeout(() => (apply.textContent = "Apply"), 1600));
    } else {
      apply.textContent = "✓ Applied";
      setTimeout(() => (apply.textContent = "Apply"), 1200);
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
      valSpan.textContent = "—";
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

// A filled row that you can jump to AND correct in place.
function editableRow(it) {
  const row = el("div", "je-erow");
  const main = el("div", "je-erow-main");
  const lab = el("span", "je-erow-label");
  lab.textContent = trunc(it.label, 34);
  const val = el("em", "je-erow-val");
  val.textContent = it.value ? trunc(it.value, 26) : "—";
  main.append(lab, val);

  const canEdit = it.el && it.kind && it.kind !== "file";
  if (it.el) {
    const acts = el("div", "je-erow-acts");
    const jump = el("button", "je-mini");
    jump.type = "button";
    jump.textContent = "↧";
    jump.title = "Show this field on the page";
    jump.addEventListener("click", () => flashField(it.el));
    acts.appendChild(jump);
    if (canEdit) {
      const fix = el("button", "je-mini je-fix");
      fix.type = "button";
      fix.textContent = "✎ Fix";
      let editor = null;
      fix.addEventListener("click", () => {
        if (editor) {
          editor.remove();
          editor = null;
          fix.textContent = "✎ Fix";
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
    hint.textContent = "jump →";
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
  close.textContent = "✕";
  close.addEventListener("click", () => panel.remove());
  head.appendChild(close);
  panel.appendChild(head);

  const count = el("div", "je-p-count");
  count.innerHTML =
    `<span class="je-c-ok">✓ ${totalFilled} filled</span>` +
    (data.toAnswer.length ? `<span class="je-c-warn">${data.toAnswer.length} need you</span>` : "");
  panel.appendChild(count);

  const legend = el("div", "je-p-legend");
  legend.textContent = "🟢 profile · 🟣 AI · 🔵 remembered · 🟠 only you";
  panel.appendChild(legend);

  const tip = el("div", "je-p-tip");
  tip.innerHTML = "Something wrong? Tap <b>✎ Fix</b> on any row to correct it — the page updates instantly.";
  panel.appendChild(tip);

  const body = el("div", "je-p-body");
  panel.appendChild(body);

  if (data.missing.length && totalFilled <= 2) {
    const n = el("div", "je-p-nudge");
    n.innerHTML =
      "Most fields were skipped because your profile is nearly empty. Fill <b>Settings → Application Profile</b> once and far more will auto-fill next time.";
    body.appendChild(n);
  }

  editableSection(body, "Filled from your profile", data.filled, "ok");
  editableSection(body, "AI-mapped — double-check these", data.ai, "ai");
  editableSection(body, "Remembered from before", data.learned, "learn");
  jumpSection(body, "Only you can answer these ↓ tap to jump", data.toAnswer, "warn");
  plainSection(body, "No data saved for these", data.missing, "muted");

  document.body.appendChild(panel);
}

// A second button: capture the user's answers to unmapped questions so they
// auto-fill next time (learn-as-you-go). Sits above the Autofill button.
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
  rb.textContent = "💾 Remember my answers";
  rb.addEventListener("click", () => rememberAnswers(rb));
  document.body.appendChild(rb);
}

function rememberAnswers(rb) {
  // On Workday, the Work-Experience block is résumé data, not Q&A memory — keep
  // it out of the learned answers (its "Job Title"/"Company" inputs would
  // otherwise be captured as if they were application questions).
  const onWorkday = isWorkdayExperience(document);
  const notWork = (el) => !onWorkday || !inWorkExperience(el);
  const answers = [
    ...captureAnswers(collectUnmapped(document).filter((u) => notWork(u.el))),
    ...captureRadioAnswers(collectRadioGroups(document).filter((g) => notWork(g.options[0]?.el))),
    ...captureWorkdayDropdowns(document), // Workday questionnaire selections
  ];
  if (!answers.length) {
    rb.dataset.state = "";
    rb.textContent = "Answer some questions first";
    setTimeout(() => (rb.textContent = "💾 Remember my answers"), 2500);
    return;
  }
  showRememberReview(answers, rb); // let the user SEE + edit what gets saved
}

// Review-before-save: show exactly the Q&As about to be remembered, each with a
// keep toggle and an editable answer. Nothing is saved until the user confirms.
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
  close.textContent = "✕";
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
  save.textContent = "💾 Save";
  save.addEventListener("click", async () => {
    const chosen = rows
      .filter((r) => r._data.keep.checked)
      .map((r) => ({
        question_key: r._data.it.question_key,
        question_text: r._data.it.question_text,
        answer: r._data.a.value.trim(),
      }))
      .filter((x) => x.answer);
    if (!chosen.length) {
      panel.remove();
      return;
    }
    save.disabled = true;
    save.textContent = "Saving…";
    const res = await safeSend({ type: "saveCustomAnswers", answers: chosen }).catch(() => null);
    panel.remove();
    if (rb) {
      rb.dataset.state = res?.ok ? "done" : "error";
      rb.textContent = res?.ok ? `✓ Remembered ${res.saved}` : "Couldn't save";
      setTimeout(() => rb.remove(), 3000);
    }
  });
  foot.append(cancel, save);
  panel.appendChild(foot);
  document.body.appendChild(panel);
}

function setState(el, state, text) {
  el.dataset.state = state;
  el.textContent = text;
}

// ---- auto-track: user submitted → move the saved job to Applied ----

function jobInfo() {
  if (ATS === "workday") {
    // Workday: title from the posting header if present, else the tab title;
    // company from the tenant subdomain (acme.wd5.myworkdayjobs.com → "acme").
    const header =
      document.querySelector('[data-automation-id="jobPostingHeader"], h1')?.textContent?.trim() ||
      "";
    const sub = (location.hostname.split(".")[0] || "").trim();
    const company = sub && sub !== "www" ? sub.replace(/[-_]+/g, " ") : "";
    const title =
      header ||
      (document.title || "").split(/[|–-]/).map((s) => s.trim()).filter(Boolean).pop() ||
      "";
    return { title, company };
  }
  if (ATS === "greenhouse") {
    // "Job Application for <title> at <company>" in the tab title.
    const m = /job application for (.+) at (.+)/i.exec(document.title);
    return {
      title:
        document.querySelector(".app-title, h1")?.textContent?.trim() ||
        m?.[1] ||
        "",
      company:
        document
          .querySelector(".company-name")
          ?.textContent?.replace(/^\s*at\s+/i, "")
          .trim() ||
        m?.[2] ||
        "",
    };
  }
  // Lever tab title: "<Company> - <Title>".
  const [company, ...rest] = (document.title || "").split(" - ");
  return {
    title:
      document.querySelector(".posting-headline h2")?.textContent?.trim() ||
      rest.join(" - ").trim(),
    company: (company || "").trim(),
  };
}

function watchForSubmit() {
  let sent = false;
  const fire = () => {
    if (sent) return;
    const job = jobInfo();
    if (!job.title) return; // can't identify the job yet — try again next event
    sent = true;
    safeSend({ type: "markApplied", job }).catch(() => {});
    const btn = document.getElementById(BTN_ID);
    if (btn) setState(btn, "done", "✓ Tracked in Job Enhancer");
  };
  // Classic <form> submit (Greenhouse / Lever) — capture, before navigation.
  document.addEventListener("submit", fire, true);
  // Workday is an SPA: the final step is a "Submit" BUTTON click, not a form
  // submit. Match only the exact final button so "Save"/"Next" don't false-fire.
  if (ATS === "workday") {
    document.addEventListener(
      "click",
      (e) => {
        const b = e.target?.closest?.('button, [role="button"]');
        const label = (b?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (label === "submit") fire();
      },
      true,
    );
  }
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
