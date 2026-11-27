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
//             its answer. A tab that isn't showing is shown for the photos
//             (a minimised window restored), then the user's tab is put back
//             (spec 026);
//     fill  → the same fill as the panel's Autofill press, then what it filled,
//             what still needs an answer, and what happened to the résumé.
// - While the run is being filled, the application's tab is read every 3 s
//   and, when it changed, its boxes and values go to the app's live view
//   (spec 026). Reading a page works in a background tab; no Claude tokens.
// - The run's own résumé (the one Claude made, or the user picked) is the
//   one attached on the run's pages: never a guess from the page's address.
//   Its cover letter likewise (spec 031): the run's, else the job's.
// Extension API calls on each turn keep the service worker awake while a run
// is open (Chrome resets its idle timer on every extension call).
import { CHOICE_CHARS, MAX_CHOICES, onRunHost, shotPlan } from "../autofill/applyPage.js";
import { CAPTURE_GAP_MS, capture as captureTab } from "./pagePhoto.js";

const OPEN_TTL = 2_000;
const IDLE_TTL = 60_000;
const RETRY_MS = 3_000;
const TRUST_MS = 90_000; // how long a last answer stands while the app can't be reached
const LOOP_MS = 2_000;
const PAINT_MS = 350; // a tab just shown needs a moment to draw
// A photo while the user is busy in another tab (spec 037): look again this
// often, for up to ~30 s, for the tab showing or the user stepping away.
const IN_USE_MS = 2_000;
const IN_USE_LOOKS = 15;
const LIVE_MS = 3_000;
const LIVE_AGAIN_MS = 60_000; // an unchanged page is sent again this often (spec 033)
const BUSY_MS = 1_000; // a fill still going: look for its report this often…
// …for as long as the app keeps the same fill going for Claude (its FILL_GOING,
// 3 min from the request), a little less (spec 037).
const FILL_BUDGET_MS = 170_000;
const FILL_LEAST_MS = 30_000; // …but never less than this from the claim
// A photo while a fill is going on its tab: wait this long for it to end.
const FILLING_MS = 1_000;
const FILLING_LOOKS = 30;
const MAX_LIVE = 150;
const PRIVATE = /password|passcode|\bpin\b|social security|\bssn\b|card number|credit card|\bcvv\b|\bcvc\b/i;
// The best of what each frame says happened to the résumé (and the cover letter, spec 037).
const RESUME_RANK = ["attached", "unverified", "failed", "no_file", "no_box"];

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
export function createApplyRun({ api, press, fillSession, onRunFill = async () => {}, filling = () => false, chrome: c = globalThis.chrome }) {
  let state = { at: 0, ttl: IDLE_TTL, data: { run_id: null }, okAt: 0 };
  let asking = null;
  let looping = false;
  const done = new Set(); // request ids answered here (claimed, or taken elsewhere)
  const handling = new Set(); // request ids being handled right now
  const fillingTabs = new Set(); // tabs a fill request is filling now
  /** Is a fill going on this tab (Claude's, or a press)? Never photographed then. */
  const fillingNow = (tabId) => fillingTabs.has(tabId) || !!filling(tabId);

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

  /** The résumé for the open run's own tab (spec 026), else null: never
   * another job's application on the same site (LinkedIn, Greenhouse…). */
  async function resumeFor(tab) {
    const data = await active();
    if (!data.run_id || !data.resume_id || !tab?.url || tab.id == null) return null;
    return (await isRunTab(data, tab)) ? data.resume_id : null;
  }

  /** The open run's id when this is its tab (spec 037: a file tried for one
   * run never counts for another), else null. */
  async function runFor(tab) {
    const data = await active();
    if (!data.run_id || !tab?.url || tab.id == null) return null;
    return (await isRunTab(data, tab)) ? data.run_id : null;
  }

  /** Is an Apply with Claude run open (spec 029)? Then what's typed in any
   * page is never auto-saved as the user's own answers: Claude may be typing
   * it, on a site the run hasn't heard of yet (a redirect before the first
   * fill), and the app learns only what the user approves at the review. */
  async function inRun() {
    const data = await active();
    return !!data.run_id;
  }

  /** The cover letter on the run's own tab (spec 031): the job's pick; null = none, undefined = not the run's tab. */
  async function coverLetterFor(tab) {
    const data = await active();
    if (!data.run_id || !tab?.url || tab.id == null) return undefined;
    if (!(await isRunTab(data, tab))) return undefined;
    return data.cover_letter_id || null;
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
    // Look for the thank-you page: the app says so for a few minutes after a
    // Submit press (it survives this worker sleeping or restarting), only in
    // the application's own tab.
    const watch = onSite && !!data.watch && (await isRunTab(data, tab));
    return { active: onSite, guard: onSite && !!data.guard, watch };
  }

  async function event(kind, tab, url, words, reason) {
    const data = await active();
    if (!data.run_id || tab?.id == null) return;
    // A blocked press anywhere on the site is worth telling Claude; a press
    // that ends the run as sent must come from the application's own tab.
    const ok = kind === "blocked_submit" ? onRunHost(hostOf(tab.url || ""), data.hosts) : await isRunTab(data, tab);
    if (!ok) return;
    if (kind === "submit_pressed" || kind === "submit_failed") state.at = 0; // hear the app's "watch" (or lock) at once
    await api(`/v1/apply/runs/${data.run_id}/event`, {
      method: "POST",
      // A confirmation is the tab's (a form embedded from another site says
      // it inside a frame of the application's page).
      body: JSON.stringify({ kind, url: kind === "confirmation_seen" ? tab.url : url || tab.url, ...(words ? { words } : {}), ...(reason ? { reason } : {}) }),
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
          if (done.has(req.id) || handling.has(req.id)) continue;
          handling.add(req.id);
          const job = handle(req, data)
            .catch(() => {})
            .finally(() => handling.delete(req.id));
          // A fill can wait minutes for its page (spec 037): the next
          // requests (photos) never wait behind it.
          if (req.kind !== "fill") await job;
        }
        if (data.live) await liveTick(data).catch(() => {});
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
    // The run's own tab first: another tab on the same page is never it.
    const tab = await findTab(req.url, data.run_id, { ownFirst: true });
    if (!tab) return;
    const claimed = await api(`/v1/apply/requests/${req.id}/claim`, { method: "POST", body: "{}" }).catch(() => null);
    if (!claimed) return; // network: try again next turn
    done.add(req.id);
    if (!claimed.ok) return; // taken elsewhere, or gone
    await addRunTab(data.run_id, tab.id);
    try {
      if (req.kind === "fill") {
        await onRunFill(tab.id, data.run_id).catch(() => {});
        fillingTabs.add(tab.id);
        try {
          return await finish(req, await fill(tab, req));
        } finally {
          fillingTabs.delete(tab.id);
        }
      }
      if (req.kind === "peek") return await finish(req, await peekShot(req, tab));
      return await finish(req, await photos(req, tab));
    } catch {
      return finish(req, { ok: false, reason: "error" });
    }
  }

  /** The application's tab: the same page, else the run's own tab, else the
   * focused window's showing tab on that exact host. A screen-now photo asks
   * for the run's own tab first (two tabs can share a page's address). */
  async function findTab(url, runId, { ownFirst = false } = {}) {
    const tabs = await c.tabs.query({});
    if (ownFirst) {
      const mine = await runTabs(runId);
      const host = hostOf(url);
      const own = tabs.find((t) => mine.has(t.id) && t.url && hostOf(t.url) === host);
      if (own) return own;
    }
    const key = pageKey(url);
    const same = tabs.filter((t) => t.url && pageKey(t.url) === key);
    // Showing, else the one used last (where Claude is working).
    const pick = same.find((t) => t.active) || [...same].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (pick) return pick;
    const host = hostOf(url);
    const mine = await runTabs(runId);
    // The run's own tab, only while it's still on this page's site.
    const own = tabs.find((t) => mine.has(t.id) && t.url && hostOf(t.url) === host);
    if (own) return own;
    const [focused] = (await c.windows.getAll({ windowTypes: ["normal"] })).filter((w) => w.focused);
    return tabs.find((t) => t.active && t.windowId === focused?.id && t.url && hostOf(t.url) === host) || null;
  }

  async function fill(tab, req = {}) {
    const started = Date.now();
    // Never past the app's own wait for this fill: FILL_BUDGET_MS from when it
    // was asked, by its age as the app counts it (never its clock against
    // this computer's), and never less than FILL_LEAST_MS from now.
    const age = Number(req.age_s);
    const left = Number.isFinite(age) && age > 0 ? FILL_BUDGET_MS - age * 1000 : FILL_BUDGET_MS;
    const until = started + Math.max(FILL_LEAST_MS, left);
    const out = await press(tab.id);
    const read = () => fillSession(tab.id).catch(() => ({ frames: {} }));
    // A frame's fill report since this press, by when it last FILLED: a
    // panel action's report (a Fix, an Undo) is never a fill's, and never
    // hides the fill before it.
    const filledAt = (f) => (f.action ? f.fillAt || 0 : (f.fillAt ?? f.at ?? 0));
    const fresh = (s) => Object.values(s?.frames || {}).filter((f) => filledAt(f) >= started);
    let session = await read();
    // Still going (spec 037): Keep filling was already filling this step
    // (busy), or the page outlasted the press's wait (slow, a long Workday
    // step). The page keeps filling: wait for ITS report, as long as the app
    // keeps this fill going for Claude, never handing back the last step's
    // (spec 029: Workday keeps one address).
    const going = !!out?.busy || out?.problem === "slow";
    const waits = going ? Math.ceil(Math.max(0, until - Date.now()) / BUSY_MS) : out?.ok ? 3 : 0;
    for (let i = 0; i < waits && !fresh(session).length; i++) {
      await sleep(BUSY_MS);
      session = await read();
    }
    // A late fill: its other frames a moment more, then the best of every
    // frame, as for a press that answered in time.
    for (let i = 0; going && i < 2 && fresh(session).length; i++) {
      await sleep(BUSY_MS);
      session = await read();
    }
    // Only what this fill reported: a frame that didn't fill now (gone with
    // the last step, or no form in it) never speaks for this page.
    const frames = fresh(session);
    // Busy or slow: the fill still going reports for this page; its report is the answer.
    const ok = !!out?.ok || !!out?.busy || (out?.problem === "slow" && frames.length > 0);
    if (!ok) return { ok: false, reason: out?.problem || "error", filled: [], need: [] };
    // No report from this fill: say so, never the last step's (spec 029).
    if (!frames.length) return { ok: false, reason: "no_report", filled: [], need: [] };
    const filled = frames.flatMap((f) => (f.entries || []).map((e) => e.label).filter(Boolean));
    const need = frames.flatMap((f) => (f.need_you || []).map((n) => n.label).filter(Boolean));
    const best = (key) => RESUME_RANK.find((s) => frames.some((f) => f[key] === s)) || null;
    const resume = best("resume");
    const letter = best("cover_letter");
    return { ok: true, reason: null, filled, need, ...(resume ? { resume } : {}), ...(letter ? { cover_letter: letter } : {}) };
  }

  /** Still the same tab, showing the same page, in the same window? */
  async function stillShowing(tab, key) {
    const now = await c.tabs.get(tab.id).catch(() => null);
    return !!now && now.active && now.windowId === tab.windowId && pageKey(now.url || "") === key;
  }

  /**
   * Show the application's tab for a photo (spec 026): make it the tab
   * showing in its window, restoring a minimised window. Never while the user
   * is typing in that window (their keys would land in the form): then it
   * waits a while for the tab to show or the user to step away, and after
   * that it's "busy" and the page is kept as text. `restore` puts back what
   * was showing, unless the user has moved on since.
   */
  async function showFor(tab) {
    let now = null;
    let win = null;
    const look = async () => {
      now = await c.tabs.get(tab.id).catch(() => null);
      win = now && (await c.windows.get(now.windowId).catch(() => null));
    };
    await look();
    if (!now || !win) return { reason: "tab_closed" };
    const inUse = async () => (await c.idle?.queryState?.(15).catch(() => null)) === "active";
    const hidden = () => win.state === "minimized" || !now.active;
    // Never switch tabs (or restore a window) while the user is acting, in
    // this window or another (spec 029): their keys and clicks, a file picker
    // or a drag would land on the wrong tab. Look again every 2 s for ~30 s
    // (spec 037): the photo is taken as soon as the tab shows (the user
    // clicked it) or the user stops; then it's "busy", the page kept as text.
    // (Tabs are only ever shown and put back: never moved, grouped or made.)
    for (let looks = 0; hidden() && (await inUse()); looks++) {
      if (looks >= IN_USE_LOOKS) return { reason: "busy" };
      await sleep(IN_USE_MS);
      await look();
      if (!now || !win) return { reason: "tab_closed" };
    }
    const undo = [];
    if (win.state === "minimized") {
      await c.windows.update(win.id, { state: "normal" }).catch(() => {});
      undo.push(() => c.windows.update(win.id, { state: "minimized" }));
    }
    if (!now.active) {
      const [was] = await c.tabs.query({ active: true, windowId: now.windowId }).catch(() => []);
      await c.tabs.update(tab.id, { active: true }).catch(() => {});
      if (was) {
        undo.push(async () => {
          const still = await c.tabs.get(tab.id).catch(() => null);
          if (still?.active) await c.tabs.update(was.id, { active: true });
        });
      }
    }
    if (undo.length) await sleep(PAINT_MS);
    return {
      tab: { ...tab, windowId: now.windowId },
      restore: async () => {
        for (const step of undo.reverse()) await step().catch(() => {});
      },
    };
  }

  /** Why no photo could be taken, in the app's words. */
  async function noPhoto() {
    const idle = await c.idle?.queryState?.(60).catch(() => null);
    return idle === "locked" ? "locked" : "hidden";
  }

  /** A fill going on the tab (spec 037): wait for it, up to ~30 s. True when done. */
  async function fillDone(tab) {
    for (let looks = 0; fillingNow(tab.id); looks++) {
      if (looks >= FILLING_LOOKS) return false;
      await sleep(FILLING_MS);
    }
    return true;
  }

  async function photos(req, tab) {
    // Never shown or scrolled mid-fill: the answers are kept.
    if (!(await fillDone(tab))) return { ok: false, reason: "filling", answers: await readAnswers(tab.id) };
    const shown = await showFor(tab);
    if (!shown.tab) {
      // In use: no photo now, but the page's questions and answers still go.
      return shown.reason === "busy" ? { ok: false, reason: "busy", answers: await readAnswers(tab.id) } : { ok: false, reason: shown.reason };
    }
    try {
      return await photosShown(req, shown.tab);
    } finally {
      await shown.restore();
    }
  }

  async function photosShown(req, tab) {
    const key = pageKey(tab.url || "");
    if (!(await stillShowing(tab, key))) return { ok: false, reason: "changed" };
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
    if (part) return { ok: true, answers };
    return { ok: false, reason: changed ? "changed" : await noPhoto(), answers };
  }

  /** The screen as it is now: one photo, never scrolled (spec 023). */
  async function peekShot(req, tab) {
    if (!(await fillDone(tab))) return { ok: false, reason: "filling" };
    const shown = await showFor(tab);
    if (!shown.tab) return { ok: false, reason: shown.reason };
    try {
      return await peekShown(req, shown.tab);
    } finally {
      await shown.restore();
    }
  }

  async function peekShown(req, tab) {
    const key = pageKey(tab.url || "");
    if (!(await stillShowing(tab, key))) return { ok: false, reason: "changed" };
    const shot = await capture(tab.windowId);
    if (!(await stillShowing(tab, key))) return { ok: false, reason: "changed" };
    if (!shot) return { ok: false, reason: await noPhoto() };
    const up = await api(`/v1/apply/requests/${req.id}/photo?part=0`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: shot,
    }).catch(() => null);
    return up?.ok ? { ok: true } : { ok: false, reason: "error" };
  }

  /** The window's visible tab, shrunk (shared with "Report a problem here"). */
  const capture = (windowId) => captureTab(c, windowId);

  // The live view (spec 026): what was last sent, per run.
  let live = { run: null, at: 0, sent: "", sentAt: 0 };

  /** Read the run's tab and, when its boxes changed, send them to the app. */
  async function liveTick(data) {
    if (live.run !== data.run_id) live = { run: data.run_id, at: 0, sent: "", sentAt: 0 };
    if (Date.now() - live.at < LIVE_MS) return;
    live.at = Date.now();
    const mine = await runTabs(data.run_id);
    const tabs = await c.tabs.query({}).catch(() => []);
    // The run's most recent tab still on its site.
    const tab = [...mine].reverse().map((id) => tabs.find((t) => t.id === id)).find((t) => t?.url && onRunHost(hostOf(t.url), data.hosts));
    if (!tab) return;
    const read = await readLive(tab.id);
    const boxes = read.boxes
      .filter((b) => b?.q && !PRIVATE.test(b.q))
      .slice(0, MAX_LIVE)
      .map((b) => ({
        q: String(b.q).slice(0, 300),
        a: String(b.a ?? "").slice(0, 300),
        ...(b.by ? { by: b.by } : {}),
        // A box the form requires (spec 037).
        ...(b.required === true ? { required: true } : {}),
        // The form's choices (spec 033), capped like the page side does.
        ...(Array.isArray(b.options) && b.options.length
          ? { options: b.options.slice(0, MAX_CHOICES).map((o) => String(o).slice(0, CHOICE_CHARS)), ...(b.free ? { free: true } : {}) }
          : {}),
      }));
    // The site's own name for the step on screen, when it has one (spec 033).
    const step = read.step ? { step: String(read.step).slice(0, 120) } : {};
    const body = JSON.stringify({ url: tab.url, title: (tab.title || "").slice(0, 200), ...step, boxes });
    // The same page again: only now and then, so the app keeps its step's name.
    if (body === live.sent && Date.now() - live.sentAt < LIVE_AGAIN_MS) return;
    const res = await api(`/v1/apply/runs/${data.run_id}/live`, { method: "POST", body }).catch(() => null);
    // Sent, or the run moved on (409): either way, not again until it changes.
    if (res?.ok || res?.status === 409) live = { ...live, sent: body, sentAt: Date.now() };
  }

  /** Every frame's boxes, and the step name (the top frame's first). An
   * older page copy answers with just its boxes. */
  async function readLive(tabId) {
    try {
      const results = await c.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const jc = globalThis.__jecAutofill;
          const boxes = jc?.live?.() || [];
          const step = jc?.step?.() || "";
          return step ? { boxes, step } : boxes;
        },
      });
      const boxes = results.flatMap((r) => (Array.isArray(r?.result) ? r.result : r?.result?.boxes || []));
      const step = results.map((r) => (Array.isArray(r?.result) ? "" : r?.result?.step || "")).find(Boolean) || "";
      return { boxes, step };
    } catch {
      return { boxes: [], step: "" };
    }
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

  return { tick, event, active, loop, resumeFor, inRun, coverLetterFor, runFor };
}
