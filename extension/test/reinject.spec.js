import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { matchesPattern, scriptsForUrl } from "../src/background/reinject.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const files = (url) => scriptsForUrl(manifest.content_scripts, url).flatMap((s) => s.files);

describe("matchesPattern", () => {
  it("matches a host and its subdomains", () => {
    expect(matchesPattern("https://www.indeed.com/viewjob?jk=1", "https://*.indeed.com/*")).toBe(true);
    expect(matchesPattern("https://indeed.com/", "https://*.indeed.com/*")).toBe(true);
    expect(matchesPattern("https://notindeed.com/", "https://*.indeed.com/*")).toBe(false);
  });

  it("respects the scheme", () => {
    expect(matchesPattern("http://www.indeed.com/", "https://*.indeed.com/*")).toBe(false);
    expect(matchesPattern("http://a.example/", "*://*/*")).toBe(true);
    expect(matchesPattern("chrome://extensions/", "<all_urls>")).toBe(false);
  });

  it("matches paths with wildcards", () => {
    expect(matchesPattern("https://www.google.com/about/careers/x", "https://www.google.com/about/careers/*")).toBe(true);
    expect(matchesPattern("https://www.google.com/search?q=x", "https://www.google.com/about/careers/*")).toBe(false);
  });

  it("never throws on junk", () => {
    expect(matchesPattern("not a url", "https://*/*")).toBe(false);
    expect(matchesPattern("https://a.example/", "garbage")).toBe(false);
  });
});

describe("scriptsForUrl (the real manifest)", () => {
  it("a LinkedIn job gets the Save script and autofill, not the any-site Scout copier", () => {
    const f = files("https://www.linkedin.com/jobs/view/123/");
    expect(f).toContain("dist/content.js");
    expect(f).toContain("dist/autofill.js");
    expect(f).not.toContain("dist/scoutpage.js");
  });

  it("a company careers site gets the Scout copier and autofill", () => {
    const f = files("https://careers.vellacor.example/jobs/42");
    expect(f).toEqual(expect.arrayContaining(["dist/scoutpage.js", "dist/autofill.js"]));
    expect(f).not.toContain("dist/content.js");
  });

  it("webmail and the app are left alone by the Scout copier", () => {
    expect(files("https://mail.proton.me/u/0/inbox")).not.toContain("dist/scoutpage.js");
  });

  it("never re-injects the page-world bridge", () => {
    expect(files("https://www.indeed.com/viewjob?jk=1")).not.toContain("dist/bridge.js");
  });

  it("autofill goes into every frame", () => {
    const s = scriptsForUrl(manifest.content_scripts, "https://acme.wd5.myworkdayjobs.com/apply");
    expect(s.find((x) => x.files.includes("dist/autofill.js"))?.allFrames).toBe(true);
  });
});
