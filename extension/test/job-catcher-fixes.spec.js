// @vitest-environment happy-dom
// Spec 029: the fixes from a real Apply with Claude run on Workday — the
// résumé box Workday hides (input inside or beside its drop zone, labelled
// "Upload a file" under a "Resume/CV" heading), only the current step's boxes
// in a fill's report, and never the phone number in a Phone Extension box.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFields, uploadZone } from "../src/autofill/scan.js";
import { isResumeUpload, resolve, uploadKind } from "../src/autofill/resolve.js";
import { isPhoneExtension, profileKeyFor } from "../src/autofill/classify/profileKeys.js";
import { createSession } from "../src/autofill/session.js";
import { writeField } from "../src/autofill/widgets.js";

const here = dirname(fileURLToPath(import.meta.url));
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
// Like a browser: an input with display:none isn't visible.
const visible = (el) => !(el.getAttribute("class") || "").includes("hidden-input") && el.getAttribute("type") !== "hidden";
const lab = (name) => readFileSync(join(here, "lab", name), "utf8");
const noScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "");

/** Step 2 of the one-address lab application: the input BESIDE the zone. */
function stepTwo() {
  const html = lab("apply-workday-steps.html");
  const steps = [...html.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]);
  return parse(`<main>${steps[1]}</main>`);
}

describe("Workday's résumé box (bug 2)", () => {
  it("the real layout: the input inside the drop zone, labelled only 'Upload a file' under 'Resume/CV'", () => {
    const doc = parse(noScripts(lab("apply-workday.html")));
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    expect(box).toBeTruthy();
    expect(box.question).not.toMatch(/resume/i);
    expect(box.mark.getAttribute("data-automation-id")).toBe("file-upload-drop-zone");
    expect(uploadKind(box)).toBe("resume");
    expect(isResumeUpload(box)).toBe(true);
  });

  it("the input beside the drop zone in the upload card: still found, the zone is its box", () => {
    const doc = stepTwo();
    const input = doc.querySelector("[data-automation-id=file-upload-input-ref]");
    expect(uploadZone(input, visible).getAttribute("data-automation-id")).toBe("file-upload-drop-zone");
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    expect(box?.zone?.id).toBe("zone");
    expect(isResumeUpload(box)).toBe(true);
    expect(resolve(box, { values: {}, answers: [], resumeFile: new File(["%PDF"], "a.pdf") }).key).toBe("resume_file");
  });

  it("a cover letter's Workday box under its own heading stays a cover letter", () => {
    const doc = parse(`<section><h3>Cover Letter</h3><div><label>Upload a file (5MB max)</label></div>
      <div data-automation-id="attachments-FileUpload"><div data-automation-id="file-upload-drop-zone">
      <button data-automation-id="select-files">Select files</button>
      <input type="file" class="css-hidden-input" data-automation-id="file-upload-input-ref"></div></div></section>`);
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    expect(box).toBeTruthy();
    expect(isResumeUpload(box)).toBe(false);
  });

  it("a dropdown is never taken for a drop zone", () => {
    const doc = parse(`<div><div class="dropdown-menu">Choose one</div><input type="file" class="hidden-input" id="f"></div>`);
    expect(uploadZone(doc.querySelector("#f"), visible)).toBe(null);
  });

  it("a React drop zone that ignores the box gets the file dropped on it", async () => {
    const doc = stepTwo();
    let dropped = "";
    doc.querySelector("#zone").addEventListener("drop", (e) => {
      dropped = [...(e.dataTransfer?.files || [])].map((f) => f.name).join(",");
    });
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    const file = new File(["%PDF"], "alex-rivera.pdf", { type: "application/pdf" });
    const res = await writeField(box, [file]);
    expect(res.ok).toBe(true);
    expect(dropped).toBe("alex-rivera.pdf");
  });

  it("a zone that took the file from the box is never dropped on too", async () => {
    const doc = stepTwo();
    let drops = 0;
    doc.querySelector("#zone").addEventListener("drop", () => drops++);
    const input = doc.querySelector("#input-3f9a");
    input.addEventListener("change", () => {
      doc.body.append(Object.assign(doc.createElement("p"), { textContent: `Successfully uploaded ${input.files[0].name}` }));
    });
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    await writeField(box, [new File(["%PDF"], "alex-rivera.pdf", { type: "application/pdf" })]);
    expect(drops).toBe(0);
  });
});

describe("the fill report is the step on the page now (bug 3)", () => {
  it("a one-address application's earlier step never shows in the report", async () => {
    const doc = parse(`<form id="step"><label for="fn">First Name</label><input id="fn" autocomplete="given-name">
      <label for="sfx">Suffix</label><select id="sfx"><option value="">Select One</option><option>Jr.</option></select></form>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    const copy = { values: { first_name: ["Alex"] }, answers: [], taught: [] };
    await s.fillKnown(copy);
    let r = s.report();
    expect(r.entries.map((e) => e.label)).toEqual(["First Name"]);
    expect(r.need_you.map((n) => n.label)).toEqual(["Suffix"]);
    // The site draws step 2 in place, at the same address.
    doc.querySelector("#step").innerHTML = `<label for="yrs">Years with Intune?</label><input id="yrs">`;
    await s.fillKnown(copy);
    r = s.report();
    expect(r.entries).toEqual([]);
    expect(r.need_you.map((n) => n.label)).toEqual(["Years with Intune?"]);
  });
});

describe("the phone never goes in a Phone Extension box (bug 4)", () => {
  const f = (question, hints = {}) => ({ question, hints });
  it("Workday's extension box, by its label, its id, or autocomplete", () => {
    expect(profileKeyFor(f("Phone Extension"))).toBe(null);
    expect(profileKeyFor(f("Ext.", { id: "phoneNumber--extension", type: "tel" }))).toBe(null);
    expect(profileKeyFor(f("Extension", { type: "tel" }))).toBe(null);
    expect(profileKeyFor(f("Work phone", { autocomplete: "tel-extension" }))).toBe(null);
    expect(isPhoneExtension(f("Phone Ext"))).toBe(true);
  });

  it("the phone number box is still the phone's", () => {
    expect(profileKeyFor(f("Phone Number", { id: "phoneNumber--phoneNumber", type: "tel" }))).toBe("phone");
    expect(profileKeyFor(f("Phone number (with extension)"))).toBe("phone");
    expect(profileKeyFor(f("Mobile phone", { name: "context-phone" }))).toBe("phone");
  });

  it("filling a Workday page leaves the extension empty", async () => {
    const html = lab("apply-workday-steps.html");
    const [first] = [...html.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]);
    const doc = parse(`<form>${first}</form>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    await s.fillKnown({ values: { phone: ["555-010-4477"], first_name: ["Alex"] }, answers: [], taught: [] });
    expect(doc.querySelector("#phoneNumber--phoneNumber").value).toBe("555-010-4477");
    expect(doc.querySelector("#phoneNumber--extension").value).toBe("");
    expect(s.report().entries.filter((e) => /extension/i.test(e.label))).toEqual([]);
  });
});
