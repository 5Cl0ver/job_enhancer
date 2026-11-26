// Spec 032: the app catches its own crashes. Only when signed in, the same
// words at most once a minute, nothing while a report is being sent, and no
// noise (ResizeObserver, cancelled requests, 401s, other extensions' scripts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const token = vi.fn();

vi.mock("@/lib/api", () => ({
  API_BASE: "http://api.test",
  getAccessToken: () => token(),
}));

import {
  errorWords,
  installErrorCatcher,
  isNoise,
  reportCaught,
  resetCaught,
} from "@/lib/catchErrors";

const fetchMock = vi.fn();

beforeEach(() => {
  resetCaught();
  token.mockReset().mockResolvedValue("signed-in-token");
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", "/jobs/42?tab=notes");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function sent() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url,
    headers: init.headers,
    body: JSON.parse(init.body),
  }));
}

describe("reportCaught", () => {
  it("sends the error, the page and the context, with the sign-in", async () => {
    expect(
      await reportCaught(new TypeError("x is undefined"), { kind: "crash" }),
    ).toBe(true);
    const [one] = sent();
    expect(one.url).toBe("http://api.test/v1/bugs/caught");
    expect(one.headers.Authorization).toBe("Bearer signed-in-token");
    expect(one.body).toMatchObject({
      section: "app",
      kind: "crash",
      place: "/jobs/42",
      message: "TypeError: x is undefined",
      context: { device: "computer", theme: "light", app_version: "dev" },
    });
  });

  it("sends nothing when signed out", async () => {
    token.mockResolvedValue(null);
    expect(await reportCaught(new Error("boom"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the same words at most once a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T10:00:00Z"));
    await reportCaught(new Error("boom"));
    await reportCaught(new Error("boom"));
    await reportCaught(new Error("other"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-11-26T10:01:01Z"));
    await reportCaught(new Error("boom"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports nothing while a report is being sent", async () => {
    let finish: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const first = reportCaught(new Error("first"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // An error thrown while sending (say, by the send itself) is dropped.
    expect(await reportCaught(new Error("while sending"))).toBe(false);
    finish({ ok: true });
    expect(await first).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await reportCaught(new Error("after"))).toBe(true);
  });

  it("never throws when sending fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(reportCaught(new Error("boom"))).resolves.toBe(false);
  });

  it("cuts long words to 300 characters", async () => {
    await reportCaught(new Error("x".repeat(500)));
    expect(sent()[0].body.message).toHaveLength(300);
  });

  it.each([
    ["ResizeObserver loop limit exceeded", undefined],
    [
      "ResizeObserver loop completed with undelivered notifications.",
      undefined,
    ],
    [
      Object.assign(new Error("The user aborted a request."), {
        name: "AbortError",
      }),
      undefined,
    ],
    [new TypeError("Failed to fetch"), undefined],
    [new TypeError("Load failed"), undefined],
    ["Script error.", undefined],
    [
      Object.assign(new Error("Not authenticated"), {
        name: "ApiError",
        status: 401,
      }),
      undefined,
    ],
    [
      Object.assign(new Error("Internal server error"), {
        name: "ApiError",
        status: 500,
      }),
      undefined,
    ],
    [new Error("boom"), "chrome-extension://abcdef/content.js"],
  ])("ignores noise: %s", async (error, source) => {
    expect(await reportCaught(error, { source })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a real 4xx the app didn't handle", () => {
    const e = Object.assign(new Error("Job not found"), {
      name: "ApiError",
      status: 404,
    });
    expect(isNoise(e, errorWords(e))).toBe(false);
  });
});

describe("installErrorCatcher", () => {
  it("listens once, for errors and unhandled promises", async () => {
    installErrorCatcher();
    installErrorCatcher();
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new RangeError("bad index"),
        message: "bad index",
      }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sent()[0].body).toMatchObject({
      kind: "other",
      message: "RangeError: bad index",
    });

    const rejected = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejected, "reason", {
      value: new Error("nobody caught me"),
    });
    window.dispatchEvent(rejected);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sent()[1].body.message).toBe("nobody caught me");
  });

  it("drops errors from other extensions' scripts", async () => {
    installErrorCatcher();
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("theirs"),
        message: "theirs",
        filename: "chrome-extension://abc/inject.js",
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
