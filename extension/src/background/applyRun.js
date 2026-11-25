// Apply with Claude (spec 022), the background side: Job Catcher is Claude's
// eyes and hands on the application page.
//
// - Pages tick every few seconds. The background asks the app what's open
//   (GET /v1/apply/active): 2 s while an application is open, 60 s otherwise;
//   one request at a time however many pages ask; a failed ask keeps what it
//   knew and tries again soon (a server restart never lifts the lock).
// - The lock and the Submit report belong to the application's TAB (every
//   frame in it), not to its whole site: a board like LinkedIn hosts the
//   user's other applications too. The tab is the one Claude's requests point
//   at, remembered for the run.
// - While one is open, a loop asks every 2 s and does each new request once.
//   It only claims a request when this computer has the tab (Job Catcher may
//   be on two computers):
//     photo → the page screen by screen (at most 8), shrunk to JPEG, uploaded,
//             the scroll put back; stops at once if the tab stops showing, so
//             another tab is never photographed; then every question with
//             its answer;
//     fill  → the same fill as the panel's Autofill press, then what it filled
//             and what still needs an answer.
// Extension API calls on each turn keep the service worker awake while a run
// is open (Chrome resets its idle timer on every extension call).
import { onRunHost, shotPlan } from "../autofill/applyPage.js";

