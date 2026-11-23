// The user's Claude Project link: one value on the account, shared with the web
// app (edit in either and both update), cached in the extension. Held once in
// the panel's store (lib/store.tsx), loaded once per sign-in.
import * as React from "react";
import { send } from "./chrome";

export function useClaudeUrlState(signedIn: boolean) {
  const [url, setUrl] = React.useState("");
  const typed = React.useRef(false); // the user has edited it this session
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    (async () => {
      let local = "";
      try {
        const { je_claude_url } = await chrome.storage.local.get("je_claude_url");
        local = typeof je_claude_url === "string" ? je_claude_url.trim() : "";
      } catch {
        /* storage unavailable: the account's value still loads */
      }
      if (alive && local && !typed.current) setUrl(local);
      const r = await send({ type: "getClaudeProjectUrl" });
      if (!alive || typed.current) return; // never overwrite what the user is typing
      if (r?.ok !== true || typeof r.url !== "string") return; // unknown: change nothing
      if (r.url) {
        setUrl(r.url);
        chrome.storage.local.set({ je_claude_url: r.url }).catch(() => {});
      } else if (/^https?:\/\//i.test(local)) {
        // The account answered that it has none, and this extension had one
        // from before the account kept it: move it up, once.
        send({ type: "saveClaudeProjectUrl", url: local });
      }
    })();
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const save = React.useCallback((v: string) => {
    typed.current = true;
    setUrl(v);
    chrome.storage.local.set({ je_claude_url: v.trim() }).catch(() => {});
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send({ type: "saveClaudeProjectUrl", url: v.trim() }), 700);
  }, []);

  return [url, save] as const;
}
