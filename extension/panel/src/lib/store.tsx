// The panel's shared state: who's signed in, the saved jobs (a cheap change
// check, never a full-list poll — src/savedSync.js) and the tab beside us.
import * as React from "react";
import { createSavedSync, MIN_INTERVAL_MS } from "../../../src/savedSync.js";
import { detectContext, type PageContext, type SavedJob } from "./context";
import { send, targetTab } from "./chrome";
import { useClaudeUrlState } from "./claudeUrl";

type Auth = { state: "loading" | "in" | "out"; email: string };
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
    () => ({ auth, refreshAuth, signedOut, saved, reloadSaved, tab, refreshTab, claudeUrl, setClaudeUrl, staged, setStaged }),
    [auth, refreshAuth, signedOut, saved, reloadSaved, tab, refreshTab, claudeUrl, setClaudeUrl, staged, setStaged],
  );
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
