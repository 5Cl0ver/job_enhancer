// @vitest-environment happy-dom
// Spec 017: never blind. Visibility by rendering only (aria-hidden on an
// ancestor never hides a field), and the "what Job Catcher saw" report —
// which must never carry a field's value or anything from the profile.
// Invented applicant only.
import { describe, expect, it, vi } from "vitest";
import { profileValues } from "../src/autofill/classify/profileKeys.js";
import { formatReport, frameReport } from "../src/autofill/report.js";
import { createSession } from "../src/autofill/session.js";
import { hiddenReason } from "../src/autofill/visible.js";

const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const PROFILE = { first_name: "Wren", last_name: "Calloway", phone: "555-010-4477", city: "Harborview" };
const EMAIL = "wren@example.com";
const copy = () => ({ values: profileValues(PROFILE, EMAIL, new Date("2026-11-23T12:00:00")), answers: [], resumeFile: null });

/** A stand-in element with the rendering facts a test wants. */
function el({ attrs = {}, visible = true, rects = 1 } = {}) {
  return {
    isConnected: true,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    checkVisibility: () => visible,
    getClientRects: () => Array(rects).fill({}),
    closest: () => null,
  };
}

describe("on screen = drawn on screen (never accessibility attributes)", () => {
  it("a box inside an aria-hidden or inert wrapper is still on screen", () => {
    // closest() isn't even consulted: ancestors' aria-hidden / inert don't count.
    const box = el();
    box.closest = () => ({ getAttribute: () => "true" });
    expect(hiddenReason(box)).toBe("");
  });

  it("not drawn: display:none / visibility:hidden (checkVisibility), or no size", () => {
    expect(hiddenReason(el({ visible: false }))).toBe("not_rendered");
    expect(hiddenReason(el({ rects: 0 }))).toBe("no_size");
  });

  it("a library's hidden copy of a drawn control (aria-hidden AND out of the tab order) isn't a field", () => {
    expect(hiddenReason(el({ attrs: { "aria-hidden": "true", tabindex: "-1" } }))).toBe("proxy");
    expect(hiddenReason(el({ attrs: { "aria-hidden": "true" } }))).toBe(""); // focusable: a real box
  });
});

describe("what Job Catcher saw: the report", () => {
  const page = () =>
    parse(`<div id="root" aria-hidden="true"><div role="dialog" aria-modal="true">
      <label for="fn">Legal First Name</label><input id="fn" name="legalFirstName" autocomplete="given-name">
      <label for="em">Email Address</label><input id="em" type="email">
      <label for="ph">Primary Phone Number</label><input id="ph" type="tel">
      <label><input type="checkbox" name="privacyAck"> I confirm I read the Privacy Policy</label>
      <input type="hidden" name="csrf" value="tok-123">
    </div></div>`);

  it("lists every field with its label, kind, hints and decision", async () => {
    const doc = page();
    const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
    await s.fillKnown(copy());
    const filled = new Map(s.report().entries.map((e) => [e.id, e.source]));
    const r = frameReport(doc, { fields: s.scan(), decide: (f) => (filled.has(f.id) ? `filled (${filled.get(f.id)})` : "left") });
    expect(r.kept).toBe(4);
    expect(r.found).toBe(4); // the hidden csrf input isn't a box
    expect(r.fields.map((f) => f.label)).toEqual([
      "Legal First Name",
      "Email Address",
      "Primary Phone Number",
      "I confirm I read the Privacy Policy",
    ]);
    expect(r.fields[0]).toMatchObject({ kind: "text", hints: { autocomplete: "given-name", name: "legalFirstName" }, decision: "filled (profile)" });
  });

  it("NEVER carries a value: not the profile's, not the page's", async () => {
    const doc = page();
    const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
    await s.fillKnown(copy());
    expect(doc.querySelector("#fn").value).toBe("Wren"); // filled for real
    const text = formatReport({
      version: "0.33.0",
      host: "www.paycomonline.net",
      frames: [{ frameId: 0, ...frameReport(doc, { fields: s.scan(), decide: () => "filled (profile)" }) }],
    });
    for (const secret of ["Wren", "Calloway", EMAIL, "555", "010-4477", "tok-123"]) expect(text).not.toContain(secret);
    expect(text).toContain('"Legal First Name" text');
  });

  it("says why boxes were left out, and when nothing answered", () => {
    expect(formatReport({ version: "0.33.0", host: "x.example", frames: [] })).toMatch(/No frame answered/);
    const doc = parse(`<input id="a" disabled><input id="b" readonly><input id="c" type="password">`);
    const r = frameReport(doc, { fields: [], decide: () => "" });
    // happy-dom draws nothing, so each is "no_size" before its other reason
    expect(r.found).toBe(3);
    expect(Object.values(r.dropped).reduce((a, b) => a + b, 0)).toBe(3);
  });
});
