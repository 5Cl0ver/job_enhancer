// The panel's shared state: who's signed in, the saved jobs (a cheap change
// check, never a full-list poll — src/savedSync.js) and the tab beside us.
import * as React from "react";
import { createSavedSync, MIN_INTERVAL_MS } from "../../../src/savedSync.js";
import { detectContext, type PageContext, type SavedJob } from "./context";
import { send, targetTab } from "./chrome";
import { useClaudeUrlState } from "./claudeUrl";

type Auth = { state: "loading" | "in" | "out"; email: string };

/** One field autofill filled, in one frame of the tab (session.js report). */
export interface FillEntry {
  id: string;
  frameId: number;
  label: string;
  kind: string;
  source: "profile" | "learned" | "ai";
  value: string;
  options: string[];
  can_undo: boolean;
  fixed?: boolean;
}
/** A field left for the user, and why. */
export interface FillNeed {
  id: string;
  frameId: number;
  label: string;
  kind: string;
  reason: string;
  options: string[];
  /** An essay answer saved before, offered with "Use saved answer" (spec 018). */
  saved?: string;
}
/** An answer saved automatically on this tab (spec 018), shown with Edit / Undo. */
export interface SavedAnswer {
  question_key: string;
  question_text: string;
  answer: string;
  scope: "all" | "site" | "essay" | "profile";
  site?: string;
  at: number;
}
/** An unsure AI answer, offered with "Use". */
export interface FillSuggestion {
  id: string;
  frameId: number;
  label: string;
  value: string;
}
/** What the user typed that could be remembered (saved only on their press). */
export interface Pending {
  answers: { question_key: string; question_text: string; answer: string }[];
  profile: Record<string, string | number | boolean>;
}
/** What a press is doing, or did (background/fillPresence.js). */
export interface FillStatus {
  phase: "filling" | "done" | "problem";
  done?: number;
  total?: number;
  note?: string;
  filled?: number;
  need?: number;
  /** fields the frames could see (0: blind, even after reading again) */
  seen?: number;
  problem?: "signed_out" | "asleep" | "refresh" | "slow";
  at: number;
}
/** Does the tab have a form (any frame), and the latest status. null: not known yet. */
export interface Presence {
  form: boolean;
  app: boolean;
  fields: number;
  status: FillStatus | null;
}
/** "Point at a box" (spec 017): pointing, or the box clicked (never its value). */
export interface Pick {
  state: "pointing" | "picked";
  at: number;
  frameId?: number;
  site?: string;
  refused?: string;
  field?: { id: string; label: string; kind: string; options: string[] };
  /** What the box holds now (inspect, spec 018) — the user's own panel only. */
  value?: string;
  /** What Job Catcher would put there, and why. */
  known?: { source: "profile" | "learned" | "none"; key: string; value?: string } | null;
  /** The box held something: saved for this box on this site (Undo). */
  autoSaved?: { id: string; answer: string };
  /** The box already holds what Job Catcher would put there. */
  alreadySaved?: boolean;
}
export type Fill = {
  entries: FillEntry[];
  needYou: FillNeed[];
  suggestions: FillSuggestion[];
  frameIds: number[];
  pending: Pending;
  keep: boolean;
  presence: Presence | null;
  pick: Pick | null;
  saved: SavedAnswer[];
};
const NO_FILL: Fill = { entries: [], needYou: [], suggestions: [], frameIds: [], pending: { answers: [], profile: {} }, keep: false, presence: null, pick: null, saved: [] };
type Saved = { jobs: SavedJob[]; loaded: boolean; error: string | null };
type Tab = { id: number | null; url: string; title: string; ctx: PageContext };

interface Panel {
  auth: Auth;
  refreshAuth: () => Promise<void>;
  signedOut: () => void;
  saved: Saved;
  reloadSaved: () => Promise<unknown>;
  tab: Tab;
  refreshTab: () => Promise<void>;
  claudeUrl: string;
  setClaudeUrl: (v: string) => void;
  /** The tailored résumé the next Autofill uploads (its file name), if any. */
  staged: string | null;
  setStaged: (docId: string | null, filename?: string) => Promise<void>;
  /** What autofill did on the tab beside the panel, every frame merged. */
  fill: Fill;
}

const PanelContext = React.createContext<Panel | null>(null);

export function usePanel(): Panel {
  const p = React.useContext(PanelContext);
  if (!p) throw new Error("usePanel outside PanelProvider");
  return p;
}

