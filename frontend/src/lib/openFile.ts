import { API_BASE, getAccessToken } from "@/lib/api";

// What a browser tab can show by itself. Anything else (a .docx) is downloaded.
const VIEWABLE = /^(application\/pdf|image\/|text\/plain)/;
// Long enough to reload or save from the viewer tab; then the memory is freed.
const KEEP_MS = 10 * 60_000;

function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * Show one of the user's own files (a resume). The API needs the sign-in
 * token, which a plain link can't send, so the file is fetched and shown from
 * memory. A PDF opens in a new tab (opened during the click: browsers block
 * tabs opened after a wait). A file a tab can't show, or any file when pop-ups
 * are blocked, is downloaded instead. The app's own page is never replaced.
 */
export async function openOwnFile(
  path: string,
  filename = "resume",
): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const token = await getAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Couldn't open the file (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (tab && VIEWABLE.test(blob.type)) {
      tab.location.href = url;
    } else {
      tab?.close();
      download(url, filename);
    }
    window.setTimeout(() => URL.revokeObjectURL(url), KEEP_MS);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
