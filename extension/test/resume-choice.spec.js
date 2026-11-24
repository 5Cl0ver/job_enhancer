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
