// Tabs and the job a press suggests (spec 040), the background side of
// src/tabJob.js: kept in the session, so a sleeping worker remembers them.
//
// - The user's own press on an Apply, in a page's main frame, on a saved
//   job's own page, is noted for that tab (`press`). An Apply on any other
//   page, another board posting loaded in the tab, or a page that is
//   another saved job's clears or replaces it. The first tab it opens
//   within 20 s takes it over (the board tab keeps none).
// - On the pages after it that are no saved job by themselves, the panel
//   suggests the job (`suggestion`): its Fill button reads "Fill with
//   <job>'s résumé and cover letter"; a press picks the job for THAT fill
//   of THAT page only (`pick`, read by `fillJob`), never anything after.
// - Once, on the first application page, the panel asks "Is this the
//   application for <job>?": Yes teaches the job its company link when the
//   page names its posting; nothing else (`answerLanding`).
// - During Apply with Claude, a tab the application's own tab opens that
//   looks like the application joins the run's tab group and Claude hears
//   of it, as a hint (`run.opened` / `run.landed`).
//
// The panel's reads and answers never wait behind a tab opening (its run
// check can take a while on a sleeping server): only the press bookkeeping
// is one-at-a-time.
import { OPEN_MS, TAB_PRESS, askAbout, boardOf, boardRedirect, fillJobFor, isWebPage, onHub, onJobBoard, pageOf, postingLevelId, putEntry, suggestFor, worthTelling } from "../tabJob.js";
import { postingKey } from "../autofill/hosts.js";

