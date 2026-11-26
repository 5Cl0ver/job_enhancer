// Spec 032: a screenshot or phone photo is made into a JPEG at most 1200 px
// wide, 4000 px tall and 12 million pixels, and about 400 KB, before it's
// sent; when it can't be, the reason is said (the canvas is mocked: jsdom
// has none).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BYTES,
  MAX_HEIGHT,
  MAX_PIXELS,
  MAX_WIDTH,
  SHRINK_PROBLEM,
  type ShrinkResult,
  scaleFor,
  shrinkImage,
} from "@/lib/shrinkImage";

const drawImage = vi.fn();
const fillRect = vi.fn();
let sizes: number[] = [];
let canvas: HTMLCanvasElement | null = null;

beforeEach(() => {
  drawImage.mockReset();
  fillRect.mockReset();
  sizes = [100_000];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      canvas = this;
      return { drawImage, fillRect, fillStyle: "" } as never;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    cb: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    const size = sizes.shift() ?? 50_000;
    const blob = new Blob([new Uint8Array(size)], { type });
    Object.defineProperty(blob, "quality", { value: quality });
    cb(blob);
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 3000, height: 2000, close: vi.fn() }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const photo = (type = "image/png", size = 5_000_000) =>
  new File([new Uint8Array(size)], "shot.png", { type });

const blobOf = (out: ShrinkResult) => {
  if (!("blob" in out)) throw new Error(`no picture: ${out.problem}`);
  return out.blob;
};

const bitmap = (width: number, height: number) =>
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width, height, close: vi.fn() }),
  );

describe("shrinkImage", () => {
  it("makes a big picture a JPEG at most 1200 px wide", async () => {
    const out = blobOf(await shrinkImage(photo()));
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(canvas!.width).toBe(MAX_WIDTH);
    expect(canvas!.height).toBe(800);
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      MAX_WIDTH,
      800,
    );
    // A see-through PNG gets white behind it, not black.
    expect(fillRect).toHaveBeenCalled();
  });

  it("keeps a small picture's size", async () => {
    bitmap(800, 600);
    await shrinkImage(photo());
    expect(canvas!.width).toBe(800);
    expect(canvas!.height).toBe(600);
  });

  it("shrinks a very tall screenshot to fit too", async () => {
    bitmap(1080, 20_000);
    blobOf(await shrinkImage(photo()));
    expect(canvas!.height).toBe(MAX_HEIGHT);
    expect(canvas!.width).toBe(216);
    expect(canvas!.width * canvas!.height).toBeLessThanOrEqual(MAX_PIXELS);
  });

  it("keeps any picture under 12 million pixels", () => {
    for (const [w, h] of [
      [1200, 4000],
      [1080, 20_000],
      [4000, 3000],
      [500, 100_000],
    ]) {
      const s = scaleFor(w, h);
      expect(Math.round(w * s)).toBeLessThanOrEqual(MAX_WIDTH);
      expect(Math.round(h * s)).toBeLessThanOrEqual(MAX_HEIGHT);
      expect(w * s * h * s).toBeLessThanOrEqual(MAX_PIXELS + 1);
    }
    expect(scaleFor(800, 600)).toBe(1);
  });

  it("tries lower qualities until it's small enough", async () => {
    sizes = [900_000, 600_000, 300_000];
    const out = blobOf(await shrinkImage(photo()));
    expect(out.size).toBe(300_000);
    expect((out as Blob & { quality: number }).quality).toBe(0.5);
  });

  it("says it's too large when it never gets small enough", async () => {
    sizes = [900_000, 900_000, 900_000, 900_000];
    expect(await shrinkImage(photo())).toEqual({
      problem: SHRINK_PROBLEM.tooLarge,
    });
  });

  it("says when it isn't a picture", async () => {
    expect(
      await shrinkImage(
        new File(["%PDF"], "a.pdf", { type: "application/pdf" }),
      ),
    ).toEqual({ problem: SHRINK_PROBLEM.notPicture });
  });

  it("says when a picture can't be opened", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("bad image")),
    );
    // The <img> fallback can't read it either (jsdom has no decode).
    HTMLImageElement.prototype.decode = vi
      .fn()
      .mockRejectedValue(new Error("bad image"));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    expect(await shrinkImage(photo())).toEqual({
      problem: SHRINK_PROBLEM.unreadable,
    });
  });

  it("without a canvas, sends a small JPEG as it is and refuses a big one", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const small = photo("image/jpeg", 200_000);
    expect(await shrinkImage(small)).toEqual({ blob: small });
    expect(await shrinkImage(photo("image/jpeg", 2_000_000))).toEqual({
      problem: SHRINK_PROBLEM.tooLarge,
    });
    expect(await shrinkImage(photo("image/heic", 200_000))).toEqual({
      problem: SHRINK_PROBLEM.unreadable,
    });
  });
});
