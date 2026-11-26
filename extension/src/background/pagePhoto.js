// A photo of the visible tab, shrunk for the app: Apply with Claude's page
// photos (spec 022) and the owner's "Report a problem here" (spec 032) share
// it. Chrome allows 2 captures a second across the whole extension, so every
// capture notes its time and `captureSlot` waits for the next free one.

export const CAPTURE_GAP_MS = 550; // Chrome allows 2 captures a second
const MAX_WIDTH = 1200;
const MAX_BYTES = 390_000;

let lastCapture = 0;

/** Wait until a capture is allowed again (the last one was ≥ 550 ms ago). */
export async function captureSlot() {
  const wait = CAPTURE_GAP_MS - (Date.now() - lastCapture);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** The window's visible tab as a JPEG under 400 KB, or null (hidden, minimised). */
export async function capture(c, windowId) {
  let url;
  lastCapture = Date.now();
  try {
    url = await c.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 70 });
  } catch {
    return null; // the window is hidden or minimised
  }
  const blob = await (await fetch(url)).blob();
  return shrink(blob);
}

/** At most 1200 px wide and under the app's 400 KB, as JPEG. */
export async function shrink(blob) {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    return blob.size <= MAX_BYTES ? blob : null;
  }
  const img = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_WIDTH / img.width);
  const canvas = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  for (const quality of [0.6, 0.45, 0.3]) {
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (out.size <= MAX_BYTES) return out;
  }
  return null;
}