const NO_TAB: Tab = { id: null, url: "", title: "", ctx: { kind: "none" } };

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = React.useState<Auth>({ state: "loading", email: "" });
  const [saved, setSaved] = React.useState<Saved>({ jobs: [], loaded: false, error: null });
  const [tab, setTab] = React.useState<Tab>(NO_TAB);
  const [claudeUrl, setClaudeUrl] = useClaudeUrlState(auth.state === "in");
  const [staged, setStagedName] = React.useState<string | null>(null);
  const [fill, setFill] = React.useState<Fill>(NO_FILL);
  const tabId = tab.id;

  const fillFor = React.useRef<number | null>(null);
  const loadFill = React.useCallback(async (id: number | null) => {
    fillFor.current = id;
    if (id == null) return setFill(NO_FILL);
    const res = await send({ type: "getFillSession", tabId: id });
    if (fillFor.current !== id) return; // the panel moved to another tab
    const frames = (res?.frames || {}) as Record<
      string,
      { entries?: Omit<FillEntry, "frameId">[]; need_you?: Omit<FillNeed, "frameId">[]; suggestions?: Omit<FillSuggestion, "frameId">[] }
    >;
    const entries: FillEntry[] = [];
    const needYou: FillNeed[] = [];
    const suggestions: FillSuggestion[] = [];
    for (const [fid, f] of Object.entries(frames)) {
      const frameId = Number(fid);
      for (const e of f.entries || []) entries.push({ ...e, frameId });
      for (const n of f.need_you || []) needYou.push({ ...n, frameId });
      for (const g of f.suggestions || []) suggestions.push({ ...g, frameId });
    }
    setFill({
      entries,
      needYou,
      suggestions,
      frameIds: Object.keys(frames).map(Number),
      pending: (res?.pending as Pending) || { answers: [], profile: {} },
      keep: !!res?.keep,
      presence: (res?.presence as Presence) || { form: false, app: false, fields: 0, status: null },
      pick: (res?.pick as Pick) || null,
      saved: (res?.saved as SavedAnswer[]) || [],
    });
  }, []);

  // The tab changed, or one of its frames filled / fixed / undid something.
  React.useEffect(() => {
    setFill(NO_FILL); // "looking at this page" until it answers
    // Ask the tab's frames to report their forms again (a page loaded before
    // the panel opened, or before the extension was updated), then read —
    // never a flash of "no form" on a page that has one.
    if (tabId != null) send({ type: "probeTab", tabId });
    const first = setTimeout(() => loadFill(tabId), tabId != null ? 400 : 0);
    const onMessage = (msg: { type?: string; tabId?: number }) => {
      if (msg?.type === "sessionChanged" && msg.tabId === tabId) loadFill(tabId);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      clearTimeout(first);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [tabId, loadFill]);

  const setStaged = React.useCallback(async (docId: string | null, filename?: string) => {
    try {
      if (docId) await chrome.storage.local.set({ je_staged_resume: { docId, filename } });
      else await chrome.storage.local.remove("je_staged_resume");
      setStagedName(docId ? filename || "resume.pdf" : null);
    } catch {
      /* storage unavailable: Autofill uses the usual résumé */
    }
  }, []);

  const signedOut = React.useCallback(() => {
    setAuth({ state: "out", email: "" });
    setSaved({ jobs: [], loaded: false, error: null });
  }, []);

  const sync = React.useMemo(
    () =>
      createSavedSync({
        fetchSummary: async (version: string | null) => {
          const res = await send({ type: "listSaved", version });
          if (!res) return { signedIn: true, error: "The extension's background didn't answer." };
          if (res.ok === false && res.error) return { signedIn: true, error: res.error };
          return res;
        },
        onJobs: (jobs: object[]) => setSaved({ jobs: jobs as SavedJob[], loaded: true, error: null }),
        onError: (error: string | null) => setSaved((s) => ({ ...s, error })),
        onSignedOut: signedOut,
        isActive: () => document.visibilityState === "visible" && document.hasFocus(),
      }),
    [signedOut],
  );

  const reloadSaved = React.useCallback(() => sync.check({ force: true }), [sync]);

  const refreshAuth = React.useCallback(async () => {
    const res = await send({ type: "authStatus" });
    if (res?.signedIn) {
      setAuth({ state: "in", email: res.email || "" });
      sync.reset();
      sync.check({ force: true });
    } else {
      signedOut();
    }
  }, [sync, signedOut]);

  const refreshTab = React.useCallback(async () => {
    const t = await targetTab();
    const url = t?.url || "";
    const title = t?.title || "";
    setTab((prev) =>
      prev.id === (t?.id ?? null) && prev.url === url && prev.title === title
        ? prev
        : { id: t?.id ?? null, url, title, ctx: detectContext(url) },
    );
  }, []);

  React.useEffect(() => {
    refreshAuth();
    refreshTab();
    send({ type: "refreshAutofillCopy" });
    chrome.storage.local
      .get("je_staged_resume")
      .then(({ je_staged_resume }) => setStagedName((je_staged_resume as { filename?: string } | undefined)?.filename || null))
      .catch(() => {});
    // Saved jobs: a change check on focus / visibility / each minute (skipped
    // unless the panel is visible and focused); saves force one.
    const maybe = () => sync.check();
    document.addEventListener("visibilitychange", maybe);
    window.addEventListener("focus", maybe);
    const minute = setInterval(maybe, MIN_INTERVAL_MS);
    // The tab beside us: switches and page loads (cheap, no API).
    const onActivated = () => refreshTab();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status === "complete" || info.title || info.url) refreshTab();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    const tick = setInterval(refreshTab, 3000);
    // A Save button on a page saved a job: show it.
    const onMessage = (msg: { type?: string }) => {
      if (msg?.type === "jobSaved") sync.check({ force: true });
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      document.removeEventListener("visibilitychange", maybe);
      window.removeEventListener("focus", maybe);
      clearInterval(minute);
      clearInterval(tick);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [refreshAuth, refreshTab, sync]);

  const value = React.useMemo(
    () => ({ auth, refreshAuth, signedOut, saved, reloadSaved, tab, refreshTab, claudeUrl, setClaudeUrl, staged, setStaged, fill }),
    [auth, refreshAuth, signedOut, saved, reloadSaved, tab, refreshTab, claudeUrl, setClaudeUrl, staged, setStaged, fill],
  );
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
