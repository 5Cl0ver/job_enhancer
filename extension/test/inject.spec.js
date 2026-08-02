// Tests the fragile bit of the content script: finding the job title in a real
// job-page DOM and anchoring the Save button right after it. Runs against the
// same saved HTML fixtures, deterministically, no browser.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import {
  INDEED_TITLE_SELECTORS,
  LINKEDIN_TITLE_SELECTORS,
  findTitleEl,
  headingFor,
} from "../src/inject.js";

const here = dirname(fileURLToPath(import.meta.url));
function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const w = new Window();
  w.document.write(html);
  return w.document;
}

describe("header button anchoring", () => {
  it("finds the Indeed detail title and places the button right after it", () => {
    const doc = docFrom("indeed-jsonld.html");
    const titleEl = findTitleEl(doc, INDEED_TITLE_SELECTORS);
    expect(titleEl).toBeTruthy();
    expect(titleEl.textContent).toContain("Senior Software Engineer");

    const heading = headingFor(titleEl);
    const btn = doc.createElement("button");
    btn.id = "je-save-btn";
    heading.insertAdjacentElement("afterend", btn);

    expect(heading.nextElementSibling).toBe(btn);
    expect(doc.getElementById("je-save-btn")).toBeTruthy();
  });

  it("finds the LinkedIn detail title", () => {
    const doc = docFrom("linkedin-remote-jsonld.html");
    const titleEl = findTitleEl(doc, LINKEDIN_TITLE_SELECTORS);
    expect(titleEl).toBeTruthy();
    expect(titleEl.textContent).toContain("Frontend Developer");
  });

  it("returns null when there's no job header (e.g. a search page)", () => {
    const doc = docFrom("indeed-search-noise.html");
    expect(findTitleEl(doc, INDEED_TITLE_SELECTORS)).toBeNull();
  });
});
