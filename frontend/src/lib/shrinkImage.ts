/**
 * A screenshot or phone photo made small enough to send (spec 032, research
 * R1): a JPEG at most 1200 px wide, 4000 px tall and 12 million pixels, and
 * about 400 KB, the way Job Catcher shrinks its page photos. The server takes
 * up to 1 MB, so this leaves room. A very tall screenshot is shrunk to fit
 * too (phones refuse canvases much bigger than that).
 */

export const MAX_WIDTH = 1200;
export const MAX_HEIGHT = 4000;
export const MAX_PIXELS = 12_000_000;
export const MAX_BYTES = 400_000;
const QUALITIES = [0.8, 0.65, 0.5, 0.35];
const SENDABLE = ["image/jpeg", "image/png", "image/webp"];

/** Why a picture can't be used, in plain words. */
export const SHRINK_PROBLEM = {
  notPicture: "That isn't a picture. Try a JPEG or PNG.",
  unreadable: "That picture couldn't be opened. Try a JPEG or PNG.",
  tooLarge: "This picture is too large. Try a crop.",
} as const;

export type ShrinkResult = { blob: Blob } | { problem: string };

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

/** How much to scale a picture so it fits every limit (never up). */
export function scaleFor(width: number, height: number): number {
  return Math.min(
    1,
    MAX_WIDTH / width,
    MAX_HEIGHT / height,
    Math.sqrt(MAX_PIXELS / (width * height)),
  );
}

/**
 * The picture as a small JPEG, or the reason it can't be used. Without a
 * canvas (very old browsers), a picture that is already small and of a type
 * the server takes goes as it is.
 */
export async function shrinkImage(file: Blob): Promise<ShrinkResult> {
  if (!file.type.startsWith("image/"))
    return { problem: SHRINK_PROBLEM.notPicture };
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext?.("2d");
  if (!ctx) {
    if (!SENDABLE.includes(file.type))
      return { problem: SHRINK_PROBLEM.unreadable };
    return file.size <= MAX_BYTES
      ? { blob: file }
      : { problem: SHRINK_PROBLEM.tooLarge };
  }
  let img: Drawable;
  try {
    img = await decode(file);
  } catch {
    return { problem: SHRINK_PROBLEM.unreadable };
  }
  const width = img.width;
  const height = img.height;
  if (!width || !height) return { problem: SHRINK_PROBLEM.unreadable };
  const scale = scaleFor(width, height);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  // A see-through PNG would turn black as a JPEG: white behind it.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if ("close" in img) img.close();
  for (const quality of QUALITIES) {
    const out = await toBlob(canvas, quality);
    if (out && out.size <= MAX_BYTES) return { blob: out };
  }
  return { problem: SHRINK_PROBLEM.tooLarge };
}
