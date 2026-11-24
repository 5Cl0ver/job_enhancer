// "Connect to Job Enhancer" with one press (spec 019): no password, so people
// who signed up with GitHub can use Job Catcher too.
//
// 1. Start: make a random proof, send only its sha256; get a code + poll token.
// 2. Open APP_URL/connect?code=…, where the person approves while signed in.
//    That page asks THIS Job Catcher for the proof (externally_connectable,
//    app origin only) and we answer only for our own waiting code. A link
//    someone else sends can't connect their Job Catcher to this account.
// 3. ONE poller: this worker asks every 2 s while it's awake (≤ 30 a minute);
//    if Chrome puts it to sleep, a 30 s alarm or the panel opening wakes it
//    and the same loop carries on. The panel only reads the state (and hears
//    "connectChanged"), it never polls the server itself.
//
// The proof and poll token live in chrome.storage.session (trusted contexts
// only: never content scripts, never written to disk) and are never logged.

const KEY = "je_connect";
const ALARM = "je-connect";
const POLL_MS = 2000;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * `onConnected(token, email)` stores the pass and refreshes the panel.
 * `fetchFn`: the worker's fetch that waits out a sleeping server (wakeFetch).
 */
export function createConnect({
  cfg,
  onConnected,
  fetchFn = fetch,
  openTab = (url) => chrome.tabs.create({ url }),
  notify = () => chrome.runtime.sendMessage({ type: "connectChanged" }).catch(() => {}),
}) {
  let inFlight = null;
  let timer = null;

  const read = async () => (await chrome.storage.session.get(KEY))[KEY] || null;
  const write = (state) => chrome.storage.session.set({ [KEY]: state });
  const post = (path, body) =>
    fetchFn(`${cfg.API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  /** What the panel shows: waiting (with code), expired, cancelled, or idle. */
  async function status() {
    const c = await read();
    if (!c) return { state: "idle" };
    if (c.state === "waiting" && Date.now() > c.deadline) {
      await finish({ ...c, state: "expired" });
      return { state: "expired" };
    }
    if (c.state === "waiting") resume();
    return { state: c.state, code: c.code, deadline: c.deadline };
  }

  async function start() {
    const proof = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const proofHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proof)));
    let res;
    try {
      res = await post("/v1/extension/connect/start", { proof_hash: proofHash });
    } catch {
      return { ok: false, error: "Couldn't reach Job Enhancer. It may be waking up; try again in a minute." };
    }
    if (res.status === 429) return { ok: false, error: "Too many tries. Wait a few minutes, then try again." };
    if (!res.ok) return { ok: false, error: "Couldn't start connecting. Try again." };
    const d = await res.json();
    const state = {
      state: "waiting",
      code: d.code,
      pollToken: d.poll_token,
      proof,
      deadline: Date.now() + (d.expires_in || 300) * 1000,
    };
    await write(state);
    chrome.alarms?.create(ALARM, { periodInMinutes: 0.5 });
    await openApproval();
    loop();
    return { ok: true, code: d.code, deadline: state.deadline };
  }

  async function openApproval() {
    const c = await read();
    if (c?.state !== "waiting") return;
    await Promise.resolve(openTab(`${cfg.APP_URL}/connect?code=${encodeURIComponent(c.code)}`)).catch(() => {});
  }

  function loop() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const r = await poll().catch(() => ({ state: "waiting" }));
      if (r.state === "waiting") loop();
    }, POLL_MS);
  }

  /** Carry on waiting after the worker slept (alarm, panel opened). */
  function resume() {
    if (!timer && !inFlight) loop();
  }

  async function finish(state) {
    clearTimeout(timer);
    timer = null;
    chrome.alarms?.clear(ALARM);
    if (state) await write(state);
    else await chrome.storage.session.remove(KEY);
    notify();
  }

  /** One poll at a time, so the pass is only ever taken once. */
  function poll() {
    if (!inFlight) {
      inFlight = pollOnce().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  async function pollOnce() {
    const c = await read();
    if (!c || c.state !== "waiting") return { state: c?.state || "idle" };
    if (Date.now() > c.deadline) {
      await finish({ ...c, state: "expired" });
      return { state: "expired" };
    }
    let res;
    try {
      res = await post("/v1/extension/connect/poll", { poll_token: c.pollToken });
    } catch {
      return { state: "waiting" }; // offline or waking: try again
    }
    if (res.status === 404) {
      await finish({ ...c, state: "expired" });
      return { state: "expired" };
    }
    if (!res.ok) return { state: "waiting" };
    const d = await res.json();
    if (d.status === "approved" && typeof d.token === "string" && d.token.startsWith("jcx_")) {
      await finish(null);
      await onConnected(d.token, d.email || "");
      return { state: "connected" };
    }
    if (d.status === "pending") return { state: "waiting" };
    const state = d.status === "cancelled" ? "cancelled" : "expired";
    await finish({ ...c, state });
    return { state };
  }

  async function cancel() {
    const c = await read();
    await finish(null);
    if (c?.pollToken && c.state === "waiting") {
      await post("/v1/extension/connect/cancel", { poll_token: c.pollToken }).catch(() => {});
    }
    return { ok: true };
  }

  /**
   * The /connect page asking for our proof. Only the app's own address, and
   * only for the code we're waiting on; anything else gets nothing.
   */
  async function proofFor(msg, sender) {
    let appOrigin = "";
    try {
      appOrigin = new URL(cfg.APP_URL).origin;
    } catch {
      return {};
    }
    if (!sender || sender.origin !== appOrigin || msg?.type !== "connectProof") return {};
    const c = await read();
    if (!c || c.state !== "waiting" || Date.now() > c.deadline) return {};
    if (typeof msg.code !== "string" || msg.code.toUpperCase() !== c.code) return {};
    return { proof: c.proof };
  }

  return { start, status, poll, resume, cancel, openApproval, proofFor, alarm: ALARM };
}
