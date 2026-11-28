// Tabs and the job a press suggests (spec 040), the background side of
// src/tabJob.js: kept in the session, so a sleeping worker remembers them.
//
// - The user's own press on an Apply, in a page's main frame, on a saved
//   job's own page, is noted for that tab (`press`). An Apply on another
//   job's board posting, another board posting loaded in the tab, a page
//   that is another saved job's, or the same company's site naming another
//   posting clears or replaces it (the company site's own Apply keeps it). The first tab it opens
//   within 20 s takes it over (the board tab keeps none).
// - On the pages after it that are no saved job by themselves (once the
//   application's first page is known, only on its company's site), the
//   panel suggests the job (`suggestion`): two equal buttons, "Use <job>'s…"
//   and "Use my usual résumé". A press picks for THAT press's fill only
//   (`pick` → a nonce the fill carries, `fillJob`, `endPick`); without a
//   choice (an automatic fill) the résumé and letter boxes are left
//   (`holdsFiles`). A Submit there ends it (`submitted`).
// - Once, on the first page naming its posting, the panel asks "Is this
//   the application for <job>?": Yes teaches the job its company link;
//   nothing else (`answerLanding`).
// - During Apply with Claude, a tab the application's own tab opens that
//   looks like the application joins the run's tab group and Claude hears
//   of it, as a hint (`run.opened` / `run.landed`).
//
// The panel's reads and answers never wait behind a tab opening (its run
// check can take a while on a sleeping server): only the press bookkeeping
// is one-at-a-time.
import { OPEN_MS, TAB_PRESS, askAbout, boardOf, boardRedirect, fillJobFor, holdFiles, isWebPage, looksLikeApplication, onHub, onJobBoard, pageOf, postingLevelId, putEntry, siteOf, suggestFor, worthTelling } from "../tabJob.js";
import { applicantHost, isApplyUrl, postingKey } from "../autofill/hosts.js";

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
      if (own) {
        // A saved job's own page: its press (another saved job's replaces it).
        await set(TAB_PRESS, tab.id, { jobId: own.id, at: now(), page: boardPosting(tab.url) });
      } else if (onJobBoard(tab.url)) {
        // An Apply on another job's board posting: the earlier press is no longer the one.
        await set(TAB_PRESS, tab.id, null);
      }
      // The company site's own Apply (Workday's, Greenhouse's…): the same
      // application going on, the press stays.
    });
  }

  /**
   * What the panel shows on this tab's page, else null:
   * {jobId, page, ask, problem} — `ask`: "Is this the application for
   * <job>?" (once); `problem`: the job's files didn't load for the last fill.
   */
  async function suggestion(tab) {
    if (tab?.id == null || !isWebPage(tab.url)) return null;
    const press = (await read(TAB_PRESS))[tab.id];
    if (!press) return null;
    const own = await ownMatch(tab).catch(() => null);
    const jobId = suggestFor(press, tab.url, own?.id || null, now());
    if (!jobId) return null;
    const page = pageOf(tab.url);
    const ask = !press.answered && !!askAbout(press, tab.url, null, now()) && (!press.asking || press.asking === page);
    return { jobId, page, ask, ...(press.problem ? { problem: press.problem } : {}) };
  }

  /**
   * "Is this the application for <job>?" Yes teaches the link (a page naming
   * its posting); either way it's not asked again. `linkFailed`: the app
   * couldn't save it (the panel says so).
   */
  async function answerLanding(tab, yes, page) {
    if (tab?.id == null || !isWebPage(tab.url) || !page || pageOf(tab.url) !== page) return { refused: true };
    const offered = await suggestion(tab);
    if (!offered?.ask) return { refused: true };
    const press = (await read(TAB_PRESS))[tab.id];
    await set(TAB_PRESS, tab.id, { ...press, answered: true });
    if (!yes || !postingLevelId(tab.url)) return { ok: true };
    const saved = await learnLink(offered.jobId, tab.url).catch(() => false);
    return saved === false ? { ok: true, linkFailed: true } : { ok: true };
  }

  /**
   * The user's choice for ONE press of Fill on this page: the suggested
   * job's files (`jobId`) or the usual ones (null). Returns the press's
   * nonce (only the fill it starts honours it), or null when refused.
   */
  async function pick(tab, jobId) {
    if (tab?.id == null || !isWebPage(tab.url)) return null;
    const offered = await suggestion(tab);
    if (jobId && offered?.jobId !== jobId) return null; // only the job suggested here
    const nonce = Math.random().toString(36).slice(2) + now().toString(36);
    await set(TAB_PICK, tab.id, { jobId: jobId || null, page: pageOf(tab.url), nonce, at: now() });
    if (offered?.problem) {
      const press = (await read(TAB_PRESS))[tab.id];
      if (press) await set(TAB_PRESS, tab.id, { ...press, problem: null });
    }
    return nonce;
  }

  /** That press's fill is over: its choice is used up. */
  async function endPick(tabId, nonce) {
    const held = (await read(TAB_PICK))[tabId];
    if (held && held.nonce === nonce) await set(TAB_PICK, tabId, null);
  }

  /** The saved job this fill uses: the page's own, else the one picked for this press (`nonce`), else none. */
  async function fillJob(tab, ownJobId, nonce) {
    if (tab?.id == null) return ownJobId || null;
    return fillJobFor(ownJobId, (await read(TAB_PICK))[tab.id], tab.url || "", nonce, now());
  }

  /** Leave the résumé and cover-letter boxes alone on this fill? (A job is suggested and no choice was made for it.) */
  async function holdsFiles(tab, nonce) {
    if (tab?.id == null) return false;
    const offered = await suggestion(tab).catch(() => null);
    return holdFiles(!!offered, (await read(TAB_PICK))[tab.id], nonce);
  }

  /** The suggested job's files couldn't be used for that fill: the panel says so. */
  async function noteProblem(tabId, problem) {
    const press = (await read(TAB_PRESS))[tabId];
    if (press) await set(TAB_PRESS, tabId, { ...press, problem });
  }

  /** The address changed (any part of it, #part too): a choice is for the page it was made on. */
  async function moved(tabId) {
    const held = (await read(TAB_PICK))[tabId];
    if (held) await set(TAB_PICK, tabId, null);
  }

  /** The job was submitted (or its confirmation seen) in this tab: the suggestion ends. */
  function submitted(tabId) {
    return serial(async () => {
      if ((await read(TAB_PRESS))[tabId]) await set(TAB_PRESS, tabId, null);
    });
  }

  /** A page finished loading in a tab. */
  async function loaded(tab) {
    if (tab?.id == null || !isWebPage(tab.url)) return; // about:blank: nothing changes
    const opened = await serial(async () => {
      const page = pageOf(tab.url);
      // A choice is for the page it was made on.
      const picked = (await read(TAB_PICK))[tab.id];
      if (picked && picked.page !== page) await set(TAB_PICK, tab.id, null);
      const press = (await read(TAB_PRESS))[tab.id];
      if (press) {
        const own = await ownMatch(tab).catch(() => null);
        const posting = boardPosting(tab.url);
        const level = postingLevelId(tab.url);
        if ((posting && posting !== press.page) || (own && own.id !== press.jobId)) {
          // Another board posting, or another saved job's own page: that press was for another job.
          await set(TAB_PRESS, tab.id, null);
        } else if (press.landingPosting && level && level !== press.landingPosting && siteOf(tab.url) === press.landingSite) {
          // The same company's site naming another posting: another job.
          await set(TAB_PRESS, tab.id, null);
        } else if (!press.landingSite && suggestFor(press, tab.url, own?.id || null, now()) && (applicantHost(tab.url) || isApplyUrl(tab.url) || looksLikeApplication(tab.url))) {
          // The application's first page: its company's site from now on,
          // and (when it names its posting) the one the link question is about.
          await set(TAB_PRESS, tab.id, { ...press, landingSite: siteOf(tab.url), ...(level ? { landingPosting: level, asking: page } : {}) });
        } else if (press.landingSite && !press.landingPosting && level && siteOf(tab.url) === press.landingSite) {
          await set(TAB_PRESS, tab.id, { ...press, landingPosting: level, asking: page });
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

  return { pressed, suggestion, answerLanding, pick, endPick, fillJob, holdsFiles, noteProblem, moved, submitted, loaded, opened, closed };
}
