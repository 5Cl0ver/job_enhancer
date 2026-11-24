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

describe("taught boxes: remembered by what they are, matched only when sure", async () => {
  const { fingerprintOf, matchTaught, stableName } = await import("../src/autofill/fingerprint.js");
  const { collectFields } = await import("../src/autofill/scan.js");
  const fieldsOf = (doc) => collectFields(doc, { visible: () => true });

  it("names a build tool generated aren't trusted", () => {
    expect(stableName("legalFirstName")).toBe("legalFirstName");
    expect(stableName("email_address")).toBe("email_address");
    for (const generated of ["css-1x2y3z", "jss123", ":r3:", "input-48213", "mui-5", "a"]) expect(stableName(generated)).toBe("");
  });

  it("found again after the site's markup shifts (new classes, new ids, moved)", () => {
    const before = parse(`<form><h2>Personal information</h2><label for="a1">Legal first name</label><input id="input-1234" name="legalFirstName" class="css-1x2y3z"></form>`);
    const fp = fingerprintOf(fieldsOf(before)[0], fieldsOf(before));
    const after = parse(`<form><h2>Personal information</h2><label for="b">Nickname</label><input id="b">
      <label for="a9">Legal first name</label><input id="input-9876" name="legalFirstName" class="css-9z8y7x"></form>`);
    const fields = fieldsOf(after);
    const hit = matchTaught([{ fingerprint: fp, profile_key: "first_name" }], fields);
    expect([...hit.keys()]).toEqual([fields[1].id]);
  });

  it("never guesses between two look-alike boxes", () => {
    const doc = parse(`<form><div><input></div><div><input></div></form>`);
    const fields = fieldsOf(doc);
    const fp = { ...fingerprintOf(fields[0], fields), index: 7 }; // no name, no label: only a kind
    expect(matchTaught([{ fingerprint: fp, profile_key: "email" }], fields).size).toBe(0);
  });

  it("a taught box fills, but never past the guards (consent, self-ID)", async () => {
    const doc = parse(`<form><input id="contactAddress"><label for="g">Gender</label><select id="g"><option></option><option>Female</option></select></form>`);
    const fields = fieldsOf(doc);
    const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
    const taught = [
      { site: doc.location?.hostname || "", fingerprint: fingerprintOf(fields[0], fields), profile_key: "email" },
      { site: doc.location?.hostname || "", fingerprint: fingerprintOf(fields[1], fields), answer: "Female" },
    ];
    await s.fillKnown({ ...copy(), taught });
    expect(doc.querySelector("#contactAddress").value).toBe(EMAIL);
    expect(doc.querySelector("#g").value).toBe(""); // self-identification: never
  });
});

describe("taught boxes: the second review's cases", async () => {
  const { fingerprintOf, matchTaught, sameBox, stableName } = await import("../src/autofill/fingerprint.js");
  const { siteKey } = await import("../src/autofill/hosts.js");
  const { collectFields } = await import("../src/autofill/scan.js");
  const fieldsOf = (doc) => collectFields(doc, { visible: () => true });

  it("two boxes under one heading are two boxes (teaching one never replaces the other)", () => {
    const a = { kind: "text", label: "getting you started", name: "fname" };
    const b = { kind: "text", label: "getting you started", name: "lname" };
    expect(sameBox(a, b)).toBe(false);
    expect(sameBox(a, { ...a, index: 4 })).toBe(true); // the same box, moved
  });

  it("counter ids and autocomplete=off are no evidence", () => {
    for (const counter of ["input-12", "field_7", "q:3", "answer12"]) expect(stableName(counter)).toBe("");
    expect(stableName("address1")).toBe("address1");
    const doc = parse(`<form><input autocomplete="off" aria-label="Promo code"></form>`);
    const taughtOn = parse(`<form><input autocomplete="off" aria-label="Referral code"></form>`);
    const fp = fingerprintOf(fieldsOf(taughtOn)[0], fieldsOf(taughtOn));
    expect(fp.autocomplete).toBe("");
    expect(matchTaught([{ fingerprint: fp, profile_key: "email" }], fieldsOf(doc)).size).toBe(0);
  });

  it("the same name on a different question is a different box", () => {
    const taughtOn = parse(`<form><label for="n">Nickname</label><input id="n" name="contactName"></form>`);
    const doc = parse(`<form><label for="n">Emergency contact name</label><input id="n" name="contactName"></form>`);
    const fp = fingerprintOf(fieldsOf(taughtOn)[0], fieldsOf(taughtOn));
    expect(matchTaught([{ fingerprint: fp, profile_key: "first_name" }], fieldsOf(doc)).size).toBe(0);
  });

  it("one company's taught boxes never fill another's on a shared host", () => {
    expect(siteKey("https://boards.greenhouse.io/vellacor/jobs/1")).toBe("boards.greenhouse.io/vellacor");
    expect(siteKey("https://boards.greenhouse.io/quillstone/jobs/9")).toBe("boards.greenhouse.io/quillstone");
    expect(siteKey("https://www.paycomonline.net/v4/ats/web.php/portal/X/career-page")).toBe("www.paycomonline.net");
  });
});

describe("which upload box is the résumé's", async () => {
  const { isResumeUpload } = await import("../src/autofill/resolve.js");
  const box = (question, context = "", unclearUploads = 1, accept = ".pdf,.docx") => ({ kind: "file", question, hints: { context, unclearUploads, accept } });
  it("its own label decides first, then the heading above it", () => {
    expect(isResumeUpload(box("Resume/CV"))).toBe(true);
    expect(isResumeUpload(box("Cover letter"))).toBe(false);
    expect(isResumeUpload(box("Drop a file or browse", "Resume", 2))).toBe(true);
    expect(isResumeUpload(box("Drop a file or browse", "Cover Letter", 2))).toBe(false);
  });
  it("an unclear box is the résumé's only when it's the page's one upload box", () => {
    expect(isResumeUpload(box("Upload", "", 1))).toBe(true);
    expect(isResumeUpload(box("Upload", "", 2))).toBe(false);
    expect(isResumeUpload(box("Upload", "", 1, "image/*"))).toBe(false);
  });
});
