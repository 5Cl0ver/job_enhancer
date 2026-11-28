// Tabs and the jobs they apply for (spec 040), the background side of
// src/tabJob.js: kept in the session, so a sleeping worker remembers them.
//
// - The user's own press on an Apply, in a saved job's own page (its main
//   frame), is noted for that tab (`press`); a tab it opens within 20 s
//   takes it over (once: the next tab opened gets nothing).
// - On the next page that is no saved job by itself, the side panel asks
//   "Applying for <job>?" (`question`). Yes binds the tab to the job and,
//   when the page names its posting for sure, teaches the job its company
//   link; No just ends it. Either way the press is used up.
// - The binding holds while the tab stays on that application
//   (`keepBinding`); anything else drops it.
// - During Apply with Claude, a tab the application's own tab opens that
//   looks like the application joins the run's tab group and Claude hears
//   of it, as a hint (`run.opened` / `run.landed`).
import { OPEN_MS, TAB_JOB, TAB_PRESS, askAbout, bindHere, boardOf, boardRedirect, boundJobId, isWebPage, keepBinding, onHub, postingIds, putEntry, worthTelling } from "../tabJob.js";

const NEW_TABS = "je_new_tabs"; // run hints waiting for their tab's first page
const NEW_MS = 60_000;

/**
 * @param {{
 *   ownMatch: (tab: chrome.tabs.Tab) => Promise<{id: string}|null>,
 *   learnLink?: (jobId: string, url: string) => Promise<unknown>,
 *   run?: { opened: (tab: chrome.tabs.Tab, opener: chrome.tabs.Tab) => Promise<boolean>, landed: (tab: chrome.tabs.Tab, openerId: number) => Promise<unknown> },
 *   chrome?: typeof chrome,
 *   now?: () => number,
 * }} deps
 */
export function createTabJobs({ ownMatch, learnLink = async () => {}, run = { opened: async () => false, landed: async () => {} }, chrome: c = globalThis.chrome, now = () => Date.now() }) {
  // One change at a time: a new tab's first page can load before its
  // opening has been noted.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  async function read(key) {
    const got = await c.storage.session.get(key).catch(() => ({}));
    return got?.[key] || {};
  }
  const write = (key, value) => c.storage.session.set({ [key]: value }).catch(() => {});
  async function set(key, tabId, value) {
    await write(key, putEntry(await read(key), tabId, value));
  }

  /** The user pressed an Apply in this tab's main frame. Only on a saved job's own page. */
  function pressed(tab, frameId) {
    return serial(async () => {
      if (tab?.id == null || frameId !== 0 || !isWebPage(tab.url)) return;
      const own = await ownMatch(tab).catch(() => null);
      if (!own) return;
      await set(TAB_PRESS, tab.id, { jobId: own.id, at: now() });
    });
  }

  /** The job bound to this tab's page (the user said Yes), else null. */
  async function carried(tab) {
    if (tab?.id == null) return null;
    return boundJobId((await read(TAB_JOB))[tab.id], tab.url || "", now());
  }

  /** The job the panel asks about on this tab's page, else null. */
  async function question(tab) {
    if (tab?.id == null) return null;
    if ((await carried(tab)) != null) return null;
    const press = (await read(TAB_PRESS))[tab.id];
    if (!press) return null;
    const own = await ownMatch(tab).catch(() => null);
    return askAbout(press, tab.url || "", own?.id || null, now());
  }

  /** The user's answer. Yes binds the tab and (a strong id) teaches the link. */
  function answer(tab, yes) {
    return serial(async () => {
      if (tab?.id == null) return null;
      const press = (await read(TAB_PRESS))[tab.id];
      const own = await ownMatch(tab).catch(() => null);
      const jobId = askAbout(press, tab.url || "", own?.id || null, now());
      await set(TAB_PRESS, tab.id, null); // used up
      if (!jobId || !yes) return null;
      await set(TAB_JOB, tab.id, bindHere(jobId, tab.url, now()));
      if (postingIds(tab.url).strong.length) await learnLink(jobId, tab.url).catch(() => {});
      return jobId;
    });
  }

  /** A page finished loading in a tab. */
  function loaded(tab) {
    return serial(async () => {
      if (tab?.id == null || !isWebPage(tab.url)) return; // about:blank: nothing changes
      const bound = (await read(TAB_JOB))[tab.id];
      if (bound) {
        const kept = keepBinding(bound, tab.url, now());
        if (!kept) {
          // Off the application: dropped, and no question until a new press.
          await set(TAB_JOB, tab.id, null);
          await set(TAB_PRESS, tab.id, null);
        } else if (kept !== bound) await set(TAB_JOB, tab.id, kept);
      }
      const waiting = await read(NEW_TABS);
      const opened = waiting[tab.id];
      if (!opened) return;
      if (onHub(tab.url) && boardRedirect(opened.from, tab.url)) return; // on its way out
      const { [tab.id]: _gone, ...rest } = waiting;
      await write(NEW_TABS, rest);
      if (onHub(tab.url) || now() - opened.at > NEW_MS) return;
      if (worthTelling(opened.openerUrl, tab.url)) await run.landed(tab, opened.openerId).catch(() => {});
    });
  }

  /** A tab opened from another one. */
  function opened(tab) {
    return serial(async () => {
      if (tab?.id == null || tab.openerTabId == null) return;
      const opener = await c.tabs.get(tab.openerTabId).catch(() => null);
      if (!opener?.url) return;
      // A press just made in the opener goes with the first tab it opens.
      const presses = await read(TAB_PRESS);
      const press = presses[opener.id];
      if (press && !press.gave && now() - press.at <= OPEN_MS) {
        await write(TAB_PRESS, putEntry(putEntry(presses, opener.id, { ...press, gave: true }), tab.id, { jobId: press.jobId, at: press.at }));
      }
      if (!(await run.opened(tab, opener).catch(() => false))) return;
      const waiting = await read(NEW_TABS);
      const fresh = Object.fromEntries(Object.entries(waiting).filter(([, v]) => now() - v.at < NEW_MS));
      await write(NEW_TABS, { ...fresh, [tab.id]: { at: now(), from: boardOf(opener.url), openerUrl: opener.url, openerId: opener.id } });
    });
  }

  function closed(tabId) {
    return serial(async () => {
      for (const key of [TAB_JOB, TAB_PRESS, NEW_TABS]) {
        const map = await read(key);
        if (map[tabId]) await write(key, putEntry(map, tabId, null));
      }
    });
  }

  return { pressed, carried, question, answer, loaded, opened, closed };
}
