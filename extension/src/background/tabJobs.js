// Tabs and the jobs they apply for (spec 040), the background side of
// src/tabJob.js: kept in the session, so a sleeping worker remembers them.
//
// - A page that is a saved job's own (its listing, its company application)
//   marks its tab with that job; pages after it in the tab, and tabs it opens,
//   carry the job (src/tabJob.js says for how long and where it ends).
// - A tab a job board's listing opens (LinkedIn's "Apply on company website"
//   is a button with no address to read): its first page off the board is
//   the company's application. The job learns that link (once), and during an
//   Apply with Claude run the tab joins the run's tab group at once and
//   Claude hears its address.
import { TAB_JOB, carriedJobId, nextEntry, onHub, onJobBoard, putEntry } from "../tabJob.js";

const NEW_TABS = "je_new_tabs";
const NEW_MS = 60_000; // a new tab's first real page must come within this

/**
 * @param {{
 *   ownMatch: (tab: chrome.tabs.Tab) => Promise<{id: string}|null>,
 *   learnLink?: (jobId: string, url: string) => Promise<unknown>,
 *   run?: { opened: (tab: chrome.tabs.Tab, opener: chrome.tabs.Tab) => Promise<boolean>, landed: (tab: chrome.tabs.Tab) => Promise<unknown> },
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

  /** The job carried to this tab's page, else null. */
  async function carried(tab) {
    if (tab?.id == null) return null;
    return carriedJobId((await read(TAB_JOB))[tab.id], tab.url || "", now());
  }

  /** A page finished loading in a tab. */
  function loaded(tab) {
    return serial(async () => {
      if (tab?.id == null || !tab.url) return;
      const own = await ownMatch(tab).catch(() => null);
      const map = await read(TAB_JOB);
      const before = map[tab.id] || null;
      const next = nextEntry(before, tab.url, own?.id || null, now());
      if (JSON.stringify(next) !== JSON.stringify(before)) await write(TAB_JOB, putEntry(map, tab.id, next));
      const waiting = await read(NEW_TABS);
      const opened = waiting[tab.id];
      if (!opened || !/^https?:/i.test(tab.url) || onHub(tab.url)) return;
      const { [tab.id]: _gone, ...rest } = waiting;
      await write(NEW_TABS, rest);
      if (now() - opened.at > NEW_MS) return;
      if (opened.boardJobId) await learnLink(opened.boardJobId, tab.url).catch(() => {});
      if (opened.run) await run.landed(tab).catch(() => {});
    });
  }

  /** A tab opened from another one. */
  function opened(tab) {
    return serial(async () => {
      if (tab?.id == null || tab.openerTabId == null) return;
      const opener = await c.tabs.get(tab.openerTabId).catch(() => null);
      if (!opener?.url) return;
      const own = await ownMatch(opener).catch(() => null);
      const map = await read(TAB_JOB);
      const from = map[opener.id];
      const jobId = own?.id || carriedJobId(from, opener.url, now());
      if (jobId) await write(TAB_JOB, putEntry(map, tab.id, { jobId, at: own ? now() : from.at, opened: true }));
      const boardJobId = own && onJobBoard(opener.url) ? own.id : null;
      const ran = await run.opened(tab, opener).catch(() => false);
      if (!boardJobId && !ran) return;
      const waiting = await read(NEW_TABS);
      // Old ones go: a tab that never left about:blank.
      const fresh = Object.fromEntries(Object.entries(waiting).filter(([, v]) => now() - v.at < NEW_MS));
      await write(NEW_TABS, { ...fresh, [tab.id]: { at: now(), boardJobId, run: !!ran } });
    });
  }

  function closed(tabId) {
    return serial(async () => {
      const map = await read(TAB_JOB);
      if (map[tabId]) await write(TAB_JOB, putEntry(map, tabId, null));
      const waiting = await read(NEW_TABS);
      if (waiting[tabId]) {
        const { [tabId]: _gone, ...rest } = waiting;
        await write(NEW_TABS, rest);
      }
    });
  }

  return { carried, loaded, opened, closed };
}
