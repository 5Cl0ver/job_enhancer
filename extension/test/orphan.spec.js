// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { claimPage, sweepLegacy } from "../src/orphan.js";

describe("claimPage", () => {
  it("a newer copy supersedes the older one", () => {
    const first = claimPage("content");
    expect(first()).toBe(true);
    const second = claimPage("content");
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("claims are per script", () => {
    const content = claimPage("content");
    claimPage("autofill");
    expect(content()).toBe(true);
  });
});

describe("sweepLegacy", () => {
  it("removes old copies' elements now and when they redraw", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="je-save-btn"></button><button id="keep"></button>';
    sweepLegacy("#je-save-btn");
    expect(document.getElementById("je-save-btn")).toBeNull();
    document.body.insertAdjacentHTML("beforeend", '<button id="je-save-btn"></button>');
    vi.advanceTimersByTime(1000);
    expect(document.getElementById("je-save-btn")).toBeNull();
    expect(document.getElementById("keep")).not.toBeNull();
    vi.useRealTimers();
  });
});
