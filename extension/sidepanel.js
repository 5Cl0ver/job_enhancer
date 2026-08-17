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
// Local duplicate detection — warn before saving a job you already have.
// The backend also dedupes, but this catches near-identical saves up front so
// the user isn't surprised by a silent "already saved". Heuristic: same company
// AND same-or-contained title (normalized).
// ---------------------------------------------------------------------------
function normJob(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findDuplicate(job) {
  const t = normJob(job.title);
  const c = normJob(job.company);
  if (!t || !c) return null;
  return (
    savedJobs.find((j) => {
      if (normJob(j.company) !== c) return false; // must be the same company
      const jt = normJob(j.title);
      return jt === t || jt.includes(t) || t.includes(jt); // same/contained title
    }) || null
  );
}

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
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname;
  } catch {
    return { kind: "none" };
  }
  // Indeed "My jobs" board — a whole list of applications to sync.
  if (/(^|\.)myjobs\.indeed\.com$/i.test(host) || (/indeed\./i.test(host) && /\/myjobs/.test(path)))
    return { kind: "indeed-myjobs", tabTitle };
  if (/smartapply\.indeed\.com$/i.test(host)) return { kind: "indeed-apply", tabTitle };
  if (/indeed\./i.test(host) && /\bapply\b/i.test(url)) return { kind: "indeed-apply", tabTitle };
  if (/greenhouse\.io$/i.test(host)) return { kind: "ats", ats: "Greenhouse", tabTitle };
  if (/(^|\.)lever\.co$/i.test(host)) return { kind: "ats", ats: "Lever", tabTitle };
  // ANY other site whose URL path is an application form — Amazon Jobs,
  // Workday, iCIMS, company careers pages. Path-based (not the query string or
  // hostname) so job LISTINGS don't false-trigger "you're applying".
  if (/\b(apply|application)/i.test(path)) return { kind: "ats", ats: siteLabel(host), tabTitle };
  return { kind: "none" };
}

/** A friendly site name from a host, e.g. "www.amazon.jobs" → "Amazon". */
function siteLabel(host) {
  const skip = new Set(["www", "jobs", "careers", "career", "boards", "job-boards", "apply", "account", "my"]);
  const name = host
    .replace(/^www\./, "")
    .split(".")
    .find((p) => !skip.has(p) && p.length > 1) || host;
  return name.charAt(0).toUpperCase() + name.slice(1);
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
  // The Indeed "My jobs" board gets its own dedicated sync section (below the
  // context card), shown only there.
  const onMyJobs = !!ctx && ctx.kind === "indeed-myjobs";
  const syncWrap = $("sync-wrap");
  if (syncWrap) syncWrap.hidden = !onMyJobs;
  if (onMyJobs) {
    card.hidden = true;
    return;
  }
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
    // A panel trigger that works even when the on-page button doesn't show (e.g.
    // steps with no form fields). Fills the current step + attaches a staged
    // tailored résumé to any file field present.
    const fill = document.createElement("button");
    fill.className = "mark-applied";
    fill.textContent = "⚡ Autofill this step";
    fill.addEventListener("click", () => autofillActiveTab(fill));
    actions.append(fill);
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
    const autoTracked = ctx.ats === "Greenhouse" || ctx.ats === "Lever";
    // A reliable trigger that doesn't depend on the on-page button appearing.
    const fill = document.createElement("button");
    fill.className = "mark-applied";
    fill.textContent = "⚡ Autofill this page";
    fill.addEventListener("click", () => autofillActiveTab(fill));
    actions.append(fill);
    const note = document.createElement("span");
    note.textContent = autoTracked
      ? "Use the purple ⚡ Autofill button on the page — submit is tracked automatically."
      : "Use the purple ⚡ Autofill button on the page to fill it fast.";
    actions.append(note);
    // On sites we can't auto-track (Amazon, company forms), offer one click.
    if (!autoTracked) {
      if (match?.applied) {
        const done = document.createElement("span");
        done.className = "done";
        done.textContent = "✓ Tracked as Applied";
        actions.append(done);
      } else if (match) {
        actions.append(makeMarkAppliedButton(match, "✓ I submitted — mark applied"));
      }
    }
  }

  // Point the cover-letter tool at this job automatically.
  if (match?.job_listing_id) $("cl-job").value = match.job_listing_id;

  card.hidden = false;
}

