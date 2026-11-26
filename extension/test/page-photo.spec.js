// The tab photo shared by Apply with Claude and "Report a problem here"
// (spec 032): Chrome allows 2 captures a second across the extension, so
// every capture, whoever asks, takes its own slot at least 550 ms apart.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_GAP_MS, capture, resetCaptureSlots } from "../src/background/pagePhoto.js";

const JPEG = "data:image/jpeg;base64,/9j/4AAQ";

describe("capture slots", () => {
  beforeEach(() => {
    resetCaptureSlots();
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("spaces every caller's captures, even ones asked at the same moment", async () => {
    const times = [];
    const c = {
      tabs: {
        captureVisibleTab: vi.fn(async () => {
          times.push(Date.now());
          return JPEG;
        }),
      },
    };
    // An Apply photo and a report's picture at once, then another photo.
    const all = Promise.all([capture(c, 1), capture(c, 1), capture(c, 2)]);
    await vi.runAllTimersAsync();
    const shots = await all;
    expect(shots.every((b) => b && b.size > 0)).toBe(true);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(CAPTURE_GAP_MS);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(CAPTURE_GAP_MS);
  });

  it("a hidden window is no photo, and still uses its slot", async () => {
    const c = { tabs: { captureVisibleTab: vi.fn().mockRejectedValueOnce(new Error("hidden")).mockResolvedValue(JPEG) } };
    const first = capture(c, 1);
    const second = capture(c, 1);
    await vi.runAllTimersAsync();
    expect(await first).toBeNull();
    expect(await second).not.toBeNull();
  });
});
