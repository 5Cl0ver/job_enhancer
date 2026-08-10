// Side panel — the apply copilot. It watches the ACTIVE TAB and adapts:
//   • applying on Indeed (smartapply)  → "mark applied when done" card
//   • applying on Greenhouse/Lever     → autofill reminder (auto-tracked)
//   • anywhere else                    → your saved jobs
// Plus an AI cover-letter writer for the job you're applying to — generate,
// copy, paste into the application. All API/auth work goes through the
// background service worker.
const cfg = self.JOB_ENHANCER_CONFIG;
const $ = (id) => document.getElementById(id);

function send(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg));
  } catch (e) {
    return Promise.reject(e);
  }
}

function show(view) {
  $("login-view").hidden = view !== "login";
  $("main-view").hidden = view !== "main";
}

let savedJobs = []; // [{id, job_listing_id, title, company, location, url, applied}]

// ---------------------------------------------------------------------------
// Saved jobs list
// ---------------------------------------------------------------------------

function renderSavedAll() {
  $("saved-all-count").textContent = savedJobs.length ? `(${savedJobs.length})` : "";
  const list = $("saved-all-list");
  list.innerHTML = "";
  if (!savedJobs.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No saved jobs yet — use Save on a job page.";
    list.append(li);
    return;
  }
  for (const j of savedJobs.slice(0, 50)) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = j.title || "Untitled";
    const s = document.createElement("span");
    s.textContent = [j.company, j.location].filter(Boolean).join(" · ");
    li.append(b, s);
    if (j.applied) {
      const done = document.createElement("span");
      done.className = "applied";
      done.textContent = "✓ Applied";
      li.append(done);
    } else {
      li.append(makeMarkAppliedButton(j, "Mark applied"));
    }
    if (j.url) {
      const a = document.createElement("a");
      a.className = "open";
      a.href = j.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "↗";
      a.title = "Open job";
      li.append(a);
    }
    list.append(li);
  }
}

function makeMarkAppliedButton(job, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mark-applied";
  btn.textContent = label;
  btn.title = "Moves this job to Applied in your tracker";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "…";
    const res = await send({
      type: "markApplied",
      job: { title: job.title, company: job.company },
    }).catch(() => null);
    if (res?.matched) {
      await loadSaved(); // re-renders list + context with ✓ Applied
    } else {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  return btn;
}

async function loadSaved() {
  const res = await send({ type: "listSaved" }).catch(() => null);
  // Session expired/wedged — bounce to sign-in instead of showing empty.
  if (res && res.signedIn === false) {
    show("login");
    return;
  }
  savedJobs = res?.jobs || [];
  renderSavedAll();
  populateJobSelect();
  renderContext(await detectContext());
}

// ---------------------------------------------------------------------------
// Context: what is the user doing in the active tab right now?
// ---------------------------------------------------------------------------

async function detectContext() {
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return { kind: "none" };
  }
  const url = tab?.url || "";
  const tabTitle = tab?.title || "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return { kind: "none" };
  }
  if (/smartapply\.indeed\.com$/i.test(host)) return { kind: "indeed-apply", tabTitle };
  if (/indeed\./i.test(host) && /\bapply\b/i.test(url)) return { kind: "indeed-apply", tabTitle };
  if (/greenhouse\.io$/i.test(host)) return { kind: "ats", ats: "Greenhouse", tabTitle };
  if (/(^|\.)lever\.co$/i.test(host)) return { kind: "ats", ats: "Lever", tabTitle };
  return { kind: "none" };
}

/** The saved job this tab is most likely about (title appears in tab title). */
function bestJobMatch(tabTitle) {
  const t = (tabTitle || "").toLowerCase();
  if (!t) return null;
  return (
    savedJobs.find((j) => j.title && t.includes(j.title.toLowerCase())) || null
  );
}

