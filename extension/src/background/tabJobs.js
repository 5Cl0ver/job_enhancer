// Tabs and the jobs they apply for (spec 040), the background side of
// src/tabJob.js: kept in the session, so a sleeping worker remembers them.
//
// - The user's own press on an Apply, in a page's main frame, is noted for
//   that tab (`press`) when the page is a saved job's own, or a page the
//   user already said is that job's (two hops: the company's careers page,
//   then its applicant system). Any other press, or another board posting
//   loaded in the tab, clears it. The first tab it opens within 20 s takes
//   it over (the board tab keeps none).
// - On the next application page that is no saved job by itself, the side
//   panel asks "Applying for <job>?" (`question`). Yes, on the page asked
//   about, binds the tab to the job and, when the page names its posting by
//   a strong id, teaches the job its company link; No just ends it. Either
//   way the press is used up.
// - The binding holds on pages surely of that posting; on the same
//   company's site but not surely the same posting the panel asks "Still
//   applying for…?" (the job unused till Yes); anything else drops it.
// - During Apply with Claude, a tab the application's own tab opens that
//   looks like the application joins the run's tab group and Claude hears
//   of it, as a hint (`run.opened` / `run.landed`).
import { OPEN_MS, TAB_JOB, TAB_PRESS, askAbout, askingHere, bindHere, boardOf, boardRedirect, boundJobId, confirmBinding, isWebPage, judgeBinding, onHub, onJobBoard, postingIds, putEntry, worthTelling } from "../tabJob.js";
import { pageId, postingKey } from "../autofill/hosts.js";

const NEW_TABS = "je_new_tabs"; // run hints waiting for their tab's first page
const NEW_MS = 60_000;

/** The board posting a page is, if any (another one loaded clears a press). */
const boardPosting = (url) => (onJobBoard(url) && postingKey(url)?.sure ? postingKey(url).key : null);

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

  /** The user pressed an Apply in this tab's main frame. */
  function pressed(tab, frameId) {
    return serial(async () => {
      if (tab?.id == null || frameId !== 0 || !isWebPage(tab.url)) return;
      const own = await ownMatch(tab).catch(() => null);
      // A page the user already said is a job's: the next hop asks again.
      const bound = own ? null : boundJobId((await read(TAB_JOB))[tab.id], tab.url, now());
      const jobId = own?.id || bound;
      // An Apply for anything else: the earlier press is no longer the one.
      await set(TAB_PRESS, tab.id, jobId ? { jobId, at: now(), page: boardPosting(tab.url), again: !own } : null);
    });
  }

  /** The job bound to this tab's page (the user said Yes), else null. */
  async function carried(tab) {
    if (tab?.id == null) return null;
    return boundJobId((await read(TAB_JOB))[tab.id], tab.url || "", now());
  }

  /**
   * What the panel asks on this tab's page, else null: {jobId, again, page}.
   * `again`: "Still applying for…?" (the binding is unsure, or a second hop).
   */
  async function question(tab) {
    if (tab?.id == null || !isWebPage(tab.url)) return null;
    const bound = (await read(TAB_JOB))[tab.id];
    if (bound && askingHere(bound, tab.url)) return { jobId: bound.jobId, again: true, page: pageId(tab.url) };
    if ((await carried(tab)) != null) return null;
    const press = (await read(TAB_PRESS))[tab.id];
    if (!press) return null;
    const own = await ownMatch(tab).catch(() => null);
    const jobId = askAbout(press, tab.url, own?.id || null, now());
    return jobId ? { jobId, again: !!press.again, page: pageId(tab.url) } : null;
  }

  /**
   * The user's answer about `page` (the page the panel asked about). Only on
   * that page: the tab moved on and nothing is bound (the panel asks again).
   */
  function answer(tab, yes, page) {
    return serial(async () => {
      if (tab?.id == null || !isWebPage(tab.url)) return { refused: true };
      if (!page || pageId(tab.url) !== page) return { refused: true };
      const bound = (await read(TAB_JOB))[tab.id];
      if (bound && askingHere(bound, tab.url)) {
        // "Still applying for…?"
        await set(TAB_JOB, tab.id, yes ? confirmBinding(bound, tab.url, now()) : null);
        if (!yes) await set(TAB_PRESS, tab.id, null);
        return { jobId: yes ? bound.jobId : null };
      }
      const press = (await read(TAB_PRESS))[tab.id];
      const own = await ownMatch(tab).catch(() => null);
      const jobId = askAbout(press, tab.url, own?.id || null, now());
      await set(TAB_PRESS, tab.id, null); // used up
      if (!jobId || !yes) return { jobId: null };
      await set(TAB_JOB, tab.id, bindHere(jobId, tab.url, now()));
      if (postingIds(tab.url).strong.length) await learnLink(jobId, tab.url).catch(() => {});
      return { jobId };
    });
  }

  /** The user is working on the bound application (a fill, the panel): its 45 minutes restart. */
  function touch(tabId) {
    return serial(async () => {
      const bound = (await read(TAB_JOB))[tabId];
      if (bound && !bound.asking) await set(TAB_JOB, tabId, { ...bound, at: now() });
    });
  }

  /** A page finished loading in a tab. */
  function loaded(tab) {
    return serial(async () => {
      if (tab?.id == null || !isWebPage(tab.url)) return; // about:blank: nothing changes
      const bound = (await read(TAB_JOB))[tab.id];
      if (bound) {
        const { verdict, bound: next } = judgeBinding(bound, tab.url, now());
        if (verdict === "drop") {
          await set(TAB_JOB, tab.id, null);
          // Off the application: no question until a new press (an Apply
          // pressed on the bound page is one: the next hop asks again).
          const press = (await read(TAB_PRESS))[tab.id];
          if (press && !press.again) await set(TAB_PRESS, tab.id, null);
        } else if (verdict !== "same") await set(TAB_JOB, tab.id, next);
      }
      // Another board posting in the pressed tab: that press was for another job.
      const press = (await read(TAB_PRESS))[tab.id];
      const posting = boardPosting(tab.url);
      if (press && posting && posting !== press.page) await set(TAB_PRESS, tab.id, null);

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
      // A press just made in the opener goes with the first tab it opens,
      // and only there.
      // A press made in this very tab, never one it was handed.
      const presses = await read(TAB_PRESS);
      const press = presses[opener.id];
      if (press && !press.handed && now() - press.at <= OPEN_MS) {
        const { page: _page, ...carry } = press;
        await write(TAB_PRESS, putEntry(putEntry(presses, opener.id, null), tab.id, { ...carry, handed: true }));
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

  return { pressed, carried, question, answer, touch, loaded, opened, closed };
}
