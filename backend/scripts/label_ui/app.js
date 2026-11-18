// Email labeling page. Email content is untrusted: it is only ever put on the
// page with textContent (never parsed as HTML), and nothing in it is a link.
"use strict";

const token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
const $ = (id) => document.getElementById(id);
let data = null;
let pos = 0;

function api(path, body) {
  const opts = { headers: { "X-Label-Token": token } };
  if (body !== undefined) {
    opts.method = "POST";
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  return fetch(path, opts).then((r) =>
    r.json().then((j) => {
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    }),
  );
}

const row = () => data.rows[pos];
const labelOf = (id) => data.labels[id] || {};
const isDone = (id) => {
  const l = labelOf(id);
  return Boolean(l.label && l.job);
};

function button(text, cls, onClick) {
  const b = document.createElement("button");
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function jobName(key) {
  if (key === "none") return "None";
  const j = data.jobs.find((x) => x.key === key);
  return j ? `${j.company} — ${j.title}` : key;
}

function renderProgress(p) {
  $("progress").textContent = `${p.done} of ${p.total} labeled`;
  $("bar-fill").style.width = `${p.total ? (100 * p.done) / p.total : 0}%`;
}

function renderJobs() {
  const q = $("job-search").value.trim().toLowerCase();
  const box = $("jobs");
  box.replaceChildren();
  if (!q) return;
  const cur = labelOf(row().id).job;
  data.jobs
    .filter((j) => `${j.company} ${j.title}`.toLowerCase().includes(q))
    .slice(0, 40)
    .forEach((j) =>
      box.append(
        button(`${j.company} — ${j.title}`, j.key === cur ? "job on" : "job", () =>
          save({ job: j.key }),
        ),
      ),
    );
}

function render() {
  const r = row();
  const l = labelOf(r.id);
  $("position").textContent = `${pos + 1} / ${data.rows.length}${isDone(r.id) ? " ✓" : ""}`;
  $("group").textContent = r.group === "likely_job" ? "likely job" : "everything else";
  $("role").textContent = r.role === "junk" ? "spam folder" : "inbox";
  $("date").textContent = r.date ? new Date(r.date).toLocaleString() : "";
  $("issues").textContent = r.read_issues ? `read issues: ${r.read_issues}` : "";
  $("sender").textContent = r.sender;
  $("subject").textContent = r.subject || "(no subject)";
  $("text").textContent = r.text || "(no readable text)";
  const h = r.hints;
  $("guess").textContent =
    `Scanner guessed: ${h.predicted_event || "?"}` +
    (h.predicted_job ? ` · ${jobName(h.predicted_job)}` : "") +
    ` · match ${h.match || "-"} · filter ${h.filter_reason || "-"}`;
  $("guess").hidden = !$("hints").checked;

  const types = $("types");
  types.replaceChildren();
  data.types.forEach((t, i) =>
    types.append(
      button(`${i + 1}. ${t.label}`, l.label === t.key ? "on" : "", () =>
        save(t.key === "unknown" && !l.job ? { label: t.key, job: "none" } : { label: t.key }),
      ),
    ),
  );
  $("reminder").checked = Boolean(l.reminder);
  $("job-none").className = l.job === "none" ? "job on" : "job";
  $("job-current").textContent = l.job ? `chosen: ${jobName(l.job)}` : "";
  if (document.activeElement !== $("note")) $("note").value = l.note || "";
  renderJobs();
}

function save(change) {
  const r = row();
  const next = { ...labelOf(r.id), ...change };
  data.labels[r.id] = next;
  render();
  $("status").textContent = "saving…";
  return api("/api/label", {
    id: r.id,
    label: next.label || "",
    job: next.job || "",
    reminder: Boolean(next.reminder),
    note: next.note || "",
  })
    .then((p) => {
      renderProgress(p);
      $("status").textContent = isDone(r.id) ? "saved ✓ — Enter for the next one" : "saved";
    })
    .catch((e) => ($("status").textContent = `NOT saved: ${e.message}`));
}

function go(i) {
  pos = Math.max(0, Math.min(data.rows.length - 1, i));
  $("job-search").value = "";
  $("status").textContent = "";
  render();
  window.scrollTo(0, 0);
}

function nextOpen() {
  const n = data.rows.length;
  for (let k = 1; k <= n; k++) {
    const i = (pos + k) % n;
    if (!isDone(data.rows[i].id)) return go(i);
  }
  $("status").textContent = "Everything is labeled. 🎉 Click “Write labeled CSV”.";
}

function wire() {
  $("prev").addEventListener("click", () => go(pos - 1));
  $("next").addEventListener("click", () => go(pos + 1));
  $("next-open").addEventListener("click", nextOpen);
  $("job-none").addEventListener("click", () => save({ job: "none" }));
  $("job-search").addEventListener("input", renderJobs);
  $("reminder").addEventListener("change", (e) => save({ reminder: e.target.checked }));
  $("note").addEventListener("change", (e) => save({ note: e.target.value }));
  $("hints").addEventListener("change", render);
  $("merge").addEventListener("click", () =>
    api("/api/merge", {})
      .then((j) => ($("status").textContent = `wrote ${j.file} (in email_exports)`))
      .catch((e) => ($("status").textContent = `could not write: ${e.message}`)),
  );
  document.addEventListener("keydown", (e) => {
    const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName) && e.target.type !== "checkbox";
    if (typing) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if (e.key === "ArrowLeft") go(pos - 1);
    else if (e.key === "ArrowRight") go(pos + 1);
    else if (e.key === "Enter") nextOpen();
    else if (e.key === "0") save({ job: "none" });
    else if (/^[1-7]$/.test(e.key)) {
      const t = data.types[Number(e.key) - 1];
      const l = labelOf(row().id);
      save(t.key === "unknown" && !l.job ? { label: t.key, job: "none" } : { label: t.key });
    } else if (e.key === "/") {
      e.preventDefault();
      $("job-search").focus();
    }
  });
}

api("/api/data")
  .then((d) => {
    data = d;
    if (!data.rows.length) throw new Error("the sheet has no rows");
    wire();
    renderProgress(d.progress);
    $("app").hidden = false;
    const first = data.rows.findIndex((r) => !isDone(r.id));
    go(first < 0 ? 0 : first);
  })
  .catch((e) => {
    $("error").hidden = false;
    $("error").textContent =
      `Could not load: ${e.message}. Open the exact link the server printed (it includes a key).`;
  });