function renderContext(ctx) {
  const card = $("context-card");
  if (!ctx || ctx.kind === "none") {
    card.hidden = true;
    return;
  }
  const match = bestJobMatch(ctx.tabTitle);
  const actions = $("context-actions");
  actions.innerHTML = "";

  $("context-kicker").textContent =
    ctx.kind === "indeed-apply" ? "Applying on Indeed" : `Applying on ${ctx.ats}`;
  $("context-title").textContent = match ? match.title : "Application in progress";
  $("context-sub").textContent = match
    ? match.company
    : "Tip: save the job first so it can be tracked.";

  if (ctx.kind === "indeed-apply") {
    // Indeed's quick-apply widget hides the submit from us — one honest click.
    if (match?.applied) {
      const done = document.createElement("span");
      done.className = "done";
      done.textContent = "✓ Tracked as Applied";
      actions.append(done);
    } else if (match) {
      actions.append(makeMarkAppliedButton(match, "✓ I submitted — mark applied"));
    }
  } else {
    const note = document.createElement("span");
    note.textContent =
      "Use the purple ⚡ Autofill button on the page — submit is tracked automatically.";
    actions.append(note);
  }

  // Point the cover-letter tool at this job automatically.
  if (match?.job_listing_id) $("cl-job").value = match.job_listing_id;

  card.hidden = false;
}

async function refreshContext() {
  renderContext(await detectContext());
}

// ---------------------------------------------------------------------------
// AI cover letter
// ---------------------------------------------------------------------------

