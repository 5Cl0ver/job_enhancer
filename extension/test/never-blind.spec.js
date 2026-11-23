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
function el({ attrs = {}, visible = true, rects = 1, box = { left: 10, top: 10, right: 210, bottom: 40, width: 200, height: 30 }, hiddenWrapper = false, inPopup = false, tag = "INPUT" } = {}) {
  return {
    isConnected: true,
    tagName: tag,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    checkVisibility: () => visible,
    getClientRects: () => Array(rects).fill({}),
    getBoundingClientRect: () => box,
    closest: (sel) => (/aria-hidden/.test(sel) ? (hiddenWrapper ? {} : null) : /dialog/.test(sel) ? (inPopup ? {} : null) : null),
    ownerDocument: { documentElement: { scrollWidth: 1280 }, defaultView: { innerWidth: 1280, scrollX: 0, scrollY: 0 } },
  };
}

describe("on screen = drawn on screen (never accessibility attributes)", () => {
  it("a box inside an open pop-up is on screen even when its ancestors are aria-hidden (MUI v4)", () => {
    expect(hiddenReason(el({ hiddenWrapper: true, inPopup: true }))).toBe("");
  });

  it("…but outside a pop-up, aria-hidden / inert still hide it (the page behind, a drawer, a trap)", () => {
    expect(hiddenReason(el({ hiddenWrapper: true }))).toBe("hidden_from_page");
  });

  it("not drawn: display:none / visibility:hidden (checkVisibility), or no size", () => {
    expect(hiddenReason(el({ visible: false }))).toBe("not_rendered");
    expect(hiddenReason(el({ rects: 0 }))).toBe("no_size");
  });

  it("a library's hidden copy of a drawn control (aria-hidden AND out of the tab order) isn't a field", () => {
    expect(hiddenReason(el({ attrs: { "aria-hidden": "true", tabindex: "-1" } }))).toBe("proxy");
    expect(hiddenReason(el({ attrs: { "aria-hidden": "true" } }))).toBe(""); // focusable: a real box
  });

  it("spam traps only bots fill are never boxes", () => {
    // Parked far off the page (left: -9999px)
    expect(hiddenReason(el({ box: { left: -9999, right: -9799, top: 10, bottom: 40, width: 200, height: 30 } }))).toBe("off_page");
    // A speck of a box
    expect(hiddenReason(el({ box: { left: 10, right: 11, top: 10, bottom: 11, width: 1, height: 1 } }))).toBe("speck");
    // A box to type in that's out of the tab order (Mailchimp's b_… field)
    expect(hiddenReason(el({ attrs: { tabindex: "-1" } }))).toBe("trap");
    expect(hiddenReason(el({ attrs: { tabindex: "-1", type: "radio" } }))).toBe(""); // a drawn radio's input
  });

  it("…but a real box scrolled above the view of a long pop-up stays", () => {
    expect(hiddenReason(el({ box: { left: 300, right: 700, top: -900, bottom: -860, width: 400, height: 40 } }))).toBe("");

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

describe("a label never carries the answer", () => {
  it("a dropdown's chosen value isn't read as its question", async () => {
    const { questionFor } = await import("../src/autofill/scan.js");
    const doc = parse(`
      <label id="g-l">Gender</label>
      <div role="combobox" id="g" aria-labelledby="g-l g"><span>Female</span></div>
      <div class="field"><div>Location</div>
        <div class="select__control"><div class="select__single-value">Harborview, OR</div><input id="loc" role="combobox"></div></div>`);
    expect(questionFor(doc.querySelector("#g"))).toBe("Gender");
    expect(questionFor(doc.querySelector("#loc"))).not.toMatch(/Harborview/);
  });
});
