// The user's Claude Project link: one value on the account, shared with the web
// app (edit in either and both update), cached in the extension.
import * as React from "react";
import { send } from "./chrome";

export function useClaudeUrl() {
  const [url, setUrl] = React.useState("");
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const { je_claude_url } = await chrome.storage.local.get("je_claude_url");
      const local = typeof je_claude_url === "string" ? je_claude_url.trim() : "";
      if (alive && local) setUrl(local);
      const r = await send({ type: "getClaudeProjectUrl" });
      const account = r?.ok && typeof r.url === "string" ? r.url : "";
      if (!alive) return;
      if (account) {
        setUrl(account);
        chrome.storage.local.set({ je_claude_url: account });
      } else if (/^https?:\/\//i.test(local)) {
        // Saved here before the account kept it: move it up once.
        send({ type: "saveClaudeProjectUrl", url: local });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = React.useCallback((v: string) => {
    setUrl(v);
    chrome.storage.local.set({ je_claude_url: v.trim() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send({ type: "saveClaudeProjectUrl", url: v.trim() }), 700);
  }, []);

  return [url, save] as const;
}