const TAB_PICK = "je_tab_pick"; // tab → the job picked for one fill of one page
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
  // The press bookkeeping, one change at a time (a new tab's first page can
  // load before its opening has been noted). Never network inside.
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
      // A saved job's own page: its press. Anything else: the earlier
      // press is no longer the one (an Apply on another job).
      await set(TAB_PRESS, tab.id, own ? { jobId: own.id, at: now(), page: boardPosting(tab.url) } : null);
    });
  }

  /**
   * What the panel shows on this tab's page, else null:
   * {jobId, page, ask} — `ask`: "Is this the application for <job>?" (once).
   */
  async function suggestion(tab) {
    if (tab?.id == null || !isWebPage(tab.url)) return null;
    const press = (await read(TAB_PRESS))[tab.id];
    if (!press) return null;
    const own = await ownMatch(tab).catch(() => null);
    const jobId = suggestFor(press, tab.url, own?.id || null, now());
    if (!jobId) return null;
    const page = pageOf(tab.url);
    const ask = !press.answered && (press.landing ? press.landing === page : !!askAbout(press, tab.url, null, now()));
    return { jobId, page, ask };
  }

  /** "Is this the application for <job>?" Yes teaches the link (a page naming its posting); either way it's not asked again. */
  async function answerLanding(tab, yes, page) {
    if (tab?.id == null || !isWebPage(tab.url) || !page || pageOf(tab.url) !== page) return { refused: true };
    const offered = await suggestion(tab);
    if (!offered?.ask) return { refused: true };
    const press = (await read(TAB_PRESS))[tab.id];
    await set(TAB_PRESS, tab.id, { ...press, answered: true });
    if (yes && postingLevelId(tab.url)) await learnLink(offered.jobId, tab.url).catch(() => {});
    return { ok: true };
  }

  /** The user pressed "Fill with <job>'s…" (`jobId`), or the usual fill (null), for this page. */
  async function pick(tab, jobId) {
    if (tab?.id == null) return false;
    if (!jobId) {
      await set(TAB_PICK, tab.id, null);
      return true;
    }
    const offered = await suggestion(tab);
    if (offered?.jobId !== jobId) return false; // only the job suggested here
    await set(TAB_PICK, tab.id, { jobId, page: offered.page, at: now() });
    return true;
  }

  /** The saved job this fill of this tab's page uses: its own, else the one just picked for it, else none. */
  async function fillJob(tab, ownJobId) {
    if (tab?.id == null) return ownJobId || null;
    return fillJobFor(ownJobId, (await read(TAB_PICK))[tab.id], tab.url || "", now());
  }

  /** A page finished loading in a tab. */
  async function loaded(tab) {
    if (tab?.id == null || !isWebPage(tab.url)) return; // about:blank: nothing changes
    const opened = await serial(async () => {
      const page = pageOf(tab.url);
      // A pick is for the page it was made on.
      const picked = (await read(TAB_PICK))[tab.id];
      if (picked && picked.page !== page) await set(TAB_PICK, tab.id, null);
      const press = (await read(TAB_PRESS))[tab.id];
      if (press) {
        const own = await ownMatch(tab).catch(() => null);
        const posting = boardPosting(tab.url);
        if ((posting && posting !== press.page) || (own && own.id !== press.jobId)) {
          // Another board posting, or another saved job's own page: that press was for another job.
          await set(TAB_PRESS, tab.id, null);
        } else if (!press.landing && !press.answered && askAbout(press, tab.url, own?.id || null, now())) {
          await set(TAB_PRESS, tab.id, { ...press, landing: page }); // the first application page: asked once
        }
      }
      const waiting = await read(NEW_TABS);
      const hint = waiting[tab.id];
      if (!hint) return null;
      if (onHub(tab.url) && boardRedirect(hint.from, tab.url)) return null; // on its way out
      if (hint.pending) {
        // The run's check is still out: it tells Claude when it's back.
        if (!hint.landed) await write(NEW_TABS, { ...waiting, [tab.id]: { ...hint, landed: { id: tab.id, url: tab.url } } });
        return null;
      }
      const { [tab.id]: _gone, ...rest } = waiting;
      await write(NEW_TABS, rest);
      return hint;
    });
    // The run's hint goes out of the queue (it calls the server).
    if (opened && !onHub(tab.url) && now() - opened.at <= NEW_MS && worthTelling(opened.openerUrl, tab.url)) {
      await run.landed(tab, opened.openerId).catch(() => {});
    }
  }

  /** A tab opened from another one. */
  async function opened(tab) {
    if (tab?.id == null || tab.openerTabId == null) return;
    const opener = await c.tabs.get(tab.openerTabId).catch(() => null);
    if (!opener?.url) return;
    // A press made in this very tab, never one it was handed, goes with
    // the first tab it opens, and only there.
    await serial(async () => {
      const presses = await read(TAB_PRESS);
      const press = presses[opener.id];
      if (press && !press.handed && now() - press.at <= OPEN_MS) {
        const { page: _page, ...carry } = press;
        await write(TAB_PRESS, putEntry(putEntry(presses, opener.id, null), tab.id, { ...carry, handed: true }));
      }
    });
    // The run's check calls the server: out of the queue. Its hint waits
    // meanwhile, so a first page that loads first isn't missed.
    await serial(async () => {
      const waiting = await read(NEW_TABS);
      const fresh = Object.fromEntries(Object.entries(waiting).filter(([, v]) => now() - v.at < NEW_MS));
      await write(NEW_TABS, { ...fresh, [tab.id]: { at: now(), from: boardOf(opener.url), openerUrl: opener.url, openerId: opener.id, pending: true } });
    });
    const ours = await run.opened(tab, opener).catch(() => false);
    const landed = await serial(async () => {
      const waiting = await read(NEW_TABS);
      const hint = waiting[tab.id];
      if (!hint) return null;
      if (!ours || hint.landed) {
        const { [tab.id]: _gone, ...rest } = waiting;
        await write(NEW_TABS, rest);
        return ours ? hint : null;
      }
      await write(NEW_TABS, { ...waiting, [tab.id]: { ...hint, pending: false } });
      return null;
    });
    const at = landed?.landed;
    if (at && !onHub(at.url) && now() - landed.at <= NEW_MS && worthTelling(landed.openerUrl, at.url)) {
      await run.landed({ ...tab, id: at.id, url: at.url }, landed.openerId).catch(() => {});
    }
  }

  function closed(tabId) {
    return serial(async () => {
      for (const key of [TAB_PRESS, TAB_PICK, NEW_TABS]) {
        const map = await read(key);
        if (map[tabId]) await write(key, putEntry(map, tabId, null));
      }
    });
  }

  return { pressed, suggestion, answerLanding, pick, fillJob, loaded, opened, closed };
}
