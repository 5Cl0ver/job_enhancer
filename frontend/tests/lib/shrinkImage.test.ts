// Spec 032: a screenshot or phone photo is made into a JPEG at most 1200 px
// wide and about 400 KB before it's sent (the canvas is mocked: jsdom has
// none).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BYTES, MAX_WIDTH, shrinkImage } from "@/lib/shrinkImage";

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

describe("shrinkImage", () => {
  it("makes a big picture a JPEG at most 1200 px wide", async () => {
    const out = await shrinkImage(photo());
    expect(out?.type).toBe("image/jpeg");
    expect(out!.size).toBeLessThanOrEqual(MAX_BYTES);
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
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }),
    );
    await shrinkImage(photo());
    expect(canvas!.width).toBe(800);
    expect(canvas!.height).toBe(600);
  });

  it("tries lower qualities until it's small enough", async () => {
    sizes = [900_000, 600_000, 300_000];
    const out = await shrinkImage(photo());
    expect(out!.size).toBe(300_000);
    expect((out as Blob & { quality: number }).quality).toBe(0.5);
  });

  it("gives up when it never gets small enough", async () => {
    sizes = [900_000, 900_000, 900_000, 900_000];
    expect(await shrinkImage(photo())).toBeNull();
  });

  it("refuses what isn't a picture", async () => {
    expect(
      await shrinkImage(
        new File(["%PDF"], "a.pdf", { type: "application/pdf" }),
      ),
    ).toBeNull();
  });

  it("refuses a picture it can't read", async () => {
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
    expect(await shrinkImage(photo())).toBeNull();
  });

  it("without a canvas, sends a small JPEG as it is and refuses a big one", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const small = photo("image/jpeg", 200_000);
    expect(await shrinkImage(small)).toBe(small);
    expect(await shrinkImage(photo("image/jpeg", 2_000_000))).toBeNull();
    expect(await shrinkImage(photo("image/heic", 200_000))).toBeNull();
  });
});