const OPEN_TTL = 2_000;
const IDLE_TTL = 60_000;
const RETRY_MS = 3_000;
const TRUST_MS = 90_000; // how long a last answer stands while the app can't be reached
const LOOP_MS = 2_000;
const CAPTURE_GAP_MS = 550; // Chrome allows 2 captures a second
const MAX_WIDTH = 1200;
const MAX_BYTES = 390_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pageKey(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * @param {{
 *   api: (path: string, init?: RequestInit) => Promise<Response|null>,
 *   press: (tabId: number) => Promise<{ok:boolean, busy?:boolean, problem?:string}>,
 *   fillSession: (tabId: number) => Promise<{frames: Record<string, {entries?: any[], need_you?: any[]}>}>,
 *   chrome?: typeof chrome,
 * }} deps
 */
export function createApplyRun({ api, press, fillSession, chrome: c = globalThis.chrome }) {
  let state = { at: 0, ttl: IDLE_TTL, data: { run_id: null }, okAt: 0 };
  let asking = null;
  let looping = false;
  const done = new Set(); // request ids answered here (claimed, or taken elsewhere)

  async function active(force = false) {
    if (!force && Date.now() - state.at < state.ttl) return state.data;
    asking ??= (async () => {
      try {
        const res = await api("/v1/apply/active");
        if (res === null && (await signedOut())) {
          // Signed out: no application here. (No token for a moment, a
          // refresh that failed, is just a failed ask, below.)
          state = { at: Date.now(), ttl: IDLE_TTL, data: { run_id: null }, okAt: Date.now() };
        } else {
          if (!res || !res.ok) throw new Error("no answer");
          const data = (await res.json()) || { run_id: null };
          state = { at: Date.now(), ttl: data.run_id ? OPEN_TTL : IDLE_TTL, data, okAt: Date.now() };
        }
      } catch {
        // Keep what we knew for a while (a restart never lifts the lock), and
        // ask again soon; after 90 s without an answer, stop trusting it.
        const stale = Date.now() - state.okAt > TRUST_MS;
        state = { ...state, at: Date.now(), ttl: RETRY_MS, data: stale ? { run_id: null } : state.data };
      } finally {
        asking = null;
      }
      return state.data;
    })();
    return asking;
  }

  async function signedOut() {
    const held = await c.storage.local.get(["je_token", "je_refresh"]).catch(() => ({}));
    return !held?.je_token && !held?.je_refresh;
  }

  // The run's tab(s), kept in the session so a sleeping worker remembers them.
  const tabsKey = (runId) => `je_apply_tabs:${runId}`;
  async function runTabs(runId) {
    const k = tabsKey(runId);
    const held = await c.storage.session.get(k).catch(() => ({}));
    return new Set(held?.[k] || []);
  }
  async function addRunTab(runId, tabId) {
    const tabs = await runTabs(runId);
    if (tabs.has(tabId)) return;
    tabs.add(tabId);
    await c.storage.session.set({ [tabsKey(runId)]: [...tabs].slice(-5) }).catch(() => {});
  }

  /** Is this the application's own tab (and still on its site)? */
  async function isRunTab(data, tab) {
    if (!onRunHost(hostOf(tab.url || ""), data.hosts)) return false;
    if ((await runTabs(data.run_id)).has(tab.id)) return true;
    return (data.requests || []).some((r) => pageKey(r.url) === pageKey(tab.url));
  }

  /** A page asks: is Submit locked here? Every tab on the application's site
   * is locked until the user's OK (the safety net, even before Claude's first
   * request); only the application's own tab reports a Submit as sent. */
  async function tick(tab) {
    const data = await active();
    if (data.run_id && !looping) loop();
    if (!data.run_id || tab?.id == null) return { active: false, guard: false, watch: false };
    const onSite = onRunHost(hostOf(tab.url || ""), data.hosts);
    // Look for the confirmation: Claude is pressing Submit, or one was just
    // pressed in this tab (the confirmation may be the next page).
    const watch =
      onSite && (await isRunTab(data, tab)) && (data.status === "submitting" || (watchUntil.get(tab.id) || 0) > Date.now());
    return { active: onSite, guard: onSite && !!data.guard, watch };
  }

  const watchUntil = new Map(); // tab id → until when it looks for the confirmation
  const WATCH_AFTER_PRESS_MS = 30_000;

  async function event(kind, tab, url, words) {
    const data = await active();
    if (!data.run_id || tab?.id == null) return;
    // A blocked press anywhere on the site is worth telling Claude; a press
    // that ends the run as sent must come from the application's own tab.
    const ok = kind === "blocked_submit" ? onRunHost(hostOf(tab.url || ""), data.hosts) : await isRunTab(data, tab);
    if (!ok) return;
    if (kind === "submit_pressed") watchUntil.set(tab.id, Date.now() + WATCH_AFTER_PRESS_MS);
    await api(`/v1/apply/runs/${data.run_id}/event`, {
      method: "POST",
      body: JSON.stringify({ kind, url: url || tab.url, ...(words ? { words } : {}) }),
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
    // Only the computer with the application's tab takes it.
    const tab = await findTab(req.url, data.run_id);
    if (!tab) return;
    const claimed = await api(`/v1/apply/requests/${req.id}/claim`, { method: "POST", body: "{}" }).catch(() => null);
    if (!claimed) return; // network: try again next turn
    done.add(req.id);
    if (!claimed.ok) return; // taken elsewhere, or gone
    await addRunTab(data.run_id, tab.id);
    try {
      if (req.kind === "fill") return await finish(req, await fill(tab));
      if (req.kind === "peek") return await finish(req, await peekShot(req, tab));
      return await finish(req, await photos(req, tab));
    } catch {
      return finish(req, { ok: false, reason: "error" });
    }
  }

  /** The application's tab: the same page, else the run's own tab, else the
   * focused window's showing tab on that exact host. */
  async function findTab(url, runId) {
    const tabs = await c.tabs.query({});
    const key = pageKey(url);
    const same = tabs.filter((t) => t.url && pageKey(t.url) === key);
    const pick = same.find((t) => t.active) || same[0];
    if (pick) return pick;
    const host = hostOf(url);
    const mine = await runTabs(runId);
    // The run's own tab, only while it's still on this page's site.
    const own = tabs.find((t) => mine.has(t.id) && t.url && hostOf(t.url) === host);
    if (own) return own;
    const [focused] = (await c.windows.getAll({ windowTypes: ["normal"] })).filter((w) => w.focused);
    return tabs.find((t) => t.active && t.windowId === focused?.id && t.url && hostOf(t.url) === host) || null;
  }

  async function fill(tab) {
    const out = await press(tab.id);
    const session = await fillSession(tab.id).catch(() => ({ frames: {} }));
    const frames = Object.values(session?.frames || {});
    const filled = frames.flatMap((f) => (f.entries || []).map((e) => e.label).filter(Boolean));
    const need = frames.flatMap((f) => (f.need_you || []).map((n) => n.label).filter(Boolean));
    // Busy: Keep filling is already filling this step; its report is the answer.
    const ok = !!out?.ok || !!out?.busy;
    return { ok, reason: ok ? null : out?.problem || "error", filled, need };
  }

  /** Still the same tab, showing the same page, in the same window? */
  async function stillShowing(tab, key) {
    const now = await c.tabs.get(tab.id).catch(() => null);
    return !!now && now.active && now.windowId === tab.windowId && pageKey(now.url || "") === key;
  }

  async function photos(req, tab) {
    const key = pageKey(tab.url || "");
    if (!(await stillShowing(tab, key))) return { ok: false, reason: "not_visible" };
    const ask = (msg) => c.tabs.sendMessage(tab.id, { type: "applyPage", ...msg }, { frameId: 0 }).catch(() => null);
    const size = await ask({ op: "measure" });
    const plan = size ? shotPlan(size.height, size.view) : [0];
    let part = 0;
    let lastShot = 0;
    let changed = false;
    try {
      for (const y of plan) {
        if (size) await ask({ op: "scroll", y });
        const wait = CAPTURE_GAP_MS - (Date.now() - lastShot);
        if (wait > 0) await sleep(wait);
        // Never another tab: check right before, and drop the shot if it
        // changed while it was taken.
        if (!(await stillShowing(tab, key))) {
          changed = true;
          break;
        }
        lastShot = Date.now();
        const shot = await capture(tab.windowId);
        if (!(await stillShowing(tab, key))) {
          changed = true;
          break;
        }
        if (!shot) continue;
        const up = await api(`/v1/apply/requests/${req.id}/photo?part=${part}`, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: shot,
        }).catch(() => null);
        if (up?.ok) part++;
      }
    } finally {
      if (size && !changed) await ask({ op: "scroll", y: size.y, settle: 0 });
      else if (size) ask({ op: "scroll", y: size.y, settle: 0 });
    }
    // The page changed under us: never read the new page's answers.
    const answers = changed ? [] : await readAnswers(tab.id);
    return part ? { ok: true, answers } : { ok: false, reason: "not_visible", answers };
  }

  /** The screen as it is now: one photo, never scrolled (spec 023). */
  async function peekShot(req, tab) {
    const key = pageKey(tab.url || "");
    if (!(await stillShowing(tab, key))) return { ok: false, reason: "not_visible" };
    const shot = await capture(tab.windowId);
    if (!shot || !(await stillShowing(tab, key))) return { ok: false, reason: "not_visible" };
    const up = await api(`/v1/apply/requests/${req.id}/photo?part=0`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: shot,
    }).catch(() => null);
    return up?.ok ? { ok: true } : { ok: false, reason: "error" };
  }

  async function capture(windowId) {
    let url;
    try {
      url = await c.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 });
    } catch {
      return null; // the window is hidden or minimised
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
    img.close?.();
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

  return { tick, event, active, loop };
}
