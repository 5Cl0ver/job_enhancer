// @vitest-environment happy-dom
// A box's own group title (spec 020 review): a heading outside the form —
// a job description's "Preferred Qualifications" — is never the group.
import { describe, expect, it } from "vitest";
import { groupTitle } from "../src/autofill/scan.js";
import { pivotConflict } from "../src/autofill/classify/answers.js";

describe("groupTitle", () => {
  it("ignores headings outside the form", () => {
    document.body.innerHTML = `
      <article><h2>Preferred Qualifications</h2><p>5 years of SQL</p></article>
      <form><label for="fn">First Name</label><input id="fn"></form>`;
    expect(groupTitle(document.getElementById("fn"))).toBe("");
  });

  it("uses the fieldset legend, a named group, or a heading inside the form", () => {
    document.body.innerHTML = `
      <form>
        <h3>Personal details</h3><input id="a">
        <fieldset><legend>Preferred Name</legend><input id="b"></fieldset>
        <div role="group" aria-label="Preferred Name"><input id="c"></div>
      </form>`;
    expect(groupTitle(document.getElementById("a"))).toBe("Personal details");
    expect(groupTitle(document.getElementById("b"))).toBe("Preferred Name");
    expect(groupTitle(document.getElementById("c"))).toBe("Preferred Name");
  });
});

describe("short company names", () => {
  it("EY and GE are different questions", () => {
    expect(pivotConflict("are you an ey alumni".split(" "), "are you a ge alumni".split(" "))).toBe(true);
    expect(pivotConflict("are you an alumni".split(" "), "are you a alumni".split(" "))).toBe(false);
  });
});
