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

async function generateCoverLetter() {
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
    type: "generateCoverLetter",
    job_listing_id: jobListingId,
  }).catch(() => null);

  btn.disabled = false;
  $("cl-regen").disabled = false;
  if (res?.ok && res.content) {
    $("cl-output").value = res.content;
    $("cl-output-wrap").hidden = false;
    status.className = "status ok";
    status.textContent = "Done — copy it into the application.";
  } else if (res?.error === "NOT_SIGNED_IN") {
    show("login");
  } else if (res?.error === "NO_RESUME") {
    status.textContent = "Upload a resume in the app (AI Apply) first.";
  } else {
    status.textContent = res?.error || "Couldn't generate — try again.";
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

  $("cl-generate").addEventListener("click", generateCoverLetter);
  $("cl-regen").addEventListener("click", generateCoverLetter);
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
