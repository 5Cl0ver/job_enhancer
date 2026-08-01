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

function fillForm(job) {
  $("f-title").value = job.title || "";
  $("f-company").value = job.company || "";
  $("f-location").value = job.location || "";
  $("f-remote").checked = !!job.is_remote;
  $("f-url").value = job.url || "";
}

async function currentUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || "";
}

async function refreshStatus() {
  const res = await send({ type: "authStatus" });
  show(res?.signedIn ? "capture" : "login");
}

async function startPicker() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const status = $("save-status");
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["picker.js"],
    });
    status.className = "status";
    status.textContent = "Now click the job title on the page…";
  } catch {
    status.textContent = "Can't pick on this page.";
  }
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
    });
    btn.disabled = false;
    if (res?.ok) refreshStatus();
    else $("login-error").textContent = res?.error || "Sign-in failed";
  });

  $("pick-btn").addEventListener("click", startPicker);

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
    const res = await send({ type: "saveJob", job });
    btn.disabled = false;
    if (res?.ok) {
      status.className = "status ok";
      status.textContent = "✓ Saved!";
      addSaved(job);
      fillForm({});
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

// "Pick from page" stashes the capture in storage — fill the form the moment it lands.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.je_capture?.newValue) {
    fillForm(changes.je_capture.newValue);
    chrome.storage.local.remove("je_capture");
    const status = $("save-status");
    status.className = "status ok";
    status.textContent = "Captured — review and save.";
  }
});

// On-page "+ Save" card buttons save via the background, which pings us to update the list.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "jobSaved" && msg.job) addSaved(msg.job);
});
