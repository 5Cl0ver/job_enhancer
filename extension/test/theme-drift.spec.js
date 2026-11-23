// The extension's panel uses a COPY of the web app's color tokens (it builds on
// its own). This fails the moment the two drift apart, so Job Catcher always
// looks like Job Enhancer. To fix: copy the app's :root / .dark blocks from
// frontend/src/globals.css into extension/panel/src/theme.css.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function tokens(css, selector) {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const app = read("../../frontend/src/globals.css");
const panel = read("../panel/src/theme.css");

describe("the panel's colors are the app's", () => {
  for (const selector of [":root", ".dark"]) {
    it(`${selector} tokens match frontend/src/globals.css`, () => {
      const want = tokens(app, selector);
      expect(Object.keys(want).length).toBeGreaterThan(20);
      expect(tokens(panel, selector)).toEqual(want);
    });
  }
});
