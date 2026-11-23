// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { claimPage, sweepLegacy } from "../src/orphan.js";

beforeEach(() => {
  document.documentElement.removeAttribute("data-je-content");
  document.documentElement.removeAttribute("data-je-autofill");
  document.getElementById("jec-legacy-hide")?.remove();
  document.body.innerHTML = "";
});

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

  it("a page that wipes the claim doesn't silence the live copy", () => {
    globalThis.chrome = { runtime: { id: "job-catcher" } };
    const live = claimPage("content");
    document.documentElement.removeAttribute("data-je-content");
    expect(live()).toBe(true);
    // ...and it holds the page again, so an older copy still loses.
    expect(document.documentElement.getAttribute("data-je-content")).toBeTruthy();
    delete globalThis.chrome;
  });

  it("a copy that was replaced never becomes current again", () => {
    globalThis.chrome = { runtime: { id: "job-catcher" } };
    const old = claimPage("content");
    const live = claimPage("content");
    expect(old()).toBe(false);
    document.documentElement.removeAttribute("data-je-content");
    expect(old()).toBe(false); // it saw a newer copy: it never re-claims
    expect(live()).toBe(true);
    delete globalThis.chrome;
  });

  it("a dead copy (its extension updated away) never claims a wiped page", () => {
    const dead = claimPage("content"); // no chrome.runtime here: a dead copy
    document.documentElement.removeAttribute("data-je-content");
    expect(dead()).toBe(false);
    expect(document.documentElement.getAttribute("data-je-content")).toBeNull();
  });
});

describe("sweepLegacy", () => {
  it("removes old copies' elements and keeps any redraw hidden for good", () => {
    document.body.innerHTML = '<button id="je-save-btn"></button><button id="keep"></button>';
    sweepLegacy("#je-save-btn, #je-sync-btn");
    expect(document.getElementById("je-save-btn")).toBeNull();
    expect(document.getElementById("keep")).not.toBeNull();
    const rule = document.getElementById("jec-legacy-hide").textContent;
    expect(rule).toContain("#je-save-btn, #je-sync-btn { display: none !important; }");
    // Running again (another script) doesn't repeat the rule.
    sweepLegacy("#je-save-btn, #je-sync-btn");
    expect(document.getElementById("jec-legacy-hide").textContent.split("display").length).toBe(2);
  });
});
