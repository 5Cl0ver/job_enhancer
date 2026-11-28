// Tabs and the jobs they apply for (spec 040), the background side of
// src/tabJob.js: kept in the session, so a sleeping worker remembers them.
//
// - A page that is a saved job's own (its listing, its company application)
//   marks its tab with that job; right after the user presses an Apply that
//   leaves (`arm`), the next site in the tab, or a tab it opens, carries the
//   job (src/tabJob.js says for how long and where it ends).
// - A tab a job board's listing opens (LinkedIn's "Apply on company website"
//   is a button with no address to read): after an Apply press there, its
//   first page off the board, within a minute, with nothing else on a board
//   in between, is the company's application. The job learns that link (the
//   server checks again; a link the user set is never replaced). During Apply with Claude, a tab the application's own tab
//   opens that looks like the application joins the run's tab group and
//   Claude hears of it (a hint: Claude decides).
import { ARM_MS, TAB_JOB, boardRedirect, carriedJobId, definitePosting, isWebPage, looksLikeApplication, nextEntry, onHub, onJobBoard, putEntry, siteOf, worthTelling } from "../tabJob.js";

const NEW_TABS = "je_new_tabs";
const ARMED = "je_armed"; // tab → when the user last pressed an Apply that leaves
const ARM_WAIT_MS = 1_000; // a new tab can open before its opener's press is heard
const NEW_MS = 60_000; // a new tab's first real page must come within this

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

  /** The user pressed an Apply that leaves, in this tab. */
  async function arm(tabId) {
    if (tabId == null) return;
    const held = await read(ARMED);
    const fresh = Object.fromEntries(Object.entries(held).filter(([, at]) => now() - at < ARM_MS));
    await write(ARMED, { ...fresh, [tabId]: now() });
  }

  async function armed(tabId) {
    const at = (await read(ARMED))[tabId];
    return at != null && now() - at <= ARM_MS;
  }

  /** The job carried to this tab's page, else null. */
  async function carried(tab) {
    if (tab?.id == null) return null;
    return carriedJobId((await read(TAB_JOB))[tab.id], tab.url || "", now());
  }

  /** A page finished loading in a tab. */
  function loaded(tab) {
    return serial(async () => {
      // about:blank, chrome://: nothing changes.
      if (tab?.id == null || !isWebPage(tab.url)) return;
      const own = await ownMatch(tab).catch(() => null);
      const map = await read(TAB_JOB);
      const before = map[tab.id] || null;
      const next = nextEntry(before, tab.url, own?.id || null, now(), { armed: await armed(tab.id) });
      // (`next` also says whether the learn below is still this job's.)
      if (JSON.stringify(next) !== JSON.stringify(before)) await write(TAB_JOB, putEntry(map, tab.id, next));
      const waiting = await read(NEW_TABS);
      const opened = waiting[tab.id];
      if (!opened) return;
      // The board's own redirect on the way out: still waiting.
      if (onHub(tab.url) && boardRedirect(opened.from, tab.url)) return;
      const { [tab.id]: _gone, ...rest } = waiting;
      await write(NEW_TABS, rest);
      // Anything else on a board (another posting), a search: not the Apply.
      if (onHub(tab.url) || now() - opened.at > NEW_MS) return;
      // The job's own listing opened the company's application, and nothing
      // else came between: the job learns that link (an address naming one
      // posting only).
      if (opened.boardJobId && next?.jobId === opened.boardJobId && definitePosting(tab.url) && looksLikeApplication(tab.url)) {
        await learnLink(opened.boardJobId, tab.url).catch(() => {});
      }
      if (opened.run && worthTelling(opened.openerUrl, tab.url)) await run.landed(tab, opened.openerId).catch(() => {});
    });
  }

  /** A tab opened from another one. */
  function opened(tab) {
    return serial(async () => {
      if (tab?.id == null || tab.openerTabId == null) return;
      const opener = await c.tabs.get(tab.openerTabId).catch(() => null);
      if (!opener?.url) return;
      const own = await ownMatch(opener).catch(() => null);
      // Only right after an Apply press in the opener (heard a moment late,
      // sometimes): a middle-clicked link, an ad, a tab of the user's own,
      // never carry the job or teach it a link.
      const map = await read(TAB_JOB);
      const from = map[opener.id];
      const site = siteOf(opener.url);
      const job = own || carriedJobId(from, opener.url, now());
      let pressed = await armed(opener.id);
      for (let i = 0; job && !pressed && i < ARM_WAIT_MS / 200; i++) {
        await new Promise((r) => setTimeout(r, 200));
        pressed = await armed(opener.id);
      }
      const entry = !pressed ? null : own ? nextEntry(null, opener.url, own.id, now()) : carriedJobId(from, opener.url, now()) ? from : null;
      if (entry) await write(TAB_JOB, putEntry(map, tab.id, { ...entry, opened: true, from: site }));
      // Only the job's own listing on a board can teach the job its link.
      const boardJobId = pressed && own && onJobBoard(opener.url) && definitePosting(opener.url) ? own.id : null;
      const ran = await run.opened(tab, opener).catch(() => false);
      if (!boardJobId && !ran) return;
      const waiting = await read(NEW_TABS);
      // Old ones go: a tab that never left about:blank.
      const fresh = Object.fromEntries(Object.entries(waiting).filter(([, v]) => now() - v.at < NEW_MS));
      await write(NEW_TABS, { ...fresh, [tab.id]: { at: now(), from: site, openerUrl: opener.url, openerId: opener.id, boardJobId, run: !!ran } });
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

  return { arm, carried, loaded, opened, closed };
}
