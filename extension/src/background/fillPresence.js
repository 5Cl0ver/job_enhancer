// Does the tab have a form, and what is Autofill doing on it (spec 016)?
// Every frame reports its form (formPresence) and its progress (fillStatus);
// the side panel and the toolbar icon read them from here. A press — from the
// panel, the toolbar or the shortcut — fills every frame that holds a form.
// Kept in storage.session: it survives the worker sleeping and goes with the
// browser session.

const formKey = (tabId) => `je_form:${tabId}`;
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
   * Fill the tab: every frame with a form (only the pop-up's, when one is
   * open), or the top frame when none reported one — the user asked, so try.
   * @returns {Promise<{ok: boolean, filled: number, need: number, problem?: string}>}
   */
  async function press(tabId) {
    if (pressing.has(tabId)) return { ok: false, busy: true, filled: 0, need: 0 };
    pressing.add(tabId);
    try {
      const frames = Object.entries(await readForms(tabId)).map(([id, p]) => ({ id: Number(id), p }));
      let targets = frames.filter((f) => f.p.form);
      if (targets.some((f) => f.p.inModal)) targets = targets.filter((f) => f.p.inModal);
      const ids = targets.length ? targets.map((f) => f.id) : [0];
      await setStatus(tabId, { phase: "filling", done: 0, total: 0, note: "Starting…" });
      const replies = await Promise.all(
        ids.map((frameId) =>
          Promise.race([
            chrome.tabs.sendMessage(tabId, { type: "runAutofill", force: true }, { frameId }).catch(() => null),
            new Promise((r) => setTimeout(() => r({ ok: false, slow: true }), FRAME_TIMEOUT_MS)),
          ]),
        ),
      );
      const ok = replies.filter((r) => r?.ok);
      const filled = ok.reduce((n, r) => n + (r.filled || 0), 0);
      const need = ok.reduce((n, r) => n + (r.need || 0), 0);
      if (ok.length) {
        await setStatus(tabId, { phase: "done", filled, need });
        flash(tabId, String(filled), filled ? BADGE.done : BADGE.problem);
        return { ok: true, filled, need };
      }
      const r = replies.find(Boolean) || {};
      // Already filling (a new step, keep filling): that run reports its own result.
      if (r.busy) return { ok: false, busy: true, filled: 0, need: 0 };
      const problem = r.signedIn === false ? "signed_out" : r.unreachable ? "asleep" : r.slow ? "slow" : "refresh";
      await setStatus(tabId, { phase: "problem", problem });
      flash(tabId, "!", BADGE.problem);
      return { ok: false, problem, filled: 0, need: 0 };
    } finally {
      pressing.delete(tabId);
    }
  }

  return { get, storePresence, frameStatus, clear, probe, press };
}
