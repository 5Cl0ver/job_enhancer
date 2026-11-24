// The saved job the tab beside the panel is about (context.ts bestJobMatch),
// minus the ones the user said aren't it ("Not this job"). Those are kept per
// page in chrome.storage.local, so every view and every panel agrees.
import * as React from "react";
import { postingKey } from "../../../src/autofill/hosts.js";
import { bestJobMatch, type SavedJob } from "@/lib/context";
import { usePanel } from "@/lib/store";

const KEY = "je_not_this";
const KEEP = 200; // pages remembered; the oldest go first

type NotThis = Record<string, string[]>;

/** One page however it's reached: its posting, else its address without the #part. */
export const pageId = (url: string) => postingKey(url)?.key || (url || "").split("#")[0];

export function usePageJob(): { match: SavedJob | null; notThisJob: (id: string) => Promise<void> } {
  const { tab, saved } = usePanel();
  const [all, setAll] = React.useState<NotThis>({});
  React.useEffect(() => {
    let live = true;
    chrome.storage.local
      .get(KEY)
      .then((got) => live && setAll((got[KEY] as NotThis) || {}))
      .catch(() => {});
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[KEY]) setAll((changes[KEY].newValue as NotThis) || {});
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const here = pageId(tab.url);
  const match = bestJobMatch(tab, saved.jobs, all[here] || []);

  const notThisJob = React.useCallback(
    async (id: string) => {
      const got = await chrome.storage.local.get(KEY).catch(() => ({}) as Record<string, unknown>);
      const current = ((got as Record<string, unknown>)[KEY] as NotThis) || {};
      const { [here]: mine = [], ...rest } = current;
      const kept = Object.entries(rest).slice(-(KEEP - 1));
      const next: NotThis = { ...Object.fromEntries(kept), [here]: [...new Set([...mine, id])] };
      setAll(next);
      await chrome.storage.local.set({ [KEY]: next }).catch(() => {});
    },
    [here],
  );
  return { match, notThisJob };
}
