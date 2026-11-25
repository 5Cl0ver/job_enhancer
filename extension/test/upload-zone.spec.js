// @vitest-environment happy-dom
// Upload boxes hidden behind a "Select files" button or a drop zone named
// only by data-automation-id (Workday), spec 026.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFields, uploadZone } from "../src/autofill/scan.js";
import { isResumeUpload } from "../src/autofill/resolve.js";

const here = dirname(fileURLToPath(import.meta.url));
const parse = (html) => new DOMParser().parseFromString(html, "text/html");
// Like a browser: an input with display:none isn't visible.
const visible = (el) => !(el.getAttribute("class") || "").includes("hidden-input") && el.getAttribute("type") !== "hidden";

describe("hidden upload boxes", () => {
  it("finds Workday's résumé box behind its Select files button", () => {
    const doc = parse(readFileSync(join(here, "lab", "apply-workday.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, ""));
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    expect(box).toBeTruthy();
    expect(box.mark.getAttribute("data-automation-id")).toBe("file-upload-drop-zone");
    expect(isResumeUpload(box)).toBe(true);
  });

  it("a hidden input with no upload button near it is still left out", () => {
    const doc = parse(`<form><div><input type="file" class="hidden-input"><button>Next</button></div></form>`);
    expect(collectFields(doc, { visible }).filter((f) => f.kind === "file")).toHaveLength(0);
  });

  it("never takes a container two uploads share", () => {
    const doc = parse(`<div id="both">
      <div><input type="file" class="hidden-input" id="a"></div>
      <div><input type="file" class="hidden-input" id="b"></div>
      <button>Upload</button></div>`);
    expect(uploadZone(doc.querySelector("#a"), visible)).toBe(null);
  });

  it("a cover letter behind its own button stays a cover letter", () => {
    const doc = parse(`<section><h3>Cover letter</h3><div><button>Select files</button><input type="file" class="hidden-input" accept=".pdf"></div></section>`);
    const box = collectFields(doc, { visible }).find((f) => f.kind === "file");
    expect(box).toBeTruthy();
    expect(isResumeUpload(box)).toBe(false);
  });
});

describe("what happened to the résumé, step by step (spec 026)", () => {
  it("says attached on its page, and no box on a later step at the same address", async () => {
    const { createSession } = await import("../src/autofill/session.js");
    const doc = parse(`<form><label for="r">Résumé</label><input id="r" type="file" accept=".pdf"></form>`);
    const s = createSession({ doc, send: async () => ({}), visible: () => true });
    const resumeFile = new File(["%PDF"], "wren-acme.pdf", { type: "application/pdf" });
    const copy = { values: {}, answers: [], resumeFile };
    expect(await s.uploadResume(copy)).toBe(true);
    expect(s.report().resume).toBe("attached");
    // The site swaps the box for the file's name (Workday): still attached.
    doc.body.innerHTML = `<p>Successfully uploaded: wren-acme.pdf</p>`;
    await s.uploadResume(copy);
    expect(s.report().resume).toBe("attached");
    // A later step at the same address with no résumé box.
    doc.body.innerHTML = `<form><label for="v">Veteran status</label><select id="v"><option>No</option></select></form>`;
    await s.uploadResume(copy);
    expect(s.report().resume).toBe("no_box");
    // No file for this job.
    doc.body.innerHTML = `<form><label for="r2">Résumé</label><input id="r2" type="file" accept=".pdf"></form>`;
    await s.uploadResume({ ...copy, resumeFile: null });
    expect(s.report().resume).toBe("no_file");
  });
});
