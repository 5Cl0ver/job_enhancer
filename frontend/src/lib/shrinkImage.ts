/**
 * A screenshot or phone photo made small enough to send (spec 032, research
 * R1): a JPEG at most 1200 px wide and about 400 KB, the way Job Catcher
 * shrinks its page photos. The server takes up to 1 MB, so this leaves room.
 */

export const MAX_WIDTH = 1200;
export const MAX_BYTES = 400_000;
const QUALITIES = [0.8, 0.65, 0.5, 0.35];
const SENDABLE = ["image/jpeg", "image/png", "image/webp"];

type Drawable = ImageBitmap | HTMLImageElement;

/** The picture, decoded: createImageBitmap where it can, an <img> where it
 * can't (some phone formats). */
async function decode(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
}

/**
 * The picture as a small JPEG, or null when it isn't a picture or can't be
 * made small enough. Without a canvas (very old browsers), a picture that is
 * already small and of a type the server takes goes as it is.
 */
export async function shrinkImage(file: Blob): Promise<Blob | null> {
  if (!file.type.startsWith("image/")) return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext?.("2d");
  if (!ctx) {
    return SENDABLE.includes(file.type) && file.size <= MAX_BYTES ? file : null;
  }
  let img: Drawable;
  try {
    img = await decode(file);
  } catch {
    return null;
  }
  const width = img.width;
  const height = img.height;
  if (!width || !height) return null;
  const scale = Math.min(1, MAX_WIDTH / width);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  // A see-through PNG would turn black as a JPEG: white behind it.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if ("close" in img) img.close();
  for (const quality of QUALITIES) {
    const out = await toBlob(canvas, quality);
    if (out && out.size <= MAX_BYTES) return out;
  }
  return null;
}
