// Unit tests for the shared text helpers — specifically their tolerance of
// NON-STRING input. Indeed's embedded page JSON sometimes hands a field a number
// or an object where we expect text; before asText() that threw
// "(s || "").replace is not a function" and crashed the whole content script.
import { describe, it, expect } from "vitest";
import { clean, stripHtml, cleanMultiline, mergeJob } from "../src/extract/util.js";

describe("text helpers tolerate non-string input", () => {
  const weird = [null, undefined, 42, 0, true, false, { a: 1 }, ["x"], NaN];

  it("clean never throws and returns a string", () => {
    for (const v of weird) {
      expect(() => clean(v)).not.toThrow();
      expect(typeof clean(v)).toBe("string");
    }
    expect(clean("  a   b ")).toBe("a b");
    expect(clean(42)).toBe("42"); // primitives coerce
    expect(clean({ a: 1 })).toBe(""); // objects are malformed text → dropped
  });

  it("stripHtml and cleanMultiline never throw on non-strings", () => {
    for (const v of weird) {
      expect(() => stripHtml(v)).not.toThrow();
      expect(() => cleanMultiline(v)).not.toThrow();
    }
  });

  it("mergeJob skips an object-valued field instead of crashing", () => {
    const url = "https://www.indeed.com/jobs?q=x";
    // First candidate has a structured (object) location — the exact shape that
    // crashed extraction. mergeJob must ignore it and take the string source.
    const merged = mergeJob(
      [
        { via: "embedded", data: { title: "Sysadmin", location: { city: "Portland" } } },
        { via: "jsonld", data: { location: "Portland, OR" } },
      ],
      url,
    );
    expect(merged.title).toBe("Sysadmin");
    expect(merged.location).toBe("Portland, OR");
  });
});
