// @vitest-environment happy-dom
// Cover letters (spec 031): the job's letter goes into a box that clearly is
// for a cover letter — its PDF into an upload box, its text into a text box —
// and never into the résumé box. No letter: the box is left. Invented applicant.
import { describe, expect, it, vi } from "vitest";
import { collectFields } from "../src/autofill/scan.js";
import { isCoverLetterText, isCoverLetterUpload, isResumeUpload, resolve } from "../src/autofill/resolve.js";
import { createSession } from "../src/autofill/session.js";
import { parseSummary } from "../src/savedSync.js";
import { createApplyRun } from "../src/background/applyRun.js";

const parse = (html) => new DOMParser().parseFromString(html, "text/html");
const upload = (question, context = "", accept = ".pdf,.docx") => ({ kind: "file", question, hints: { context, unclearUploads: 1, accept } });
const LETTER = "The Platform Engineer role at Northwind Labs fits what I do.\n\nThanks for your time,\nAlex Rivera";
const letterFile = () => new File(["%PDF"], "Alex Rivera - Cover letter.pdf", { type: "application/pdf" });
const resumeFile = () => new File(["%PDF"], "Alex Rivera - Résumé.pdf", { type: "application/pdf" });

describe("which box is the cover letter's", () => {
  it("an upload box whose own label or heading says cover letter", () => {
    expect(isCoverLetterUpload(upload("Cover letter"))).toBe(true);
    expect(isCoverLetterUpload(upload("Attach", "Cover Letter"))).toBe(true);
    expect(isCoverLetterUpload({ ...upload("Attach"), hints: { context: "Attach", group: "Cover Letter", unclearUploads: 99, accept: ".pdf" } })).toBe(true);
  });

  it("never the résumé's box, a box for both, or another document", () => {
    expect(isCoverLetterUpload(upload("Resume/CV"))).toBe(false);
    expect(isCoverLetterUpload(upload("Upload", ""))).toBe(false); // unclear: the résumé's, if anything
    expect(isCoverLetterUpload(upload("Resume and cover letter"))).toBe(false);
    expect(isCoverLetterUpload(upload("Transcript"))).toBe(false);
    expect(isCoverLetterUpload(upload("Attach", "Résumé / Cover letter"))).toBe(false);
  });

  it("a text box that asks for the letter itself", () => {
    expect(isCoverLetterText({ kind: "textarea", question: "Cover letter", hints: {} })).toBe(true);
    expect(isCoverLetterText({ kind: "textarea", question: "Paste your cover letter here", hints: {} })).toBe(true);
    expect(isCoverLetterText({ kind: "textarea", question: "Why Northwind Labs?", hints: {} })).toBe(false);
    expect(isCoverLetterText({ kind: "text", question: "Cover letter", hints: {} })).toBe(false); // a one-line box
  });
});

describe("what goes in it", () => {
  const copy = (extra = {}) => ({ values: {}, answers: [], ...extra });

  it("the letter's PDF in its upload box; none = left for the user", () => {
    const file = letterFile();
    expect(resolve(upload("Cover letter"), copy({ coverLetterFile: file }))).toEqual({ values: [file], source: "profile", key: "cover_letter_file" });
    expect(resolve(upload("Cover letter"), copy())).toEqual({ skip: "no_data", key: "cover_letter_file" });
  });

  it("the résumé box never gets the cover letter", () => {
    expect(resolve(upload("Resume/CV"), copy({ coverLetterFile: letterFile() }))).toEqual({ skip: "no_data", key: "resume_file" });
  });

  it("the letter's text in a cover-letter text box; none = an essay, left", () => {
    const box = { kind: "textarea", question: "Cover letter", hints: {} };
    expect(resolve(box, copy({ coverLetterText: LETTER }))).toEqual({ values: [LETTER], source: "profile", key: "cover_letter" });
    expect(resolve(box, copy()).skip).toBe("essay");
    // Another essay question never gets the letter.
    expect(resolve({ kind: "textarea", question: "Why do you want to work here?", hints: {} }, copy({ coverLetterText: LETTER })).skip).toBe("essay");
  });
});

