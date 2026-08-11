// Fill engine — writes vault values into ATS form controls so the page's own
// framework (React etc.) actually REGISTERS them. Pure-ish (DOM only, no
// chrome.*) so it runs under vitest with happy-dom.

/**
 * The two-brains fix: set the value through the NATIVE setter, then dispatch
 * the events a keystroke would fire. React intercepts assignments to
 * el.value, so a plain `el.value = x` paints the screen without updating
 * React's state — and the form submits empty. Simulate typing instead.
 */
export function setNativeValue(el, value) {
  const proto =
    el.tagName === "TEXTAREA"
      ? globalThis.HTMLTextAreaElement?.prototype
      : globalThis.HTMLInputElement?.prototype;
  const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  // CRITICAL: many forms only mark a field "touched"/valid on blur, so
  // Save/Continue reports it empty even though the value is visibly there.
  // Fire blur + focusout (React listens for focusout) so validation runs.
  el.dispatchEvent(new Event("blur", { bubbles: true }));
  el.dispatchEvent(new Event("focusout", { bubbles: true }));
}

/** Pick the <select> option matching the wanted text ("Yes"/"No"/a state…). */
export function setSelectValue(el, wanted) {
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

/** Attach a File to a file input via DataTransfer (the drag-and-drop path —
 *  the one way scripts may hand a file input data they legitimately hold). */
export function attachFile(el, file) {
  if (typeof DataTransfer === "undefined") return false; // not in this env
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

const HIGHLIGHT = "je-autofilled";

/** Values a bool key should type/select. */
function boolAnswer(v) {
  return v === true ? "Yes" : v === false ? "No" : null;
}

/**
 * Fill every mapped field from the vault. Never overwrites anything the user
 * (or the page) already put there; reports exactly what happened.
 * @param {Array<{el: Element, key: string}>} fields  from collectFields()
 * @param {object} values  vault values keyed by mapper keys
 * @param {File|null} resumeFile
 * @returns {{filled: string[], attention: string[]}}
 */
export function fillFields(fields, values, resumeFile) {
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
    if (typeof value === "boolean" || key === "authorized_to_work" ||
        key === "requires_sponsorship" || key === "willing_to_relocate") {
      value = boolAnswer(values[key]);
    }
    if (value == null || value === "") {
      attention.push(key); // vault has no answer — leave it visibly untouched
      continue;
    }

    if (el.tagName === "SELECT") {
      if (setSelectValue(el, value)) {
        el.classList.add(HIGHLIGHT);
        filled.push(key);
      } else {
        attention.push(key); // no matching option — human judgment needed
      }
      continue;
    }

    // Respect anything already typed — autofill assists, never clobbers.
    if ((el.value || "").trim()) continue;

    setNativeValue(el, String(value));
    el.classList.add(HIGHLIGHT);
    filled.push(key);
  }

  return { filled, attention };
}

/**
 * Fill custom questions from LEARNED answers (the learn-as-you-go memory).
 * Never overwrites what's already there. `matchFn(questionKey, answers)` is the
 * mapper's matcher (passed in to avoid a circular import).
 * @returns {{learned: string[], remaining: Array<{questionText, questionKey}>}}
 */
export function fillCustomAnswers(unmapped, answers, matchFn) {
  const learned = [];
  const remaining = [];
  for (const { el, questionText, questionKey } of unmapped) {
    if ((el.value || "").trim()) continue; // respect the user's input
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

/**
 * Capture the user's OWN answers to unmapped questions, to remember them.
 * Only fields that actually have a value are returned.
 * @returns {Array<{question_key, question_text, answer}>}
 */
export function captureAnswers(unmapped) {
  const out = [];
  for (const { el, questionText, questionKey } of unmapped) {
    let answer = "";
    if (el.tagName === "SELECT") {
      const opt = el.options?.[el.selectedIndex];
      answer = (opt?.textContent || opt?.value || "").trim();
    } else {
      answer = (el.value || "").trim();
    }
    if (!answer || answer.length > 2000) continue;
    out.push({
      question_key: questionKey,
      question_text: questionText.slice(0, 500),
      answer,
    });
  }
  return out;
}

/** The vault → mapper-key value table (adds derived keys like full_name). */
export function buildValues(profile, email) {
  const p = profile || {};
  const fullName = [p.first_name, p.last_name].filter(Boolean).join(" ");
  const location = [p.city, p.state].filter(Boolean).join(", ");
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
    location: location || null,
    linkedin_url: p.linkedin_url,
    github_url: p.github_url,
    portfolio_url: p.portfolio_url,
    authorized_to_work: p.authorized_to_work,
    requires_sponsorship: p.requires_sponsorship,
    willing_to_relocate: p.willing_to_relocate,
    desired_salary: p.desired_salary,
    notice_period: p.notice_period,
  };
}
