// A fake Job Enhancer server for the browser tests: the app's API and the bits
// of Supabase Auth the extension calls. Everything it holds is invented — the
// tests never reach a real server, account or person.
//
//   const api = await startFakeApi();
//   api.state.scoutRun = { run_id: "run-1" };   // change answers mid-test
//   api.override("/v1/ai/autofill-map", { status: 500 });
//   api.calls("/v1/scout/captures")             // what the extension sent
//   await api.close();
import { createHash } from "node:crypto";
import { createServer } from "node:http";

/** The invented person every test fills forms for. */
export const PERSON = {
  email: "wren@example.com",
  profile: {
    first_name: "Wren",
    last_name: "Calloway",
    phone: "555-010-4477",
    address_line1: "12 Ferry Lane",
    address_line2: null,
    city: "Harborview",
    state: "OR",
    postal_code: "97000",
    country: "United States",
    linkedin_url: "https://www.linkedin.example/in/wren-calloway",
    github_url: "https://github.example/wrencalloway",
    portfolio_url: "https://wren.example",
    authorized_to_work: true,
    requires_sponsorship: false,
    willing_to_relocate: true,
    desired_salary: 85000,
    notice_period: "2 weeks",
  },
};

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function startFakeApi() {
  const state = {
    profile: { ...PERSON.profile },
    email: PERSON.email,
    answers: [],
    scoutRun: { run_id: null, any_site: false },
    // Apply with Claude (spec 022): what GET /v1/apply/active answers.
    applyRun: { run_id: null },
    photoTypes: [], // the content-type of each photo Job Catcher sent
    saved: [], // [{title, company, url}] — what /saved-jobs/check knows
    // The saved-jobs list the panel shows (GET /v1/saved-jobs/summary).
    jobs: [],
    jobsVersion: 1,
    claudeProjectUrl: "",
    documents: [], // what the panel saved or generated
    syncs: [], // Indeed applications the panel synced
    bundleVersion: 1, // bumped whenever the profile or answers change
    history: null, // the résumé read into {work, education}
    aiAnswers: {}, // question label -> {value, confidence} the fake AI gives
    taught: [], // boxes taught with "Point at a box": {id, site, fingerprint, profile_key, answer}
    resume: { filename: "wren-calloway.pdf", bytes: Buffer.from("%PDF-1.4\n% invented résumé\n") },
    // The user's other résumés (spec 020): id -> {filename, bytes, details}.
    resumes: {},
    jobResumes: {}, // saved job id -> résumé id (PUT /v1/saved-jobs/:id/resume)
    // Cover letters (spec 031): id -> {filename, text}.
    coverLetters: {},
    promoted: false, // one-site answers already made answers for every site (spec 020)
    // Job Catcher Connect (spec 019): the request under way, how long it lasts,
    // the newest version, the hellos received, the id the /connect page asks.
    connect: null,
    connectSeconds: 300,
    connectAutoApprove: true,
    latest: null,
    hellos: [],
    extensionId: "",
  };
  const log = []; // {method, path, body, at}
  const overrides = new Map(); // path -> {status, body, delay} | (req, body) => {status, body}
  let delay = 0; // every reply waits this long (a slow or waking server)

  const routes = {
    "POST /auth/v1/token": () => ({
      body: {
        access_token: "test-token",
        refresh_token: "test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    }),
    "GET /v1/users/me": () => ({
      body: { email: state.email, claude_project_url: state.claudeProjectUrl },
    }),
    // Job Catcher's one account setting (PATCH /v1/users/me is app-only).
    "PATCH /v1/users/me/claude-project": (b) => {
      if (typeof b?.claude_project_url === "string") state.claudeProjectUrl = b.claude_project_url;
      return { body: { email: state.email, claude_project_url: state.claudeProjectUrl } };
    },
    "PATCH /v1/users/me": (b) => {
      if (typeof b?.claude_project_url === "string") state.claudeProjectUrl = b.claude_project_url;
      return { body: { email: state.email, claude_project_url: state.claudeProjectUrl } };
    },
    "GET /v1/users/me/application-profile": () => ({ body: state.profile }),
    "PUT /v1/users/me/application-profile": (b) => {
      state.profile = { ...state.profile, ...b };
      state.bundleVersion++;
      return { body: state.profile };
    },
    "GET /v1/users/me/custom-answers": () => ({ body: state.answers }),
    "PUT /v1/users/me/custom-answers": (b) => {
      for (const a of b?.answers || []) {
        state.answers = state.answers.filter((x) => x.question_key !== a.question_key);
        state.answers.push(a);
      }
      state.bundleVersion++;
      return { body: b?.answers || [] };
    },
    "POST /v1/users/me/custom-answers/used": () => ({ status: 204 }),
    "DELETE /v1/users/me/custom-answers/:key": (_b, req) => {
      const key = decodeURIComponent(req.url.split("/").pop());
      state.answers = state.answers.filter((x) => x.question_key !== key);
      state.bundleVersion++;
      return { status: 204 };
    },
    "GET /v1/ai/resumes/active/file": () => ({
      raw: state.resume.bytes,
      headers: { "content-type": "application/pdf", "X-Resume-Filename": state.resume.filename },
    }),
    "POST /v1/ai/autofill-map": (b) => {
      const mappings = {};
      const confidence = {};
      for (const f of b?.fields || []) {
        const a = state.aiAnswers[f.label];
        if (a) {
          mappings[f.id] = a.value;
          confidence[f.id] = a.confidence ?? 0.9;
        }
      }
      return { body: { mappings, confidence } };
    },
    "GET /v1/autofill/bundle": (_b, req) => {
      const version = `b${state.bundleVersion}`;
      if (new URL(req.url, "http://x").searchParams.get("version") === version) {
        return { body: { changed: false, version } };
      }
      return {
        body: {
          changed: true,
          version,
          email: state.email,
          profile: state.profile,
          answers: state.answers,
          taught: state.taught,
          history: state.history,
          history_pending: false,
          promoted: state.promoted,
          resume: state.resume
            ? { id: "resume-1", filename: state.resume.filename, mime: "application/pdf", updated_at: "2026-11-23T08:00:00Z" }
            : null,
        },
      };
    },
    "POST /v1/autofill/taught": (b) => {
      const t = { id: `t${state.taught.length + 1}`, ...b };
      // The server's rule: stable names decide; else label + section + place.
      const same = (x, y) => {
        if ((x?.kind || "") !== (y?.kind || "")) return false;
        const strong = ["name", "id", "testid"].filter((k) => x?.[k] && y?.[k]);
        if (strong.length) return strong.every((k) => x[k] === y[k]);
        return !!x?.label && x.label === y?.label && x.section === y?.section && x.index === y?.index;
      };
      state.taught = [...state.taught.filter((x) => !(x.site === b.site && same(x.fingerprint, b.fingerprint))), t];
      state.bundleVersion++;
      return { status: 201, body: { id: t.id } };
    },
    "GET /v1/autofill/taught": () => ({
      body: state.taught.map((t) => ({ id: t.id, site: t.site, label: t.fingerprint?.label || "", profile_key: t.profile_key ?? null, answer_preview: t.answer ? t.answer.slice(0, 40) : null })),
    }),
    "DELETE /v1/autofill/taught/:id": (_b, req) => {
      const id = req.url.split("/").pop();
      state.taught = state.taught.filter((t) => t.id !== id);
      state.bundleVersion++;
      return { status: 204 };
    },
    "POST /v1/ai/work-history": () => ({ body: { entries: state.history?.work || [] } }),
    "GET /v1/saved-jobs/summary": (_b, req) => {
      const asked = new URL(req.url, "http://x").searchParams.get("version");
      const version = `v${state.jobsVersion}`;
      if (asked === version) return { body: { changed: false, version } };
      return { body: { changed: true, version, jobs: state.jobs } };
    },
    "POST /v1/saved-jobs/check": (b) => ({
      body: {
        saved: state.saved.some(
          (s) => s.title === b?.title && s.company === b?.company,
        ),
        needs_details: false,
      },
    }),
    "POST /v1/saved-jobs/manual": (b) => {
      state.saved.push({ title: b?.title, company: b?.company, url: b?.url });
      const n = state.jobs.length + 1;
      state.jobs.unshift({
        id: `saved-${n}`,
        job_listing_id: `listing-${n}`,
        title: b?.title,
        company: b?.company,
        location: b?.location,
        url: b?.url,
        applied_at: null,
      });
      state.jobsVersion++;
      return { status: 201, body: { id: `saved-${n}`, ...b } };
    },
    "POST /v1/saved-jobs/backfill": () => ({ body: { updated: false } }),
    "POST /v1/saved-jobs/mark-applied": (b) => {
      const job =
        (b?.saved_job_id && state.jobs.find((j) => j.id === b.saved_job_id)) ||
        state.jobs.find((j) => j.title === b?.title && j.company === b?.company);
      if (job) {
        job.applied_at = new Date().toISOString();
        state.jobsVersion++;
      }
      return { body: { matched: !!job } };
    },
    "POST /v1/saved-jobs/sync-applications": (b) => {
      const apps = b?.applications || [];
      state.syncs.push(...apps);
      return {
        body: {
          updated: 0,
          imported: apps.length,
          skipped: 0,
          outcomes: apps.map((a) => ({ action: "imported", title: a.title, company: a.company, stage: a.stage })),
        },
      };
    },
    "GET /v1/ai/resumes": () => ({
      body: [
        { id: "resume-1", is_active: true, filename: "Wren_Calloway_Resume.pdf" },
        ...Object.entries(state.resumes).map(([id, r]) => ({ id, is_active: false, filename: r.filename })),
      ],
    }),
    "GET /v1/autofill/resumes/:id/file": (_b, req) => {
      const r = state.resumes[decodeURIComponent(req.url.split("/")[4])];
      if (!r) return { status: 404, body: { detail: "Not found" } };
      return { raw: r.bytes, headers: { "content-type": "application/pdf", "X-Resume-Filename": r.filename } };
    },
    "GET /v1/autofill/resumes/:id/details": (_b, req) => {
      const id = decodeURIComponent(req.url.split("/")[4]);
      const r = state.resumes[id];
      if (!r) return { status: 404, body: { detail: "Not found" } };
      return { body: { resume_id: id, filename: r.filename, read: !r.unread, work: [], education: [], skills: [], certifications: [], websites: [], ...(r.unread ? {} : r.details || {}) } };
    },
    "GET /v1/autofill/cover-letters/:id": (_b, req) => {
      const id = decodeURIComponent(req.url.split("?")[0].split("/")[4]);
      const l = state.coverLetters[id];
      if (!l) return { status: 404, body: { detail: "Not found" } };
      const pdf = Buffer.from("%PDF-1.4 invented cover letter").toString("base64");
      return { body: { id, filename: l.filename, text: l.text, pdf_base64: pdf } };
    },
    "PUT /v1/saved-jobs/:id/resume": (b, req) => {
      const id = decodeURIComponent(req.url.split("/")[3]);
      state.jobResumes[id] = b?.resume_id || (b?.usual ? "usual" : null);
      const job = state.jobs.find((j) => j.id === id);
      if (job) {
        job.resume_id = b?.resume_id || null;
        job.resume_usual = !b?.resume_id && !!b?.usual;
      }
      state.jobsVersion++;
      return { status: 204 };
    },
    "POST /v1/autofill/resumes/:id/read": (_b, req) => {
      const id = decodeURIComponent(req.url.split("/")[4]);
      const r = state.resumes[id];
      if (!r) return { status: 404, body: { detail: "Not found" } };
      r.details = { ...(r.details || {}), ...(r.readsAs || {}) };
      r.unread = false;
      return { body: { resume_id: id, filename: r.filename, read: true, work: [], education: [], skills: [], certifications: [], websites: [], ...r.details } };
    },
    "POST /v1/autofill/promoted": () => {
      state.promoted = true;
      state.bundleVersion++;
      return { status: 204 };
    },
    "POST /v1/ai/generate": (b) => {
      const doc = {
        id: `doc-${state.documents.length + 1}`,
        content:
          b?.document_type === "resume"
            ? "WREN CALLOWAY\nField Service Technician\n- Repaired lab equipment at 40 customer sites."
            : "Dear Hiring Team,\nI'd like to bring five years of field repair work to Tidewell Labs.",
        ...b,
      };
      state.documents.push(doc);
      return { status: 201, body: doc };
    },
    "POST /v1/ai/prompt": (b) => ({
      body: { prompt: `Write a ${b?.document_type} for the job.`, job_title: "Field Service Technician", company: "Tidewell Labs" },
    }),
    "POST /v1/ai/documents/manual": (b) => {
      const doc = { id: `doc-${state.documents.length + 1}`, ...b };
      state.documents.push(doc);
      return { status: 201, body: doc };
    },
    "GET /v1/ai/documents/:id/pdf": () => ({
      raw: Buffer.from("%PDF-1.4\n% invented document\n"),
      headers: { "content-type": "application/pdf" },
    }),
    // ---- Job Catcher Connect + hello (spec 019) ----
    "POST /v1/extension/connect/start": (b) => {
      state.connect = {
        code: "K7QM-3XPD",
        pollToken: `poll-${Math.random().toString(36).slice(2)}-${"p".repeat(20)}`,
        proofHash: String(b?.proof_hash || ""),
        status: "pending",
      };
      return { body: { code: state.connect.code, poll_token: state.connect.pollToken, expires_in: state.connectSeconds } };
    },
    "POST /v1/extension/connect/approve": (b) => {
      const c = state.connect;
      const proofHash = createHash("sha256").update(String(b?.proof || "")).digest("hex");
      if (!c || c.status !== "pending" || b?.code !== c.code || proofHash !== c.proofHash) {
        return { status: 404, body: { detail: "That Connect link has expired." } };
      }
      c.status = "approved";
      return { body: { status: "approved" } };
    },
    "POST /v1/extension/connect/poll": (b) => {
      const c = state.connect;
      if (!c || b?.poll_token !== c.pollToken) return { status: 404, body: { detail: "gone" } };
      if (c.status === "approved") {
        c.status = "used";
        return { body: { status: "approved", token: `jcx_${"t".repeat(43)}`, email: state.email } };
      }
      return { body: { status: c.status } };
    },
    "POST /v1/extension/connect/cancel": () => {
      if (state.connect) state.connect.status = "cancelled";
      return { body: { status: "cancelled" } };
    },
    "POST /v1/extension/hello": (b) => {
      state.hellos.push(b);
      return { body: { latest: state.latest, update_available: false } };
    },
    "DELETE /v1/extension/tokens/current": () => ({ status: 204 }),
    // The app's approval page, reduced to what matters: ask the Job Catcher in
    // this browser for its proof, then approve with it.
    "GET /connect": (_b, req) => {
      const code = new URL(req.url, "http://x").searchParams.get("code") || "";
      return {
        raw: `<!doctype html><meta charset="utf-8"><title>Connect</title><p id="out">asking</p><script>
          const out = document.getElementById("out");
          const rt = window.chrome && chrome.runtime;
          if (!rt || !rt.sendMessage) { out.textContent = "no-extension"; }
          else rt.sendMessage(${JSON.stringify(state.extensionId)}, { type: "connectProof", code: ${JSON.stringify(code)} }, async (reply) => {
            const proof = reply && reply.proof;
            if (!proof) { out.textContent = "no-proof"; return; }
            if (${JSON.stringify(state.connectAutoApprove)}) {
              const r = await fetch("/v1/extension/connect/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: ${JSON.stringify(code)}, proof }) });
              out.textContent = r.ok ? "approved" : "refused";
            } else out.textContent = "has-proof";
          });
        </script>`,
        headers: { "content-type": "text/html; charset=utf-8" },
      };
    },
    "GET /v1/scout/runs/active": () => ({ body: state.scoutRun }),
    "POST /v1/scout/captures": () => ({ body: { stored: !!state.scoutRun.run_id } }),
    "GET /v1/apply/active": () => ({ body: state.applyRun }),
    "POST /v1/apply/requests/:id/claim": () => ({ body: { ok: true } }),
    "POST /v1/apply/requests/:id/photo": (_body, req) => {
      state.photoTypes.push(req.headers["content-type"]);
      return { status: 201, body: { id: `p${state.photoTypes.length}` } };
    },
    "POST /v1/apply/requests/:id/result": () => ({ body: { status: "done" } }),
    "POST /v1/apply/runs/:id/event": () => ({ body: { status: "review" } }),
    "POST /v1/apply/runs/:id/live": () => ({ status: 204 }),
  };

  const server = createServer(async (req, res) => {
    const path = (req.url || "/").split("?")[0];
    const body = await readBody(req);
    log.push({ method: req.method, path, body, at: Date.now() });
    let key = `${req.method} ${path}`;
    if (/^GET \/v1\/ai\/documents\/[^/]+\/pdf$/.test(key)) key = "GET /v1/ai/documents/:id/pdf";
    const apply = key.match(/^POST \/v1\/apply\/(requests|runs)\/[^/]+\/(claim|photo|result|event|live)$/);
    if (apply) key = `POST /v1/apply/${apply[1]}/:id/${apply[2]}`;
    if (/^DELETE \/v1\/autofill\/taught\/[^/]+$/.test(key)) key = "DELETE /v1/autofill/taught/:id";
    if (/^GET \/v1\/autofill\/resumes\/[^/]+\/file$/.test(key)) key = "GET /v1/autofill/resumes/:id/file";
    if (/^GET \/v1\/autofill\/resumes\/[^/]+\/details$/.test(key)) key = "GET /v1/autofill/resumes/:id/details";
    if (/^PUT \/v1\/saved-jobs\/[^/]+\/resume$/.test(key)) key = "PUT /v1/saved-jobs/:id/resume";
    if (/^GET \/v1\/autofill\/cover-letters\/[^/]+$/.test(key)) key = "GET /v1/autofill/cover-letters/:id";
    if (/^POST \/v1\/autofill\/resumes\/[^/]+\/read$/.test(key)) key = "POST /v1/autofill/resumes/:id/read";
    if (/^DELETE \/v1\/users\/me\/custom-answers\/[^/]+$/.test(key) && !key.endsWith("/used")) key = "DELETE /v1/users/me/custom-answers/:key";
    const o = overrides.get(path) ?? overrides.get(key);
    const wait = (typeof o === "object" && o?.delay) || delay;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    let out;
    if (typeof o === "function") out = await o(body, req);
    else if (o && (o.status || o.body)) out = o;
    else if (routes[key]) out = routes[key](body, req);
    else out = { status: 404, body: { detail: `fake api: no route for ${key}` } };
    if (out.raw) {
      res.writeHead(out.status || 200, out.headers || {});
      res.end(out.raw);
    } else if (out.status === 204) {
      res.writeHead(204);
      res.end();
    } else {
      json(res, out.status || 200, out.body ?? {});
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    state,
    /** Requests the extension made, optionally for one path. */
    calls: (path) => log.filter((c) => !path || c.path === path),
    clearCalls: () => log.splice(0),
    /** Replace one route's answer: {status, body, delay} or (body, req) => {status, body}. */
    override: (path, answer) => overrides.set(path, answer),
    reset: () => overrides.clear(),
    setDelay: (ms) => {
      delay = ms;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