describe("a whole page", () => {
  const page = () =>
    parse(`<form>
      <label for="r">Resume/CV</label><input id="r" type="file" accept=".pdf">
      <section><h3>Cover Letter</h3><div><label for="c">Attach</label><input id="c" type="file" accept=".pdf"></div></section>
      <label for="t">Cover letter (paste it here)</label><textarea id="t"></textarea>
      <label for="w">Why Northwind Labs?</label><textarea id="w"></textarea>
    </form>`);

  it("the résumé in its box, the letter in its boxes, essays left", async () => {
    const doc = page();
    const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
    const copy = { values: {}, answers: [], resumeFile: resumeFile(), coverLetterFile: letterFile(), coverLetterText: LETTER };
    expect(await s.uploadResume(copy)).toBe(true);
    await s.fillKnown(copy);
    expect(doc.querySelector("#r").files[0].name).toBe("Alex Rivera - Résumé.pdf");
    expect(doc.querySelector("#c").files[0].name).toBe("Alex Rivera - Cover letter.pdf");
    expect(doc.querySelector("#t").value).toBe(LETTER);
    expect(doc.querySelector("#w").value).toBe("");
    const fields = collectFields(doc, { visible: () => true });
    expect(isResumeUpload(fields.find((f) => f.el.id === "c"))).toBe(false);
  });

  it("no letter: both cover-letter boxes are left for the user (or Claude)", async () => {
    const doc = page();
    const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
    await s.fillKnown({ values: {}, answers: [], resumeFile: resumeFile() });
    expect(doc.querySelector("#c").files?.length || 0).toBe(0);
    expect(doc.querySelector("#t").value).toBe("");
    const left = s.report().need_you.map((n) => n.label);
    expect(left).toEqual(expect.arrayContaining(["Attach", "Cover letter (paste it here)"]));
  });
});

describe("which letter", () => {
  it("the saved job carries its pick", () => {
    const out = parseSummary({ version: "v1", changed: true, jobs: [{ id: "s1", job_listing_id: "l1", title: "Platform Engineer", cover_letter_id: "cl-1" }] });
    expect(out.jobs[0].cover_letter_id).toBe("cl-1");
  });

  it("on a Claude run's own tab, the run's letter; elsewhere, not the run's business", async () => {
    const api = vi.fn(async () => ({
      ok: true,
      json: async () => ({ run_id: "r1", hosts: ["myworkdayjobs.com"], resume_id: "res-9", cover_letter_id: "cl-7", requests: [] }),
    }));
    const session = { "je_apply_tabs:r1": [7] };
    const chrome = {
      storage: {
        session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => Object.assign(session, o) },
        local: { get: async () => ({}) },
      },
    };
    const run = createApplyRun({ api, press: vi.fn(), fillSession: vi.fn(), chrome });
    expect(await run.coverLetterFor({ id: 7, url: "https://acme.wd1.myworkdayjobs.com/apply" })).toBe("cl-7");
    // Another tab: undefined, so the page's own saved job decides.
    expect(await run.coverLetterFor({ id: 9, url: "https://www.linkedin.com/jobs/view/1" })).toBe(undefined);
  });
});

