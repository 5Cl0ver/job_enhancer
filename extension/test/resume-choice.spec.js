// The chosen résumé's name from the server (spec 020 security review): any
// name travels percent-encoded, and a bad encoding never breaks the upload.
import { describe, expect, it } from "vitest";
import { fileNameOf } from "../src/background/autofillCopy.js";

const res = (name) => ({ headers: { get: (h) => (h === "X-Resume-Filename" ? name : null) } });

describe("fileNameOf", () => {
  it("decodes a percent-encoded name", () => {
    expect(fileNameOf(res(encodeURIComponent("Résumé – Wren.pdf")))).toBe("Résumé – Wren.pdf");
  });
  it("keeps a raw name and falls back when there's none", () => {
    expect(fileNameOf(res("bad%E0%A4%A.pdf"))).toBe("bad%E0%A4%A.pdf");
    expect(fileNameOf(res(null), "wren.pdf")).toBe("wren.pdf");
  });
});

describe("signing out forgets the account's saved jobs and résumé choices", () => {
  it("wipe() clears the copy, the chosen résumé, the saved-jobs cache and every choice", async () => {
    const { createAutofillCopy } = await import("../src/background/autofillCopy.js");
    const local = { je_autofill: {}, je_chosen_resume: {}, je_saved_cache: { jobs: [{ id: "j1" }] }, je_not_this: {} };
    const session = { "je_resume_choice:job:j1": { resumeId: "r2" }, "je_resume_choice:page:x": {}, je_fill_1: {} };
    const area = (store) => ({
      get: async (k) => (k === null ? { ...store } : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]]))),
      remove: async (k) => [].concat(k).forEach((x) => delete store[x]),
      set: async (o) => Object.assign(store, o),
    });
    globalThis.chrome = { storage: { local: area(local), session: area(session) } };
    const copy = createAutofillCopy({ api: "", token: async () => null, wakeFetch: async () => ({}), toB64: () => "" });
    await copy.wipe();
    expect(Object.keys(local)).toEqual(["je_not_this"]);
    expect(Object.keys(session)).toEqual(["je_fill_1"]);
  });
});
