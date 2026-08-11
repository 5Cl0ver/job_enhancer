// Content script for ATS application pages (Greenhouse / Lever).
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
} from "./autofill/mapper.js";
import {
  fillFields,
  buildValues,
  fillCustomAnswers,
  fillRadioGroups,
  captureAnswers,
  captureRadioAnswers,
} from "./autofill/fill.js";

const ATS = detectAts(location.href); // still used for submit auto-tracking
const BTN_ID = "je-autofill-btn";
const REMEMBER_ID = "je-remember-btn";
const PANEL_ID = "je-autofill-panel";
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
  resume_file: "Résumé",
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
  const report = fillFields(collectFields(document), values, resumeFile);

  // Learn-as-you-go: fill custom questions we've learned before, and count the
  // ones we still don't know (the user answers those, then hits Remember).
  const answers = res.customAnswers || [];
  const custom = fillCustomAnswers(collectUnmapped(document), answers, matchAnswer);
  // Yes/no radio questions (work eligibility, "previously applied?", etc.).
  const radios = fillRadioGroups(collectRadioGroups(document), values, answers, matchAnswer);

  const filled =
    report.filled.length + custom.learned.length + radios.filled.length + radios.learned.length;
  const toAnswer = custom.remaining.length + radios.remaining.length;
  const anyLearned = custom.learned.length + radios.learned.length;
  setState(
    btn,
    "done",
    toAnswer
      ? `✓ Filled ${filled} · ${toAnswer} to answer`
      : `✓ Filled ${filled} — review & submit`,
  );
  ensureRememberButton(toAnswer > 0 || anyLearned > 0);

  // The "what did it do?" popout — exactly what was filled, learned, and left.
  const val = (k) => ({ label: LABELS[k] || k, value: displayValue(k, values, resumeFile) });
  showAutofillPanel({
    filled: [...report.filled.map(val), ...radios.filled.map(val)],
    learned: [
      ...custom.learned.map((l) => ({ label: l.questionText, value: String(l.value) })),
      ...radios.learned.map((l) => ({ label: l.questionText, value: String(l.value) })),
    ],
    toAnswer: [
      ...custom.remaining.map((r) => ({ label: r.questionText })),
      ...radios.remaining.map((r) => ({ label: r.questionText })),
    ],
    missing: report.attention
      .filter((k) => k !== "resume_file" || !resumeFile)
      .map((k) => ({ label: LABELS[k] || k })),
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
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// A small, dismissible card that shows what autofill detected and did — filled
// fields (with values), learned answers, questions still needing you, and
// fields we could fill but have no data for.
function showAutofillPanel(data) {
  document.getElementById(PANEL_ID)?.remove();
  const trunc = (s) => (s.length > 42 ? s.slice(0, 41) + "…" : s);
  const section = (title, items, cls, withValue) => {
    if (!items.length) return "";
    const rows = items
      .map(
        (i) =>
          `<div class="je-row"><span>${esc(trunc(i.label))}</span>${
            withValue && i.value ? `<em>${esc(trunc(i.value))}</em>` : ""
          }</div>`,
      )
      .join("");
    return `<div class="je-sec"><div class="je-sec-h ${cls}">${title} (${items.length})</div>${rows}</div>`;
  };
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML =
    `<div class="je-p-head"><b>Autofill summary</b><button class="je-p-close" type="button" aria-label="Close">✕</button></div>` +
    `<div class="je-p-body">` +
    section("Filled", data.filled, "ok", true) +
    section("Learned", data.learned, "learn", true) +
    section("Answer these", data.toAnswer, "warn", false) +
    section("No data saved", data.missing, "muted", false) +
    `</div>`;
  document.body.appendChild(panel);
  panel.querySelector(".je-p-close").addEventListener("click", () => panel.remove());
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

async function rememberAnswers(rb) {
  rb.dataset.state = "busy";
  rb.textContent = "Saving…";
  const answers = [
    ...captureAnswers(collectUnmapped(document)),
    ...captureRadioAnswers(collectRadioGroups(document)),
  ];
  if (!answers.length) {
    rb.dataset.state = "";
    rb.textContent = "Answer some questions first";
    setTimeout(() => (rb.textContent = "💾 Remember my answers"), 2500);
    return;
  }
  const res = await safeSend({ type: "saveCustomAnswers", answers }).catch(() => null);
  if (res?.ok) {
    rb.dataset.state = "done";
    rb.textContent = `✓ Remembered ${res.saved} — reused next time`;
    setTimeout(() => rb.remove(), 3500);
  } else {
    rb.dataset.state = "error";
    rb.textContent = res?.error === "NOT_SIGNED_IN" ? "Sign in first" : "Couldn't save";
    setTimeout(() => {
      rb.dataset.state = "";
      rb.textContent = "💾 Remember my answers";
    }, 3000);
  }
}

function setState(el, state, text) {
  el.dataset.state = state;
  el.textContent = text;
}

// ---- auto-track: user submitted → move the saved job to Applied ----

function jobInfo() {
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
  document.addEventListener(
    "submit",
    () => {
      if (sent) return;
      sent = true;
      const job = jobInfo();
      if (!job.title) return;
      safeSend({ type: "markApplied", job }).catch(() => {});
      const btn = document.getElementById(BTN_ID);
      if (btn) setState(btn, "done", "✓ Tracked in Job Enhancer");
    },
    true, // capture — before the page's own handler navigates away
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