describe("review fixes (PR #63)", () => {
  it("a lone 'Attach' box in a group titled Cover Letter never gets the résumé", () => {
    const box = { kind: "file", question: "Attach", hints: { context: "Attach", group: "Cover Letter", unclearUploads: 1, accept: ".pdf" } };
    expect(isResumeUpload(box)).toBe(false);
    expect(isCoverLetterUpload(box)).toBe(true);
    expect(resolve(box, { values: {}, answers: [], resumeFile: resumeFile() })).toEqual({ skip: "no_data", key: "cover_letter_file" });
    // A plain "Additional information" heading says nothing: still the résumé's.
    expect(isResumeUpload({ ...box, hints: { ...box.hints, group: "Additional information" } })).toBe(true);
  });

  it("the same on a page: a fieldset or a named role=group", async () => {
    for (const html of [
      `<form><fieldset><legend>Cover Letter</legend><div><span>Select files</span><input id="x" type="file" accept=".pdf"></div></fieldset></form>`,
      `<form><div role="group" aria-label="Cover Letter"><label for="x">Attach</label><input id="x" type="file" accept=".pdf"></div></form>`,
    ]) {
      const doc = parse(html);
      const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
      expect(await s.uploadResume({ values: {}, answers: [], resumeFile: resumeFile() })).toBe(false);
      expect(doc.querySelector("#x").files?.length || 0).toBe(0);
    }
  });

  it("a text box gets the letter only when its label is mainly the cover letter", () => {
    const box = (question) => ({ kind: "textarea", question, hints: {} });
    for (const yes of ["Cover letter", "Cover Letter:", "Cover letter (paste it here)", "Your cover letter", "Paste your cover letter"]) {
      expect(isCoverLetterText(box(yes)), yes).toBe(true);
    }
    for (const no of [
      "Anything else you'd like to share (e.g. cover letter)?",
      "Add a cover letter or anything else you'd like us to know about you and your experience",
      "Why do you want to join? No cover letter needed.",
      "Cover letter (optional)",
      "Cover letter: not needed",
    ]) {
      expect(isCoverLetterText(box(no)), no).toBe(false);
      expect(resolve(box(no), { values: {}, answers: [], coverLetterText: LETTER }).skip).toBe("essay");
    }
  });

  it("a box too small for the letter is left ('Too long for this box'), never cut off", async () => {
    const field = { kind: "textarea", question: "Cover letter", hints: { maxLength: 40 } };
    expect(resolve(field, { values: {}, answers: [], coverLetterText: LETTER })).toEqual({ skip: "too_long", key: "cover_letter" });
    const doc = parse(`<form><label for="t">Cover letter</label><textarea id="t" maxlength="40"></textarea></form>`);
    const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
    await s.fillKnown({ values: {}, answers: [], coverLetterText: LETTER });
    expect(doc.querySelector("#t").value).toBe("");
    expect(s.report().need_you).toEqual([expect.objectContaining({ label: "Cover letter", reason: "too_long" })]);
  });

  it("a rich-text box that drops paragraph breaks still counts the letter as taken", async () => {
    const { writeField } = await import("../src/autofill/widgets.js");
    const doc = parse(`<div id="e" contenteditable="true"></div>`);
    const el = doc.querySelector("#e");
    // Like a real editor: each paragraph becomes its own block, no newlines kept.
    doc.execCommand = (cmd, _ui, value) => {
      if (cmd === "insertText") el.innerHTML = value.split("\n").filter(Boolean).map((p) => `<p>${p}</p>`).join("");
      return true;
    };
    const res = await writeField({ kind: "editable", el, question: "Cover letter", hints: {} }, [LETTER]);
    expect(el.textContent).not.toContain("\n");
    expect(res.ok).toBe(true);
  });

  it("the letter is fetched fresh for every fill: a re-save or an edit is never the old text", async () => {
    const { createAutofillCopy } = await import("../src/background/autofillCopy.js");
    const store = { je_autofill: { version: "v1", fetched_at: Date.now(), email: "alex@example.com", profile: {}, answers: [] } };
    globalThis.chrome = {
      storage: {
        local: {
          get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]])),
          set: async (o) => Object.assign(store, o),
          remove: async () => {},
        },
        session: { get: async () => ({}), remove: async () => {} },
      },
    };
    let text = "First version of the letter.";
    const wakeFetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => (url.includes("/cover-letters/") ? { id: "cl-1", filename: "Cover letter.pdf", text, pdf_base64: "JVBERg==" } : {}),
    }));
    const copy = createAutofillCopy({ api: "", token: async () => "t", wakeFetch, toB64: () => "" });
    expect((await copy.get({ coverLetterId: "cl-1" })).coverLetter.text).toBe("First version of the letter.");
    text = "Edited in the app.";
    expect((await copy.get({ coverLetterId: "cl-1" })).coverLetter.text).toBe("Edited in the app.");
    expect(wakeFetch.mock.calls.filter(([u]) => u.includes("/cover-letters/cl-1"))).toHaveLength(2);
    expect(Object.keys(store)).toEqual(["je_autofill"]); // nothing kept
  });
});

describe("after 029 (Workday résumé path)", () => {
  it("a cover-letter box that shows the résumé's name is never touched", async () => {
    const doc = parse(`<form>
      <label for="r">Resume/CV</label><input id="r" type="file" accept=".pdf">
      <div id="card"><label for="c">Cover letter</label><input id="c" type="file" accept=".pdf"><span id="shown"></span></div>
    </form>`);
    const s = createSession({ doc, send: vi.fn(async () => ({})), visible: () => true });
    const copy = { values: {}, answers: [], resumeFile: resumeFile(), coverLetterFile: letterFile() };
    expect(await s.uploadResume(copy)).toBe(true);
    // The site shows the résumé in the cover letter's card (a mix-up on its side).
    doc.querySelector("#shown").textContent = "Alex Rivera - Résumé.pdf";
    await s.fillKnown(copy);
    expect(doc.querySelector("#c").files?.length || 0).toBe(0);
    // Without that, the letter goes in.
    doc.querySelector("#shown").textContent = "";
    await s.fillKnown(copy);
    expect(doc.querySelector("#c").files[0].name).toBe("Alex Rivera - Cover letter.pdf");
  });
});
