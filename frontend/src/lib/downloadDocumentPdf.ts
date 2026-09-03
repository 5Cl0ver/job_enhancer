import { api } from "@/lib/api";

/**
 * Download a generated document's PDF.
 *
 * The PDF endpoint requires the Supabase Bearer token, which `window.open` and
 * `<a download>` can't send — so fetch it as an authenticated blob and hand the
 * browser an object URL instead.
 *
 * The object URL is revoked on a later tick, not immediately after `click()`:
 * several browsers (mobile Safari among them) read the blob asynchronously, and
 * revoking synchronously makes the download fail silently — no error to catch,
 * no file saved. Since this is the path phones use, the delay matters.
 */
export async function downloadDocumentPdf(docId: string, filename: string): Promise<void> {
  const blob = await api.getBlob(`/v1/ai/documents/${docId}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