async function refreshContext() {
  renderContext(await detectContext());
}

// Trigger the on-page autofill from the panel (works even if the on-page button
// never appeared). Messages the content script running in the active tab.
async function autofillActiveTab(btn) {
  btn.disabled = true;
  btn.textContent = "Filling…";
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    /* ignore */
  }
  const res = tab?.id
    ? await chrome.tabs.sendMessage(tab.id, { type: "runAutofill" }).catch(() => null)
    : null;
  btn.disabled = false;
  btn.textContent = res?.ok ? "✓ Filled — check the page" : "⚡ Autofill this page";
  setTimeout(() => {
    if (btn) btn.textContent = "⚡ Autofill this page";
  }, 4000);
}

// ---------------------------------------------------------------------------
// Indeed "My jobs" → sync applications into the tracker
// ---------------------------------------------------------------------------

const SYNC_STAGE_OPTIONS = [
  "Interested",
  "Referral Sent",
  "Applied",
  "Phone Screen",
  "Take-Home Assignment",
  "Interview",
  "Offer",
  "Rejected",
];

// Ask the content script in the active tab to read the My-jobs list. This is
// the reliable path — the request comes from the panel, so Indeed's page can't
// swallow it the way it swallowed the on-page button.
async function readMyJobsFromTab() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return null;
  }
  if (!tab?.id) return null;
  return chrome.tabs.sendMessage(tab.id, { type: "readApplications" }).catch(() => null);
}

async function readIndeedApplications() {
  const btn = $("sync-read");
  const status = $("sync-status");
  btn.disabled = true;
  btn.textContent = "Reading the page…";
  status.textContent = "";
  status.className = "status";
  const res = await readMyJobsFromTab();
  btn.disabled = false;
  btn.textContent = "🔄 Read my Indeed applications";
  if (!res) {
    status.textContent =
      "Couldn't reach the Indeed tab. Make sure the My-jobs tab is open and active, then refresh it.";
    return;
  }
  if (!res.ok || !res.applications || !res.applications.length) {
    status.textContent =
      "No applications found. Open Indeed → My jobs → the Applied tab, then try again.";
    return;
  }
  renderSyncReview(res.applications);
}

function renderSyncReview(apps) {
  $("sync-result").hidden = true;
  $("sync-result").innerHTML = "";
  $("sync-review").hidden = false;
  $("sync-count").textContent = `(${apps.length})`;
  const list = $("sync-list");
  list.innerHTML = "";
  for (const app of apps) {
    const li = document.createElement("li");

    const top = document.createElement("label");
    top.className = "row-top";
    const keep = document.createElement("input");
    keep.type = "checkbox";
    keep.checked = true;
    const meta = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = app.title;
    const s = document.createElement("span");
    s.textContent = [app.company, app.location].filter(Boolean).join(" · ");
    meta.append(b, s);
    top.append(keep, meta);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = app.status || "Applied";

    const sel = document.createElement("select");
    for (const st of SYNC_STAGE_OPTIONS) {
      const o = document.createElement("option");
      o.value = st;
      o.textContent = st;
      if (st === app.stage) o.selected = true;
      sel.append(o);
    }

    li.append(top, badge, sel);
    li._app = app;
    li._keep = keep;
    li._sel = sel;
    list.append(li);
  }
  const relabel = () => {
    const n = [...list.children].filter((li) => li._keep.checked).length;
    $("sync-confirm").textContent = `Sync ${n}`;
  };
  list.addEventListener("change", relabel);
  relabel();
}

