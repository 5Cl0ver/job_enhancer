// The saved job the tab beside the panel is about (context.ts bestJobMatch).
// Two small per-page memories in chrome.storage.local, so every view and
// every panel agrees: the jobs the user said aren't this page ("Not this
// job", undoable), and the job the user saved from this page (always linked).
import * as React from "react";
import { pageId as pageIdOf, postingKey } from "../../../src/autofill/hosts.js";
import { TAB_JOB, boundJobId } from "../../../src/tabJob.js";
import { bestJobMatch, type SavedJob } from "@/lib/context";
import { usePanel } from "@/lib/store";

const NOT_THIS = "je_not_this";
const PINNED = "je_page_job";
const KEEP = 200; // pages remembered; the oldest go first

type NotThis = Record<string, string[]>;
type Pinned = Record<string, string>;
type Carried = Record<string, { jobId: string; at: number; site: string; ids: { strong: string[]; weak: string[] } }>;

/** One page however it's reached: its posting, else its address without the #part. */
export const pageId = (url: string): string => pageIdOf(url);

/** `map` with `page` set to `value` (or removed when undefined), newest last, capped. */
function put<T>(map: Record<string, T>, page: string, value: T | undefined): Record<string, T> {
  const { [page]: _old, ...rest } = map;
  const kept = Object.entries(rest).slice(-(KEEP - 1));
  return value === undefined ? Object.fromEntries(kept) : { ...Object.fromEntries(kept), [page]: value };
}

async function read<T>(key: string): Promise<T> {
  const got = await chrome.storage.local.get(key).catch(() => ({}) as Record<string, unknown>);
  return ((got as Record<string, unknown>)[key] as T) || ({} as T);
}

export interface PageJob {
  match: SavedJob | null;
  /** Saved jobs the user unlinked from this page, to link again. */
  hidden: SavedJob[];
  notThisJob: (id: string) => Promise<void>;
  linkAgain: (id: string) => Promise<void>;
  /** The user saved this page as `id`: link it here from now on. */
  savedHere: (id: string) => Promise<void>;
}

export function usePageJob(): PageJob {
  const { tab, saved } = usePanel();
  const [notThis, setNotThis] = React.useState<NotThis>({});
  const [pinned, setPinned] = React.useState<Pinned>({});
  // The job the user said Yes to for each tab ("Applying for…?", spec 040).
  const [carried, setCarried] = React.useState<Carried>({});
  React.useEffect(() => {
    let live = true;
    read<NotThis>(NOT_THIS).then((v) => live && setNotThis(v));
    read<Pinned>(PINNED).then((v) => live && setPinned(v));
    chrome.storage.session
      ?.get(TAB_JOB)
      .then((got) => live && setCarried(((got as Record<string, unknown>)[TAB_JOB] as Carried) || {}))
      .catch(() => {});
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[TAB_JOB]) setCarried((changes[TAB_JOB].newValue as Carried) || {});
      if (area !== "local") return;
      if (changes[NOT_THIS]) setNotThis((changes[NOT_THIS].newValue as NotThis) || {});
      if (changes[PINNED]) setPinned((changes[PINNED].newValue as Pinned) || {});
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const here = pageId(tab.url);
  const unlinked = notThis[here] || [];
  const carriedId = tab.id != null ? boundJobId(carried[String(tab.id)], tab.url) : null;
  const match = bestJobMatch(tab, saved.jobs, unlinked, pinned[here], carriedId);
  const hidden = saved.jobs.filter((j) => unlinked.includes(j.id) && j.id !== match?.id);

  const setHidden = React.useCallback(
    async (change: (ids: string[]) => string[]) => {
      const current = await read<NotThis>(NOT_THIS);
      const ids = change(current[here] || []);
      const next = put(current, here, ids.length ? ids : undefined);
      setNotThis(next);
      await chrome.storage.local.set({ [NOT_THIS]: next }).catch(() => {});
    },
    [here],
  );
  const setPin = React.useCallback(
    async (id: string | undefined) => {
      const next = put(await read<Pinned>(PINNED), here, id);
      setPinned(next);
      await chrome.storage.local.set({ [PINNED]: next }).catch(() => {});
    },
    [here],
  );

  const notThisJob = React.useCallback(
    async (id: string) => {
      await setHidden((ids) => [...new Set([...ids, id])]);
      if (pinned[here] === id) await setPin(undefined);
    },
    [setHidden, setPin, pinned, here],
  );
  const linkAgain = React.useCallback(async (id: string) => setHidden((ids) => ids.filter((x) => x !== id)), [setHidden]);
  const sure = !!postingKey(tab.url)?.sure;
  const savedHere = React.useCallback(
    async (id: string) => {
      await setHidden((ids) => ids.filter((x) => x !== id));
      // A pin only means something where the address is one posting.
      if (sure) await setPin(id);
    },
    [setHidden, setPin, sure],
  );
  return { match, hidden, notThisJob, linkAgain, savedHere };
}
