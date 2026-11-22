import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([]),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { ApiError } from "@/lib/api";
import { useFullScan } from "@/hooks/useEmailAccount";

const DONE = {
  detected: 1,
  scanned: 40,
  moved: 0,
  window_days: 90,
  folders: [{ status: "complete", carried_over: 0 }],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  post.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("a scan whose connection drops", () => {
  it("tries the same pass again by itself and finishes", async () => {
    // The server restarting: no answer, then a 502, then the pass completes.
    post
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new ApiError(502, "Bad gateway"))
      .mockResolvedValueOnce(DONE);
    const { result } = renderHook(() => useFullScan(), { wrapper });

    let running!: Promise<void>;
    act(() => {
      running = result.current.run();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.retrying).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
      await running;
    });
    expect(post).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
    expect(result.current.done).toBe(true);
    expect(result.current.read).toBe(40);
  });

  it("gives up after about two minutes, saying what's saved", async () => {
    post.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useFullScan(), { wrapper });
    let running!: Promise<void>;
    act(() => {
      running = result.current.run();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 20_000);
      await running;
    });
    expect(post).toHaveBeenCalledTimes(7);
    expect(result.current.running).toBe(false);
    expect(result.current.error).toMatch(/What's read so far is saved/);
  });

  it("doesn't retry what retrying can't fix", async () => {
    post.mockRejectedValue(new ApiError(400, "Login failed — check your app password."));
    const { result } = renderHook(() => useFullScan(), { wrapper });
    await act(async () => {
      await result.current.run();
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("Login failed — check your app password.");
  });
});
