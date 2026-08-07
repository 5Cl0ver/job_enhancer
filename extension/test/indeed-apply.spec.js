// Indeed Quick-Apply auto-track detector.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import {
  isIndeedApplyUrl,
  isSubmitted,
  submittedCompany,
  scrapeApplyHeader,
} from "../src/indeed-apply.js";

const here = dirname(fileURLToPath(import.meta.url));
function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const w = new Window();
  w.document.write(html);
  return w.document;
}

describe("isIndeedApplyUrl", () => {
  it("recognizes the apply flow, not listings", () => {
    expect(isIndeedApplyUrl("https://smartapply.indeed.com/beta/indeedapply/form")).toBe(true);
    expect(isIndeedApplyUrl("https://www.indeed.com/applystart?jk=abc")).toBe(true);
    expect(isIndeedApplyUrl("https://www.indeed.com/viewjob?jk=abc")).toBe(false);
    expect(isIndeedApplyUrl("https://www.indeed.com/?vjk=abc")).toBe(false);
  });
});

describe("Indeed apply submission detection", () => {
  const doc = docFrom("indeed-apply-submitted.html");

  it("detects the submitted confirmation and its company", () => {
    expect(isSubmitted(doc)).toBe(true);
    expect(submittedCompany(doc)).toBe("Align");
  });

  it("scrapes the job identity from the apply header card", () => {
    const header = scrapeApplyHeader(doc);
    expect(header).toEqual({ title: "Desktop Engineer", company: "Align Communications" });
  });

  it("does not false-detect on a normal step (no confirmation text)", () => {
    const w = new Window();
    w.document.write(`
      <div class="ia-JobHeader">
        <h1>Desktop Engineer</h1>
        <div>Align Communications - Los Angeles, CA</div>
      </div>
      <h2>Add your location</h2>`);
    expect(isSubmitted(w.document)).toBe(false);
    expect(scrapeApplyHeader(w.document).company).toBe("Align Communications");
  });
});
