// Side panel — the persistent UI. It never closes when you click the page, so
// "Pick from page" captures land here instantly (via storage), and card saves
// broadcast here. All API/auth work goes through the background service worker.
const cfg = self.JOB_ENHANCER_CONFIG;
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function show(view) {
  $("login-view").hidden = view !== "login";
  $("capture-view").hidden = view !== "capture";
}

const savedThisSession = [];
// The most recent capture, so richer fields (description, salary, type) that
// aren't shown in the form still get saved.
let lastCapture = null;
function renderSaved() {
  const wrap = $("saved-wrap");
  if (!savedThisSession.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const list = $("saved-list");
  list.innerHTML = "";
  for (const j of savedThisSession.slice(0, 12)) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = j.title || "Untitled";
    const s = document.createElement("span");
    s.textContent = [j.company, j.location].filter(Boolean).join(" · ");
    li.append(b, s);
    list.append(li);
  }
}
function addSaved(job) {
  savedThisSession.unshift(job);
  renderSaved();
}

// "Your saved jobs" — the full library, pulled from the backend.
function renderSavedAll(jobs) {
  $("saved-all-count").textContent = jobs.length ? `(${jobs.length})` : "";
  const list = $("saved-all-list");
  list.innerHTML = "";
  if (!jobs.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No saved jobs yet.";
    list.append(li);
    return;
  }
  for (const j of jobs.slice(0, 50)) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = j.title || "Untitled";
    const s = document.createElement("span");
    s.textContent = [j.company, j.location].filter(Boolean).join(" · ");
    li.append(b, s);
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

async function loadSaved() {
  const res = await send({ type: "listSaved" });
  renderSavedAll(res?.jobs || []);
}

function fillForm(job) {
  $("f-title").value = job.title || "";
  $("f-company").value = job.company || "";
  $("f-location").value = job.location || "";
  $("f-remote").checked = !!job.is_remote;
  $("f-url").value = job.url || "";
}

// The review form only appears once there's something to review (a capture),
// keeping the panel uncluttered the rest of the time.
function showReview() {
  $("review-section").hidden = false;
}
function hideReview() {
  $("review-section").hidden = true;
  fillForm({});
  const s = $("save-status");
  s.textContent = "";
  s.className = "status";
}

async function currentUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || "";
}

async function refreshStatus() {
  const res = await send({ type: "authStatus" });
  const signedIn = !!res?.signedIn;
  show(signedIn ? "capture" : "login");
  if (signedIn) loadSaved();
}

// Inject a small script into the active tab and surface a friendly error if the
// page can't be scripted (chrome:// pages, the Web Store, PDF viewer, etc.).
async function injectIntoActiveTab(file, workingMsg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const status = $("save-status");
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    status.className = "status";
    status.textContent = "Open a real job page first, then try again.";
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    status.className = "status";
    status.textContent = workingMsg;
  } catch (e) {
    status.className = "status";
    status.textContent = "Can't run on this page (the site may block it).";
  }
}

// Primary path: auto-read the current page with the shared extractor.
const captureThisPage = () => injectIntoActiveTab("dist/capture.js", "Reading this page…");
// Fallback: let the user click the exact element to capture.
const startPicker = () => injectIntoActiveTab("picker.js", "Now click the job title on the page…");

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
    });
    btn.disabled = false;
    if (res?.ok) refreshStatus();
    else $("login-error").textContent = res?.error || "Sign-in failed";
  });

  $("capture-btn").addEventListener("click", captureThisPage);
  $("pick-btn").addEventListener("click", startPicker);
  $("review-cancel").addEventListener("click", hideReview);

  // Keep "Your saved jobs" in sync with changes made elsewhere (removing/saving
  // in the app or another tab): refresh when the panel regains focus, and poll
  // gently while it's visible. Throttled so rapid focus/visibility events can't
  // spam the API.
  let lastRefresh = 0;
  const maybeRefresh = () => {
    if (document.hidden || $("capture-view").hidden) return;
    const now = Date.now();
    if (now - lastRefresh < 4000) return;
    lastRefresh = now;
    loadSaved();
  };
  document.addEventListener("visibilitychange", maybeRefresh);
  window.addEventListener("focus", maybeRefresh);
  setInterval(maybeRefresh, 15000);

  $("save-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("save-status");
    status.className = "status";
    status.textContent = "Saving…";
    const btn = e.submitter;
    btn.disabled = true;
    const job = {
      url: $("f-url").value.trim() || (await currentUrl()),
      title: $("f-title").value.trim(),
      company: $("f-company").value.trim() || "Unknown",
      location: $("f-location").value.trim() || "Not specified",
      is_remote: $("f-remote").checked,
    };
    // Carry richer captured fields the form doesn't show.
    if (lastCapture) {
      if (lastCapture.description) job.description = lastCapture.description;
      if (lastCapture.salary_min != null) job.salary_min = lastCapture.salary_min;
      if (lastCapture.salary_max != null) job.salary_max = lastCapture.salary_max;
      if (lastCapture.job_type) job.job_type = lastCapture.job_type;
    }
    const res = await send({ type: "saveJob", job });
    btn.disabled = false;
    if (res?.ok) {
      addSaved(job);
      loadSaved();
      hideReview();
    } else if (res?.error === "NOT_SIGNED_IN") {
      show("login");
    } else {
      status.textContent = res?.error || "Save failed";
    }
  });

  $("open-app").addEventListener("click", () =>
    chrome.tabs.create({ url: `${cfg.APP_URL}/saved` }),
  );
  $("signout").addEventListener("click", async () => {
    await send({ type: "signOut" });
    show("login");
  });
});

// "Capture this page" / "Pick manually" stash the result in storage — fill the
// form the moment it lands, whichever path produced it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.je_capture?.newValue) {
    const job = changes.je_capture.newValue;
    lastCapture = job;
    fillForm(job);
    showReview();
    chrome.storage.local.remove("je_capture");
    const status = $("save-status");
    if (job.title) {
      status.className = "status ok";
      status.textContent = "Captured — review and save.";
    } else {
      status.className = "status";
      status.textContent = "Couldn't read a title — fill it in or try Pick manually.";
    }
  }
});

// The on-page green "Save" button saves via the background, which pings us to update the list.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "jobSaved" && msg.job) {
    addSaved(msg.job);
    loadSaved();
  }
});
