import { API_BASE, getAccessToken } from "@/lib/api";

/**
 * Open one of the user's own files (a resume) in a new tab. The API needs the
 * sign-in token, which a plain link can't send, so the file is fetched and
 * shown from memory. The tab is opened first, during the click, because
 * browsers block tabs opened after a wait.
 */
export async function openOwnFile(path: string): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const token = await getAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Couldn't open the file (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url; // pop-ups blocked: open it here
    // The tab has loaded it by then; free the memory.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
