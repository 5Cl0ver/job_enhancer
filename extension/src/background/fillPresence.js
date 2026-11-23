// Does the tab have a form, and what is Autofill doing on it (spec 016)?
// Every frame reports its form (formPresence) and its progress (fillStatus);
// the side panel and the toolbar icon read them from here. A press — from the
// panel, the toolbar or the shortcut — fills every frame that holds a form.
// Kept in storage.session: it survives the worker sleeping and goes with the
// browser session.

import { matchesPattern } from "./reinject.js";

const formKey = (tabId) => `je_form:${tabId}`;

/** Where the manifest runs the autofill reader (the tests add their lab). */
function autofillMatches() {
  const cs = (chrome.runtime.getManifest().content_scripts || []).find((c) => (c.js || []).some((f) => /autofill/.test(f)));
  return cs?.matches || [];
}
const statusKey = (tabId) => `je_status:${tabId}`;

const BADGE = { ready: "#4f46e5", done: "#16a34a", problem: "#d97706" };
const FLASH_MS = 4000;
const FRAME_TIMEOUT_MS = 90_000; // an AI pass on a long form can take a while

/**
 * @param {{notify: (tabId: number) => void}} deps  tells the panel to re-read
 */
export function createFillPresence({ notify }) {
  // One write at a time: frames reporting together must not overwrite each
  // other's read-modify-write.
  let writes = Promise.resolve();
  const queue = (fn) => (writes = writes.catch(() => {}).then(fn));
  /** Tabs with a press in progress: their frames' own results wait for the total. */
  const pressing = new Set();
  const flashing = new Map();

  async function readForms(tabId) {
    const key = formKey(tabId);
    const { [key]: held } = await chrome.storage.session.get(key);
    return held?.frames || {};
  }

  /** The tab, all frames together. */
  async function get(tabId) {
    const frames = await readForms(tabId);
    const list = Object.values(frames);
    const sk = statusKey(tabId);
    const { [sk]: status } = await chrome.storage.session.get(sk);
    return {
      form: list.some((p) => p.form),
      app: list.some((p) => p.app),
      fields: list.reduce((n, p) => n + (p.fields || 0), 0),
      status: status || null,
    };
  }

  async function badge(tabId) {
    if (flashing.has(tabId)) return;
    const { form } = await get(tabId);
    try {
      await chrome.action.setBadgeText({ tabId, text: form ? "⚡" : "" });
      if (form) await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE.ready });
    } catch {
      /* the tab closed */
    }
  }

  /** The filled count (or "!") on the icon for a few seconds after a press. */
  function flash(tabId, text, color) {
    clearTimeout(flashing.get(tabId));
    flashing.set(
      tabId,
      setTimeout(() => {
        flashing.delete(tabId);
        badge(tabId);
      }, FLASH_MS),
    );
    chrome.action.setBadgeText({ tabId, text }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  }

  function storePresence(tabId, frameId, presence) {
    return queue(async () => {
      const key = formKey(tabId);
      const { [key]: held = { frames: {} } } = await chrome.storage.session.get(key);
      if (presence?.form) {
        held.frames[frameId] = {
          form: true,
          app: !!presence.app,
          fields: Number(presence.fields) || 0,
          inModal: !!presence.inModal,
          at: Date.now(),
        };
      } else {
        delete held.frames[frameId];
      }
      await chrome.storage.session.set({ [key]: held });
      await badge(tabId);
      notify(tabId);
    });
  }

  /** Drop frames that no longer answer. */
  function forget(tabId, frameIds) {
    return queue(async () => {
      const key = formKey(tabId);
      const { [key]: held } = await chrome.storage.session.get(key);
      if (!held) return;
      for (const id of frameIds) delete held.frames[id];
      await chrome.storage.session.set({ [key]: held });
      await badge(tabId);
    });
  }

  function setStatus(tabId, status) {
    return queue(async () => {
      await chrome.storage.session.set({ [statusKey(tabId)]: { ...status, at: Date.now() } });
      notify(tabId);
    });
  }

  /** A frame's progress or result. During a press only progress counts: the
   *  press itself writes the result, summed over every frame. */
  function frameStatus(tabId, status) {
    if (!status?.phase) return Promise.resolve();
    if (pressing.has(tabId) && status.phase !== "filling") return Promise.resolve();
    if (!pressing.has(tabId) && status.phase === "done" && status.filled) flash(tabId, String(status.filled), BADGE.done);
    return setStatus(tabId, status);
  }

  /** The tab moved to another page: what we knew is gone; ask the new page. */
  function clear(tabId) {
    return queue(async () => {
      await chrome.storage.session.remove([formKey(tabId), statusKey(tabId)]).catch(() => {});
      clearTimeout(flashing.get(tabId));
      flashing.delete(tabId);
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
      notify(tabId);
    });
  }

  /** Ask every frame of the tab to report its form again (the panel opened). */
  function probe(tabId) {
    chrome.tabs.sendMessage(tabId, { type: "probeFill" }).catch(() => {});
  }

  /**
   * "Read the page again" (spec 017): a fresh reader in every frame that has
   * none (a frame the page wrote itself, a copy orphaned by an update), then
   * every frame reports its form again. Never replaces a live copy, so the
   * last fill's review and Undo keep working.
   */
  async function readAgain(tabId) {
    let results = [];
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        injectImmediately: true,
        func: () => ({ alive: !!globalThis.__jecAutofill?.alive?.(), origin: self.origin }),
      });
    } catch {
      return { ok: false, frames: 0, injected: 0 }; // a page Chrome keeps extensions out of
    }
    // Only where the manifest's reader belongs (https pages, never plain
    // http), in frames whose reader is missing or orphaned.
    const allowed = (origin) => autofillMatches().some((p) => matchesPattern(`${origin}/`, p));
    const dead = results.filter((r) => r.result && !r.result.alive && allowed(r.result.origin)).map((r) => r.frameId);
    if (dead.length) {
      await chrome.scripting
        .executeScript({ target: { tabId, frameIds: dead }, injectImmediately: true, files: ["dist/autofill.js"] })
        .catch(() => {});
    }
    probe(tabId);
    await new Promise((r) => setTimeout(r, 700)); // the frames' reports land
    return { ok: true, frames: results.length, injected: dead.length, ...(await get(tabId)) };
  }

  /** "Copy what Job Catcher saw": every frame's scan report (never values). */
  async function report(tabId) {
    let results = [];
    try {
      results = await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          injectImmediately: true,
          func: () => globalThis.__jecAutofill?.report?.() ?? null,
        }),
        new Promise((r) => setTimeout(() => r([]), 5000)), // a frame that never loads
      ]);
    } catch {
      results = [];
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    let host = "";
    try {
      host = new URL(tab?.url || "").hostname;
    } catch {
      /* no address */
    }
    return {
      version: chrome.runtime.getManifest().version,
      host,
      frames: results.filter((r) => r.result).map((r) => ({ frameId: r.frameId, ...r.result })),
      silent: results.filter((r) => !r.result).length,
    };
  }

  /**
   * Fill the tab: every frame with a form (only the pop-up's, when one is
   * open), or the top frame when none reported one — the user asked, so try.
   * When no frame could see a single field, the page is read again (a fresh
   * reader everywhere) and filled once more before anything is reported.
   * @returns {Promise<{ok: boolean, filled: number, need: number, problem?: string}>}
   */
  async function press(tabId) {
    if (pressing.has(tabId)) return { ok: false, busy: true, filled: 0, need: 0 };
    pressing.add(tabId);
    try {
      let out = await pressOnce(tabId, { note: "Starting…", retry: false });
      if (out.blind) {
        await setStatus(tabId, { phase: "filling", done: 0, total: 0, note: "Looking deeper…" });
        await readAgain(tabId);
        out = await pressOnce(tabId, { note: "Looking deeper…", retry: true });
      }
      return out.result;
    } finally {
      pressing.delete(tabId);
    }
  }

  /** One press; `blind` when no frame saw a field (or none answered). */
  async function pressOnce(tabId, { note, retry }) {
    const frames = Object.entries(await readForms(tabId)).map(([id, p]) => ({ id: Number(id), p }));
    let targets = frames.filter((f) => f.p.form);
    if (targets.some((f) => f.p.inModal)) targets = targets.filter((f) => f.p.inModal);
    const ids = targets.length ? targets.map((f) => f.id) : [0];
    await setStatus(tabId, { phase: "filling", done: 0, total: 0, note });
    const ask = (list) =>
      Promise.all(
        list.map((frameId) =>
          Promise.race([
            chrome.tabs.sendMessage(tabId, { type: "runAutofill", force: true }, { frameId }).catch(() => null),
            new Promise((r) => setTimeout(() => r({ ok: false, slow: true }), FRAME_TIMEOUT_MS)),
          ]),
        ),
      );
    let replies = await ask(ids);
    // Every target gone (a frame closed without saying so): forget them and
    // try the other frames with a form, or the page itself.
    if (replies.every((r) => r == null)) {
      await forget(tabId, ids);
      const rest = frames.filter((f) => f.p.form && !ids.includes(f.id)).map((f) => f.id);
      const retry = rest.length ? rest : ids.includes(0) ? [] : [0];
      if (retry.length) replies = await ask(retry);
    }
    const ok = replies.filter((r) => r?.ok);
    const filled = ok.reduce((n, r) => n + (r.filled || 0), 0);
    const need = ok.reduce((n, r) => n + (r.need || 0), 0);
    const seen = ok.reduce((n, r) => n + (r.seen ?? 1), 0);
    const r = replies.find((x) => x && !x.ok) || {};
    // Already filling (a new step, keep filling): that run reports its own result.
    if (!ok.length && replies.some((x) => x?.busy)) return { result: { ok: false, busy: true, filled: 0, need: 0 } };
    // Blind: frames answered but saw no field, or no frame answered at all.
    // Never when signed out, the app is asleep or a frame is just slow:
    // reading again wouldn't help, and a slow frame is still filling.
    const waiting = replies.some((x) => x && (x.signedIn === false || x.unreachable || x.slow));
    const blind = !retry && !waiting && (ok.length ? seen === 0 && !filled : replies.every((x) => !x || !x.ok));
    if (blind) return { blind: true };
    if (ok.length) {
      await setStatus(tabId, { phase: "done", filled, need, seen });
      flash(tabId, String(filled), filled ? BADGE.done : BADGE.problem);
      return { result: { ok: true, filled, need, seen } };
    }
    const problem = r.signedIn === false ? "signed_out" : r.unreachable ? "asleep" : r.slow ? "slow" : "refresh";
    await setStatus(tabId, { phase: "problem", problem });
    flash(tabId, "!", BADGE.problem);
    return { result: { ok: false, problem, filled: 0, need: 0 } };
  }

  return { get, storePresence, frameStatus, clear, probe, press, readAgain, report };
}
