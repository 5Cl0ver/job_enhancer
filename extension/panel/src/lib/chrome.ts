// The panel's only ways out: messages to the background (the single API caller)
// and a few tab helpers. Typed loosely: the background's replies are described
// in specs/015-job-catcher-autofill-overhaul/contracts/extension-messages.md.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reply = { ok?: boolean; error?: string; [k: string]: any } | null;

/** Message the background. Never throws: a failure is a null reply. */
export async function send(msg: Record<string, unknown>): Promise<Reply> {
  try {
    return ((await chrome.runtime.sendMessage(msg)) as Reply) ?? null;
  } catch {
    return null;
  }
}

export const appUrl = (): string =>
  (self as unknown as { JOB_ENHANCER_CONFIG?: { APP_URL?: string } }).JOB_ENHANCER_CONFIG?.APP_URL || "";

/**
 * The tab the panel is helping with: the active tab of this window. Tests open
 * the panel as a page and name the tab with ?tab=<id>.
 */
export async function targetTab(): Promise<chrome.tabs.Tab | null> {
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  try {
    if (forced) return await chrome.tabs.get(forced);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

/** Robust copy: the panel can lose focus (e.g. after opening a Claude tab). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function pdfBlobUrl(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

// --- Claude (the user's own) -------------------------------------------------

export const CLAUDE_NEW = "https://claude.ai/new";
const CLAUDE_TABS = ["https://claude.ai/*", "https://*.claude.ai/*"];

async function currentWindowId(): Promise<number | undefined> {
  try {
    return (await chrome.windows.getCurrent()).id;
  } catch {
    return undefined;
  }
}

async function claudeTabs(): Promise<chrome.tabs.Tab[]> {
  const windowId = await currentWindowId();
  try {
    return await chrome.tabs.query(windowId != null ? { url: CLAUDE_TABS, windowId } : { url: CLAUDE_TABS });
  } catch {
    return [];
  }
}

export async function hasClaudeTab(): Promise<boolean> {
  return (await claudeTabs()).length > 0;
}

/** Résumé drafts always land on the user's Claude Project. */
export async function openClaudeProject(projectUrl: string): Promise<"focused" | "navigated" | "opened"> {
  // Only ever a claude.ai address (the account allows nothing else either).
  const url = /^https:\/\/claude\.ai\//i.test(projectUrl) ? projectUrl : CLAUDE_NEW;
  const [existing] = await claudeTabs();
  if (existing?.id) {
    try {
      const base = url.split("?")[0].replace(/\/+$/, "");
      const here = (existing.url || "").replace(/\/+$/, "");
      if (here && here.startsWith(base)) {
        await chrome.tabs.update(existing.id, { active: true });
        return "focused";
      }
      await chrome.tabs.update(existing.id, { url, active: true });
      return "navigated";
    } catch {
      /* the tab closed meanwhile: open a new one */
    }
  }
  await openTab(url);
  return "opened";
}

async function openTab(url: string) {
  const windowId = await currentWindowId();
  try {
    await chrome.tabs.create(windowId != null ? { url, windowId } : { url });
  } catch {
    /* can't open tabs right now; the prompt is still on the clipboard */
  }
}

/** Focus an open Claude tab, or open the user's project. */
export async function openClaude(projectUrl: string): Promise<"focused" | "opened"> {
  const [existing] = await claudeTabs();
  if (existing?.id) {
    try {
      await chrome.tabs.update(existing.id, { active: true });
      return "focused";
    } catch {
      /* the tab closed meanwhile: open a new one */
    }
  }
  await openTab(/^https:\/\/claude\.ai\//i.test(projectUrl) ? projectUrl : CLAUDE_NEW);
  return "opened";
}