function populateJobSelect() {
  const sel = $("cl-job");
  const prev = sel.value;
  sel.innerHTML = "";
  if (!savedJobs.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Save a job first…";
    sel.append(opt);
    return;
  }
  for (const j of savedJobs) {
    if (!j.job_listing_id) continue;
    const opt = document.createElement("option");
    opt.value = j.job_listing_id;
    opt.textContent = [j.title, j.company].filter(Boolean).join(" — ");
    sel.append(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

let docType = "cover_letter"; // "cover_letter" | "resume"
let engine = "nvidia"; // "nvidia" | "claude"
let lastDocId = null;
let bridgePrompt = ""; // last prompt built for the "My Claude" flow
let bridgeResumeId = null;
let resumeFilename = ""; // the user's uploaded resume filename — names downloads

const CLAUDE_URL = "https://claude.ai/new";

// Where drafts open. Read the field live (robust even if the change event
// hasn't saved yet), then the saved value, then a normal Claude chat.
async function getClaudeUrl() {
  const field = ($("claude-url")?.value || "").trim();
  if (/^https?:\/\//i.test(field)) return field;
  const { je_claude_url } = await chrome.storage.local.get("je_claude_url");
  return je_claude_url && /^https?:\/\//i.test(je_claude_url) ? je_claude_url : CLAUDE_URL;
}

// Is a Claude tab already open in THIS window? (No side effects — doesn't switch.)
async function hasClaudeTab() {
  try {
    let winId;
    try {
      winId = (await chrome.windows.getCurrent()).id;
    } catch {
      /* ignore */
    }
    const q = { url: ["https://claude.ai/*", "https://*.claude.ai/*"] };
    if (winId != null) q.windowId = winId;
    const tabs = await chrome.tabs.query(q);
    return !!(tabs && tabs.length);
  } catch {
    return false;
  }
}

// Resume draft: ALWAYS land on your Claude project (the "correct" page). If a
// Claude tab is open we navigate it there (unless it's already on the project,
// then just focus it so we don't reload a chat). Returns focused/navigated/opened.
async function openClaudeProject() {
  const url = await getClaudeUrl();
  let winId;
  try {
    winId = (await chrome.windows.getCurrent()).id;
  } catch {
    /* ignore */
  }
  try {
    const q = { url: ["https://claude.ai/*", "https://*.claude.ai/*"] };
    if (winId != null) q.windowId = winId;
    const [existing] = await chrome.tabs.query(q);
    if (existing) {
      const base = url.split("?")[0].replace(/\/+$/, "");
      const here = (existing.url || "").replace(/\/+$/, "");
      if (here && here.startsWith(base)) {
        await chrome.tabs.update(existing.id, { active: true });
        return "focused";
      }
      await chrome.tabs.update(existing.id, { url, active: true });
      return "navigated";
    }
  } catch {
    /* fall through to a new tab */
  }
  await chrome.tabs.create(winId != null ? { url, windowId: winId } : { url });
  return "opened";
}

// Open/focus Claude in THIS window (used by the Open button + cover-letter's
// open-if-none case): reuse an open Claude tab, else open the project.
async function openClaudeForDraft() {
  let winId;
  try {
    winId = (await chrome.windows.getCurrent()).id;
  } catch {
    /* fall back to letting Chrome pick the window */
  }

  try {
    const q = { url: ["https://claude.ai/*", "https://*.claude.ai/*"] };
    if (winId != null) q.windowId = winId;
    const [existing] = await chrome.tabs.query(q);
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      return "focused";
    }
  } catch {
    /* couldn't query — fall through and open one */
  }

  const url = await getClaudeUrl();
  await chrome.tabs.create(winId != null ? { url, windowId: winId } : { url });
  return "opened";
}

// Employers/ATS see the uploaded filename, so name it professionally and
// consistently from the user's own resume file (e.g. "Fabian_Montufar_Resume.pdf"),
// not a generic "tailored-resume.pdf".
function downloadFilename() {
  let base = (resumeFilename || "").replace(/\.[^.]+$/, ""); // drop extension
  base = base.replace(/[\\/:*?"<>|]+/g, "").trim();
  const person = base.replace(/[_\-\s]*(resume|cv|c\.v\.)$/i, "").trim() || base;
  const label = docType === "resume" ? "Resume" : "Cover_Letter";
  if (person) return `${person.replace(/\s+/g, "_")}_${label}.pdf`;
  return docType === "resume" ? "Resume.pdf" : "Cover_Letter.pdf";
}

function generateLabel() {
  if (engine === "claude") return "✨ Draft with my Claude";
  return docType === "resume" ? "📄 Tailor my resume" : "✍️ Write cover letter";
}

function clearOutputs() {
  $("cl-output-wrap").hidden = true;
  $("cl-output").value = "";
  $("cl-paste-wrap").hidden = true;
  $("cl-paste").value = "";
  lastDocId = null;
  $("cl-status").textContent = "";
  $("cl-status").className = "status";
}

function setDocType(type) {
  docType = type;
  $("seg-cover").classList.toggle("on", type === "cover_letter");
  $("seg-resume").classList.toggle("on", type === "resume");
  $("cl-generate").textContent = generateLabel();
  // Output belongs to the previous type — clear so the two don't get confused.
  clearOutputs();
}

function setEngine(e) {
  engine = e;
  $("eng-nvidia").classList.toggle("on", e === "nvidia");
  $("eng-claude").classList.toggle("on", e === "claude");
  $("cl-generate").textContent = generateLabel();
  clearOutputs();
}

async function generateDoc() {
  if (engine === "claude") return draftWithClaude();

  const jobListingId = $("cl-job").value;
  const status = $("cl-status");
  const btn = $("cl-generate");
  if (!jobListingId) {
    status.textContent = "Save the job first, then I can write for it.";
    return;
  }
  btn.disabled = true;
  $("cl-regen").disabled = true;
  status.className = "status";
  status.textContent = "Writing with AI — about 15 seconds…";

  const res = await send({
    type: "generateDocument",
    job_listing_id: jobListingId,
    docType,
  }).catch(() => null);

  btn.disabled = false;
  $("cl-regen").disabled = false;
  if (res?.ok && res.content) {
    $("cl-output").value = res.content;
    lastDocId = res.docId || null;
    if (res.resumeFilename) resumeFilename = res.resumeFilename;
    $("cl-output-wrap").hidden = false;
    status.className = "status ok";
    status.textContent =
      docType === "resume"
        ? "Done — download the PDF to upload to the application."
        : "Done — copy it into the application.";
  } else if (res?.error === "NOT_SIGNED_IN") {
    show("login");
  } else if (res?.error === "NO_RESUME") {
    status.textContent = "Upload a resume in the app (AI Apply) first.";
  } else {
    status.textContent = res?.error || "Couldn't generate — try again.";
  }
}

// --- "My Claude" bridge: build the prompt, hand it to the user's own Claude,
// catch the answer they paste back, and save it like any other document. -------

async function draftWithClaude() {
  const jobListingId = $("cl-job").value;
  const status = $("cl-status");
  const btn = $("cl-generate");
  if (!jobListingId) {
    status.textContent = "Save the job first, then I can write for it.";
    return;
  }
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Building your prompt…";

  const res = await send({
    type: "buildPrompt",
    job_listing_id: jobListingId,
    docType,
  }).catch(() => null);

  btn.disabled = false;
  if (!res?.ok || !res.prompt) {
    if (res?.error === "NOT_SIGNED_IN") return show("login");
    if (res?.error === "NO_RESUME") {
      status.textContent = "Upload a resume in the app (AI Apply) first.";
      return;
    }
    status.textContent = res?.error || "Couldn't build the prompt — try again.";
    return;
  }

  bridgePrompt = res.prompt;
  bridgeResumeId = res.resumeId || null;
  if (res.resumeFilename) resumeFilename = res.resumeFilename;
  await navigator.clipboard.writeText(bridgePrompt).catch(() => {});

  // Resume: ALWAYS take you to your project page. Cover letter: DON'T switch
  // tabs — you're already in the chat, so just copy. (Only open Claude if none.)
  let how;
  if (docType === "resume") {
    how = await openClaudeProject();
  } else {
    how = (await hasClaudeTab()) ? "copied" : await openClaudeForDraft();
  }

  $("cl-output-wrap").hidden = true;
  $("cl-paste-wrap").hidden = false;
  status.className = "status ok";
  if (how === "copied") {
    status.textContent =
      "Copied! Paste it into the SAME Claude chat as your resume (Ctrl+V), then copy the reply below and Save.";
  } else if (how === "focused") {
    status.textContent =
      "Prompt copied → back in your Claude tab. Paste (Ctrl+V), then copy the reply below and Save.";
  } else {
    status.textContent =
      "Prompt copied → opened your Claude. Paste (Ctrl+V), then copy the reply below and Save — you'll get a formatted PDF.";
  }
}

async function saveBridgeResult() {
  const jobListingId = $("cl-job").value;
  const content = $("cl-paste").value.trim();
  const status = $("cl-status");
  const btn = $("cl-paste-save");
  if (!content) {
    status.className = "status";
    status.textContent = "Paste Claude's answer first, then Save.";
    return;
  }
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Saving…";

  const res = await send({
    type: "saveManualDocument",
    job_listing_id: jobListingId,
    docType,
    content,
    resume_id: bridgeResumeId,
  }).catch(() => null);

  btn.disabled = false;
  if (!res?.ok) {
    if (res?.error === "NOT_SIGNED_IN") return show("login");
    status.textContent = res?.error || "Couldn't save — try again.";
    return;
  }

  // Flow the pasted result into the normal output box so Copy/PDF just work.
  lastDocId = res.docId || null;
  $("cl-output").value = content;
  $("cl-paste-wrap").hidden = true;
  $("cl-paste").value = "";
  $("cl-output-wrap").hidden = false;
  status.className = "status ok";
  status.textContent =
    docType === "resume"
      ? "Saved — download the PDF to upload to the application."
      : "Saved — copy it into the application.";
}

async function downloadPdf() {
  if (!lastDocId) return;
  const btn = $("cl-pdf");
  btn.disabled = true;
  const res = await send({ type: "getDocumentPdf", docId: lastDocId }).catch(() => null);
  btn.disabled = false;
  if (!res?.ok || !res.b64) {
    $("cl-status").textContent = "Couldn't build the PDF — try again.";
    return;
  }
  const bytes = Uint8Array.from(atob(res.b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Save the job on ANY page. This runs in the page (injected), so it must be
// fully self-contained — no references to anything outside the function. It
// reads JSON-LD JobPosting first (Glassdoor, most company sites, many boards),
// then falls back to og-tags + headings + visible text (Lever, plain sites).
// ---------------------------------------------------------------------------

function extractJobFromPage() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const stripHtml = (html) => {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    div.querySelectorAll("style,script,noscript").forEach((e) => e.remove());
    return (div.innerText || div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  };
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
  const out = {
    url: location.href,
    title: "",
    company: "",
    location: "",
    description: "",
    is_remote: false,
    salary_min: null,
    salary_max: null,
    salary_period: null,
  };

  // 1) JSON-LD JobPosting — the gold standard when present.
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse(s.textContent);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : data["@graph"] || [data];
    for (const node of nodes) {
      const t = node && node["@type"];
      const types = Array.isArray(t) ? t : [t];
      if (!types.includes("JobPosting")) continue;
      out.title = clean(node.title) || out.title;
      const org = node.hiringOrganization;
      out.company = clean(typeof org === "string" ? org : org?.name) || out.company;
      const loc = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
      const addr = loc?.address;
      if (addr) {
        out.location =
          clean([addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ")) ||
          out.location;
      }
      if (String(node.jobLocationType || "").toUpperCase() === "TELECOMMUTE") out.is_remote = true;
      if (node.description) out.description = stripHtml(node.description);
      const bs = node.baseSalary?.value || node.baseSalary;
      if (bs && typeof bs === "object") {
        const min = Number(bs.minValue) || null;
        const max = Number(bs.maxValue) || null;
        const val = Number(bs.value) || null;
        out.salary_min = min || val || out.salary_min;
        out.salary_max = max || out.salary_max;
        const unit = String(bs.unitText || "").toUpperCase();
        if (unit === "HOUR") out.salary_period = "hourly";
        else if (unit === "YEAR" || unit === "MONTH") out.salary_period = "yearly";
      }
      if (out.title && out.company) break;
    }
    if (out.title && out.company) break;
  }

  // 2) og:title is often "Company - Title" (Lever, many boards).
  const ogTitle = clean(meta('meta[property="og:title"]'));
  if (ogTitle.includes(" - ")) {
    const idx = ogTitle.indexOf(" - ");
    if (!out.company) out.company = clean(ogTitle.slice(0, idx));
    if (!out.title) out.title = clean(ogTitle.slice(idx + 3));
  }

  // 3) Headings / site name fallbacks.
  if (!out.title)
    out.title =
      clean(document.querySelector("h1, .posting-headline h2, h2")?.innerText) ||
      ogTitle ||
      clean(document.title);
  if (!out.company) {
    const hn = location.hostname;
    if (/lever\.co$/.test(hn) || /greenhouse\.io$/.test(hn) || /ashbyhq\.com$/.test(hn)) {
      out.company = clean(location.pathname.split("/").filter(Boolean)[0]);
    }
    out.company =
      out.company ||
      clean(meta('meta[property="og:site_name"]')) ||
      clean(document.querySelector('[class*="company" i], [data-company]')?.innerText) ||
      clean(hn.replace(/^www\./, "").split(".")[0]);
  }

  // 4) Description fallback — the main content region.
  if (!out.description) {
    const main = document.querySelector(
      "[data-qa='job-description'], .posting-page, main, article, [class*='description' i], [class*='job' i]",
    );
    out.description = stripHtml(main?.innerHTML || document.body?.innerHTML || "").slice(0, 12000);
  }

  // 5) Remote + salary from visible text if still unknown.
  const bodyText = document.body?.innerText || "";
  if (/\bremote\b/i.test(out.title + " " + out.location + " " + bodyText.slice(0, 1500)))
    out.is_remote = true;
  if (!out.salary_min) {
    const m = bodyText.match(
      /\$\s?([\d,]{3,})(?:\s?(?:-|–|—|to)\s?\$?\s?([\d,]{3,}))?\s*(per hour|an hour|\/\s?hr|hourly|per year|a year|annually)?/i,
    );
    if (m) {
      const toN = (x) => (x ? Number(x.replace(/,/g, "")) : null);
      out.salary_min = toN(m[1]);
      out.salary_max = toN(m[2]);
      const p = (m[3] || "").toLowerCase();
      out.salary_period = /hour|hr/.test(p) ? "hourly" : /year|annual/.test(p) ? "yearly" : null;
    }
  }

  // If the user HIGHLIGHTED text on the page, trust that as the description —
  // the reliable escape hatch for sites we can't read structurally.
  const sel = (window.getSelection?.().toString() || "").trim();
  if (sel.length > 40) out.description = sel;
  return out;
}

let captureUrl = ""; // the page URL captured, sent with the reviewed save

// Read the page → prefill the review card (so unknown sites still work: you fix
// whatever we got wrong, then Save).
async function saveThisPage() {
  const status = $("save-page-status");
  const btn = $("save-page");
  status.className = "status";
  status.textContent = "Reading this page…";
  btn.disabled = true;
  $("capture-edit").hidden = true;

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    /* ignore */
  }
  if (!tab?.id) {
    btn.disabled = false;
    status.textContent = "Couldn't find the active tab.";
    return;
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobFromPage,
    });
  } catch {
    btn.disabled = false;
    status.textContent = "Can't read this page — open the job posting as a normal https page.";
    return;
  }

  const job = results?.[0]?.result;
  btn.disabled = false;
  if (!job) {
    status.textContent = "Couldn't read this page.";
    return;
  }

  // Prefill the editable card — the user reviews/fixes, then saves.
  captureUrl = job.url || tab.url || "";
  $("cap-title").value = job.title || "";
  $("cap-company").value = job.company || "";
  $("cap-location").value = job.location || "";
  $("cap-remote").checked = !!job.is_remote;
  $("cap-min").value = job.salary_min || "";
  $("cap-max").value = job.salary_max || "";
  $("cap-period").value = job.salary_period || "";
  $("cap-desc").value = job.description || "";
  $("capture-edit").hidden = false;
  status.className = "status";
  status.textContent =
    job.title && job.company
      ? "Review the details below, fix anything, then Save."
      : "Couldn't auto-read much — fill in the details below and Save.";
}

async function saveCapturedJob() {
  const status = $("save-page-status");
  const title = $("cap-title").value.trim();
  const company = $("cap-company").value.trim();
  if (!title || !company) {
    status.className = "status";
    status.textContent = "Add at least a title and company.";
    return;
  }
  const num = (id) => {
    const n = Number($(id).value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const job = {
    url: captureUrl || "https://job.capture",
    title,
    company,
    location: $("cap-location").value.trim() || "Not specified",
    is_remote: $("cap-remote").checked,
    description: $("cap-desc").value.trim() || null,
    salary_min: num("cap-min"),
    salary_max: num("cap-max"),
    salary_period: $("cap-period").value || null,
  };

  const btn = $("cap-save");
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Saving…";
  const res = await send({ type: "saveJob", job }).catch(() => null);
  btn.disabled = false;
  if (res?.ok) {
    status.className = "status ok";
    status.textContent = `✓ Saved: ${title} — ${company}`;
    $("capture-edit").hidden = true;
    loadSaved();
  } else if (res?.error === "Already in your tracker") {
    status.className = "status ok";
    status.textContent = "✓ Already saved";
    $("capture-edit").hidden = true;
    loadSaved();
  } else if (res?.error === "NOT_SIGNED_IN") {
    show("login");
  } else {
    status.textContent = res?.error || "Couldn't save — try again.";
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function refreshStatus() {
  const res = await send({ type: "authStatus" }).catch(() => null);
  const signedIn = !!res?.signedIn;
  show(signedIn ? "main" : "login");
  if (signedIn) loadSaved();
}

document.addEventListener("DOMContentLoaded", () => {
  refreshStatus();

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    const btn = e.submitter;
    btn.disabled = true;
    const res = await send({
      type: "login",
      email: $("l-email").value,
      password: $("l-password").value,
    }).catch(() => null);
    btn.disabled = false;
    if (res?.ok) refreshStatus();
    else $("login-error").textContent = res?.error || "Sign-in failed";
  });

  // Keep the list and the context card honest: refresh when the panel regains
  // focus, when the active tab changes, and on a gentle poll. Throttled.
  let lastRefresh = 0;
  const maybeRefresh = () => {
    if (document.hidden || $("main-view").hidden) return;
    const now = Date.now();
    if (now - lastRefresh < 4000) return;
    lastRefresh = now;
    loadSaved();
  };
  document.addEventListener("visibilitychange", maybeRefresh);
  window.addEventListener("focus", maybeRefresh);
  setInterval(maybeRefresh, 15000);
  // The context card should track tab switches quickly (it's cheap — no API).
  try {
    chrome.tabs.onActivated.addListener(refreshContext);
    chrome.tabs.onUpdated.addListener((_id, info) => {
      if (info.status === "complete" || info.title) refreshContext();
    });
  } catch {
    /* tabs events unavailable — the poll still covers it */
  }
  setInterval(refreshContext, 3000);

  $("seg-cover").addEventListener("click", () => setDocType("cover_letter"));
  $("seg-resume").addEventListener("click", () => setDocType("resume"));
  $("eng-nvidia").addEventListener("click", () => setEngine("nvidia"));
  $("eng-claude").addEventListener("click", () => setEngine("claude"));
  $("cl-generate").addEventListener("click", generateDoc);
  $("cl-regen").addEventListener("click", generateDoc);
  $("cl-paste-save").addEventListener("click", saveBridgeResult);
  $("cl-open-claude").addEventListener("click", () => openClaudeForDraft());
  $("save-page").addEventListener("click", saveThisPage);
  $("cap-save").addEventListener("click", saveCapturedJob);
  $("cap-cancel").addEventListener("click", () => {
    $("capture-edit").hidden = true;
    $("save-page-status").textContent = "";
  });

  // Claude Project link — remembered so new drafts open there.
  chrome.storage.local.get("je_claude_url").then(({ je_claude_url }) => {
    if (je_claude_url) $("claude-url").value = je_claude_url;
  });
  $("claude-url").addEventListener("input", (e) => {
    chrome.storage.local.set({ je_claude_url: e.target.value.trim() });
  });
  $("cl-copy-prompt").addEventListener("click", async () => {
    if (!bridgePrompt) return;
    await navigator.clipboard.writeText(bridgePrompt).catch(() => {});
    const btn = $("cl-copy-prompt");
    btn.textContent = "✓ Copied";
    setTimeout(() => (btn.textContent = "📋 Copy prompt again"), 2000);
  });
  $("cl-pdf").addEventListener("click", downloadPdf);
  $("cl-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("cl-output").value).catch(() => {});
    const btn = $("cl-copy");
    btn.textContent = "✓ Copied";
    setTimeout(() => (btn.textContent = "📋 Copy"), 2000);
  });

  $("open-app").addEventListener("click", () =>
    chrome.tabs.create({ url: `${cfg.APP_URL}/saved` }),
  );
  $("signout").addEventListener("click", async () => {
    await send({ type: "signOut" }).catch(() => {});
    show("login");
  });

  // Build version — must match the manifest after every extension reload.
  $("je-version").textContent = `v${chrome.runtime.getManifest().version}`;
});

// The on-page green "Save" button saves via the background, which pings us.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "jobSaved") loadSaved();
});
