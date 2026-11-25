// Apply with Claude (spec 022), the background side: Job Catcher is Claude's
// eyes and hands on the application page.
//
// - Pages tick every few seconds (only while showing). The background asks the
//   app what's open (GET /v1/apply/active), cached: 2 s while an application is
//   open, 60 s otherwise.
// - While one is open, a loop asks every 2 s and does each new request once
//   (claimed first, so two windows never both do it):
//     photo → scroll the page screen by screen, capture each (at most 8),
//             shrink to JPEG, upload; then every question with its answer;
//     fill  → the same fill as the panel's Autofill press, then what it filled
//             and what still needs an answer.
// - Submit buttons are blocked on the run's sites until the user's OK; a page
//   reports a blocked press, or a press once allowed.
// Extension API calls on each turn keep the service worker awake while a run
// is open (Chrome resets its idle timer on every extension call).
import { onRunHost, shotPlan } from "../autofill/applyPage.js";

const OPEN_TTL = 2_000;
const IDLE_TTL = 60_000;
const LOOP_MS = 2_000;
const CAPTURE_GAP_MS = 550; // Chrome allows 2 captures a second
const MAX_WIDTH = 1200;
const MAX_BYTES = 390_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pageKey(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

/**
 * @param {{
 *   api: (path: string, init?: RequestInit) => Promise<Response|null>,
 *   press: (tabId: number) => Promise<{ok:boolean, problem?:string}>,
 *   fillSession: (tabId: number) => Promise<{frames: Record<string, {entries?: any[], need_you?: any[]}>}>,
 *   chrome?: typeof chrome,
 * }} deps
 */
export function createApplyRun({ api, press, fillSession, chrome: c = globalThis.chrome }) {
  let state = { at: 0, data: { run_id: null } };
  let looping = false;
  const done = new Set(); // request ids already handled here

  async function active(force = false) {
    const ttl = state.data.run_id ? OPEN_TTL : IDLE_TTL;
    if (!force && Date.now() - state.at < ttl) return state.data;
    const res = await api("/v1/apply/active").catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    state = { at: Date.now(), data: data || { run_id: null } };
    return state.data;
  }

  /** A page asks: is an application open here, and is Submit blocked? */
  async function tick(url) {
    const data = await active();
    if (data.run_id && !looping) loop();
    const here = !!data.run_id && onRunHost(hostOf(url), data.hosts);
    return { active: here, guard: here && !!data.guard };
  }

  async function event(kind, url) {
    const data = await active();
    if (!data.run_id || !onRunHost(hostOf(url), data.hosts)) return;
    await api(`/v1/apply/runs/${data.run_id}/event`, {
      method: "POST",
      body: JSON.stringify({ kind, url }),
    }).catch(() => null);
    state.at = 0; // a press can end the run: ask again next time
  }

  async function loop() {
    if (looping) return;
    looping = true;
    try {
      for (;;) {
        await c.storage.session.get("je_apply_alive").catch(() => {}); // keep awake
        const data = await active(true);
        if (!data.run_id) break;
        for (const req of data.requests || []) {
          if (done.has(req.id)) continue;
          done.add(req.id);
          await handle(req, data).catch(() => {});
        }
        await sleep(LOOP_MS);
      }
    } finally {
      looping = false;
    }
  }

  async function finish(req, body) {
    await api(`/v1/apply/requests/${req.id}/result`, { method: "POST", body: JSON.stringify(body) }).catch(() => null);
  }

  async function handle(req, data) {
    const claimed = await api(`/v1/apply/requests/${req.id}/claim`, { method: "POST", body: "{}" });
    if (!claimed?.ok) return; // someone else has it, or it's gone
    const tab = await findTab(req.url, data.hosts);
    if (!tab) return finish(req, { ok: false, reason: "no_tab" });
    try {
      if (req.kind === "fill") return finish(req, await fill(tab));
      return finish(req, await photos(req, tab));
    } catch {
      return finish(req, { ok: false, reason: "error" });
    }
  }

  /** The application's tab: the same page, else the window's showing tab on the run's site. */
  async function findTab(url, hosts) {
    const tabs = await c.tabs.query({});
    const key = pageKey(url);
    const same = tabs.filter((t) => t.url && pageKey(t.url) === key);
    const pick = same.find((t) => t.active) || same[0];
    if (pick) return pick;
    const showing = tabs.filter((t) => t.active && t.url && onRunHost(hostOf(t.url), hosts));
    const [focused] = await c.windows.getAll({ windowTypes: ["normal"] }).then((ws) => ws.filter((w) => w.focused));
    return showing.find((t) => t.windowId === focused?.id) || showing[0] || null;
  }

  async function fill(tab) {
    const out = await press(tab.id);
    const session = await fillSession(tab.id).catch(() => ({ frames: {} }));
    const frames = Object.values(session?.frames || {});
    const filled = frames.flatMap((f) => (f.entries || []).map((e) => e.label).filter(Boolean));
    const need = frames.flatMap((f) => (f.need_you || []).map((n) => n.label).filter(Boolean));
    return { ok: !!out?.ok, reason: out?.ok ? null : out?.problem || "error", filled, need };
  }

  async function photos(req, tab) {
    if (!tab.active) return { ok: false, reason: "not_visible" };
    const ask = (msg) => c.tabs.sendMessage(tab.id, { type: "applyPage", ...msg }, { frameId: 0 }).catch(() => null);
    const size = await ask({ op: "measure" });
    const plan = size ? shotPlan(size.height, size.view) : [0];
    let part = 0;
    try {
      for (const y of plan) {
        if (size) await ask({ op: "scroll", y });
        const shot = await capture(tab.windowId);
        if (shot) {
          const up = await api(`/v1/apply/requests/${req.id}/photo?part=${part}`, {
            method: "POST",
            headers: { "Content-Type": "image/jpeg" },
            body: shot,
          }).catch(() => null);
          if (up?.ok) part++;
        }
        await sleep(CAPTURE_GAP_MS);
      }
    } finally {
      if (size) await ask({ op: "scroll", y: size.y, settle: 0 });
    }
    const answers = await readAnswers(tab.id);
    return part ? { ok: true, answers } : { ok: false, reason: "not_visible", answers };
  }

  async function capture(windowId) {
    let url;
    try {
      url = await c.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 });
    } catch {
      return null; // the window is hidden or the tab changed
    }
    const blob = await (await fetch(url)).blob();
    return shrink(blob);
  }

  /** At most 1200 px wide and under the app's 400 KB, as JPEG. */
  async function shrink(blob) {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      return blob.size <= MAX_BYTES ? blob : null;
    }
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_WIDTH / img.width);
    const canvas = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.6, 0.45, 0.3]) {
      const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (out.size <= MAX_BYTES) return out;
    }
    return null;
  }

  async function readAnswers(tabId) {
    try {
      const results = await c.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => globalThis.__jecAutofill?.answers?.() || [],
      });
      return results.flatMap((r) => r?.result || []).slice(0, 120);
    } catch {
      return [];
    }
  }

  return { tick, event, active, loop, _handle: handle, _findTab: findTab, _shrink: shrink };
}
