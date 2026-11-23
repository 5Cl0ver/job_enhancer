// A fake Job Enhancer server for the browser tests: the app's API and the bits
// of Supabase Auth the extension calls. Everything it holds is invented — the
// tests never reach a real server, account or person.
//
//   const api = await startFakeApi();
//   api.state.scoutRun = { run_id: "run-1" };   // change answers mid-test
//   api.override("/v1/ai/autofill-map", { status: 500 });
//   api.calls("/v1/scout/captures")             // what the extension sent
//   await api.close();
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
    saved: [], // [{title, company, url}] — what /saved-jobs/check knows
    resume: { filename: "wren-calloway.pdf", bytes: Buffer.from("%PDF-1.4\n% invented résumé\n") },
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
    "GET /v1/users/me": () => ({ body: { email: state.email, claude_project_url: "" } }),
    "PATCH /v1/users/me": () => ({ body: { email: state.email } }),
    "GET /v1/users/me/application-profile": () => ({ body: state.profile }),
    "PUT /v1/users/me/application-profile": (b) => {
      state.profile = { ...state.profile, ...b };
      return { body: state.profile };
    },
    "GET /v1/users/me/custom-answers": () => ({ body: state.answers }),
    "PUT /v1/users/me/custom-answers": (b) => {
      for (const a of b?.answers || []) {
        state.answers = state.answers.filter((x) => x.question_key !== a.question_key);
        state.answers.push(a);
      }
      return { body: b?.answers || [] };
    },
    "POST /v1/users/me/custom-answers/used": () => ({ status: 204 }),
    "GET /v1/ai/resumes/active/file": () => ({
      raw: state.resume.bytes,
      headers: { "content-type": "application/pdf", "X-Resume-Filename": state.resume.filename },
    }),
    "POST /v1/ai/autofill-map": () => ({ body: { mappings: {}, confidence: {} } }),
    "POST /v1/ai/work-history": () => ({ body: { entries: [] } }),
    "GET /v1/saved-jobs/summary": () => ({ body: { changed: true, version: "v1", jobs: [] } }),
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
      return { status: 201, body: { id: "saved-1", ...b } };
    },
    "POST /v1/saved-jobs/backfill": () => ({ body: { updated: false } }),
    "POST /v1/saved-jobs/mark-applied": () => ({ body: { matched: true } }),
    "GET /v1/scout/runs/active": () => ({ body: state.scoutRun }),
    "POST /v1/scout/captures": () => ({ body: { stored: !!state.scoutRun.run_id } }),
  };

  const server = createServer(async (req, res) => {
    const path = (req.url || "/").split("?")[0];
    const body = await readBody(req);
    log.push({ method: req.method, path, body, at: Date.now() });
    const key = `${req.method} ${path}`;
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