async function doSync() {
  const list = $("sync-list");
  const items = [...list.children]
    .filter((li) => li._keep.checked)
    .map((li) => ({
      title: li._app.title,
      company: li._app.company,
      location: li._app.location || "Not specified",
      url: li._app.url || undefined,
      stage: li._sel.value,
    }));
  const status = $("sync-status");
  status.className = "status";
  if (!items.length) {
    status.textContent = "Nothing selected — check at least one.";
    return;
  }
  const btn = $("sync-confirm");
  btn.disabled = true;
  btn.textContent = "Syncing…";
  const res = await send({ type: "syncApplications", applications: items }).catch(() => null);
  btn.disabled = false;
  btn.textContent = `Sync ${items.length}`;
  if (!res || !res.ok) {
    status.textContent =
      res?.error === "NOT_SIGNED_IN"
        ? "Sign in first (top of this panel), then Sync again."
        : `Couldn't sync: ${res?.error || "unknown error"}`;
    return;
  }
  showSyncResultPanel(res);
  loadSaved(); // reflect the new/updated jobs in "Your saved jobs"
}

function showSyncResultPanel(res) {
  $("sync-review").hidden = true;
  $("sync-status").textContent = "";
  const box = $("sync-result");
  box.hidden = false;
  box.innerHTML = "";

  const head = document.createElement("p");
  head.className = "status ok";
  const skipped = res.skipped ? ` · ${res.skipped} skipped` : "";
  head.textContent = `✓ ${res.updated || 0} updated · ${res.imported || 0} imported${skipped}`;
  box.append(head);

  const groups = [
    ["Updated (already tracked)", "updated"],
    ["Imported (new to your tracker)", "imported"],
    ["Skipped", "skipped"],
  ];
  const outcomes = Array.isArray(res.outcomes) ? res.outcomes : [];
  for (const [label, action] of groups) {
    const items = outcomes.filter((o) => o.action === action);
    if (!items.length) continue;
    const g = document.createElement("div");
    g.className = "rgroup";
    const h = document.createElement("div");
    h.className = "rhead";
    h.textContent = `${label} (${items.length})`;
    g.append(h);
    for (const o of items) {
      const r = document.createElement("div");
      r.className = "rrow";
      r.textContent =
        `${o.title} — ${o.company}` + (action === "skipped" ? "" : ` → ${o.stage}`);
      g.append(r);
    }
    box.append(g);
  }
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
  // With "My Claude", the paste box is available IMMEDIATELY — if you already
  // have Claude's reply you can paste it and Save without clicking Draft first.
  $("cl-paste-wrap").hidden = e !== "claude";
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
    if (docType === "resume") {
      await stageResumeForUpload(lastDocId, downloadFilename());
      await openPdfPreview(lastDocId);
      status.textContent = "Done ✓ Opened it to preview — it'll auto-upload on your next ⚡ Autofill.";
    } else {
      status.textContent = "Done — copy it into the application.";
    }
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
  await copyText(bridgePrompt);

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
  if (docType === "resume") {
    await stageResumeForUpload(lastDocId, downloadFilename());
    await openPdfPreview(lastDocId);
    status.textContent = "Saved ✓ Opened it to preview — it'll auto-upload on your next ⚡ Autofill.";
  } else {
    status.textContent = "Saved — copy it into the application (button below).";
  }
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

// Robust clipboard copy: the panel can lose focus (e.g. right after opening a
// Claude tab), which makes navigator.clipboard silently fail — fall back to a
// temp textarea + execCommand so Copy always works.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// Stage a tailored résumé so the NEXT ⚡ Autofill uploads it straight into the
// application's file field — no download, no picker. Stored independently of the
// cover-letter flow, so drafting a cover letter never wipes it.
async function stageResumeForUpload(docId, filename) {
  if (!docId) return;
  await chrome.storage.local.set({ je_staged_resume: { docId, filename } });
  renderStagedResume(filename);
}

// Open the generated PDF in a tab so the user can eyeball it (instead of
// downloading it into an ever-growing Downloads folder).
async function openPdfPreview(docId) {
  const res = await send({ type: "getDocumentPdf", docId }).catch(() => null);
  if (!res?.ok || !res.b64) return false;
  const bytes = Uint8Array.from(atob(res.b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  chrome.tabs.create({ url }).catch(() => {});
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

async function clearStagedResume() {
  await chrome.storage.local.remove("je_staged_resume");
  renderStagedResume(null);
}

function renderStagedResume(filename) {
  const el = $("staged-resume");
  if (!el) return;
  el.hidden = !filename;
  if (filename) $("staged-resume-name").textContent = filename;
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
  const dup = findDuplicate({ title: job.title, company: job.company });
  if (dup) {
    status.textContent = `⚠ You already saved "${dup.title} — ${dup.company}". You can still save a duplicate below.`;
  } else {
    status.textContent =
      job.title && job.company
        ? "Review the details below, fix anything, then Save."
        : "Couldn't auto-read much — fill in the details below and Save.";
  }
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

  // Warn before saving a job that's already in the list (same company +
  // same/contained title). The user can still choose to save a duplicate.
  const dup = findDuplicate(job);
  if (dup) {
    const ok = window.confirm(
      `You already saved "${dup.title} — ${dup.company}".\n\n` +
        `Save it again as a duplicate?`,
    );
    if (!ok) {
      status.className = "status";
      status.textContent = "Okay — kept the one you already have.";
      return;
    }
  }

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

// Keep the Claude Project link in step with the account (the web app reads the
// same value). If the account has one, use it. If it doesn't but this extension
// already had a link saved locally (set before sync existed), push that link UP
// to the account — a one-time migration so the web app finally sees it.
async function syncClaudeUrl() {
  const r = await send({ type: "getClaudeProjectUrl" }).catch(() => null);
  const backendUrl = r?.ok && typeof r.url === "string" ? r.url : "";
  const { je_claude_url } = await chrome.storage.local.get("je_claude_url");
  const local = (je_claude_url || "").trim();

  if (backendUrl) {
    $("claude-url").value = backendUrl;
    chrome.storage.local.set({ je_claude_url: backendUrl });
  } else if (local && /^https?:\/\//i.test(local)) {
    $("claude-url").value = local;
    send({ type: "saveClaudeProjectUrl", url: local }).catch(() => {});
  }
}

async function refreshStatus() {
  const res = await send({ type: "authStatus" }).catch(() => null);
  const signedIn = !!res?.signedIn;
  show(signedIn ? "main" : "login");
  if (signedIn) {
    loadSaved();
    syncClaudeUrl();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  refreshStatus();
  // Reflect any tailored résumé already staged for upload.
  chrome.storage.local
    .get("je_staged_resume")
    .then(({ je_staged_resume }) => renderStagedResume(je_staged_resume?.filename || null));

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
  $("sync-read").addEventListener("click", readIndeedApplications);
  $("sync-confirm").addEventListener("click", doSync);
  $("sync-cancel").addEventListener("click", () => {
    $("sync-review").hidden = true;
    $("sync-status").textContent = "";
  });

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
  let _claudeSaveT;
  $("claude-url").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    chrome.storage.local.set({ je_claude_url: v }); // fast local cache
    // Debounced save to the account so the web app sees the same value.
    clearTimeout(_claudeSaveT);
    _claudeSaveT = setTimeout(() => {
      send({ type: "saveClaudeProjectUrl", url: v }).catch(() => {});
    }, 700);
  });
  $("cl-copy-prompt").addEventListener("click", async () => {
    if (!bridgePrompt) return;
    const btn = $("cl-copy-prompt");
    const ok = await copyText(bridgePrompt);
    btn.textContent = ok ? "✓ Copied" : "⚠ Select + Ctrl+C";
    setTimeout(() => (btn.textContent = "📋 Copy prompt again"), 2200);
  });
  $("cl-pdf").addEventListener("click", downloadPdf);
  $("cl-copy").addEventListener("click", async () => {
    const btn = $("cl-copy");
    const ok = await copyText($("cl-output").value);
    // On failure, select the textarea so the user can just hit Ctrl+C.
    if (!ok) $("cl-output").select();
    btn.textContent = ok ? "✓ Copied" : "⚠ Ctrl+C to copy";
    setTimeout(() => (btn.textContent = "📋 Copy"), 2200);
  });
  $("staged-clear").addEventListener("click", clearStagedResume);

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
