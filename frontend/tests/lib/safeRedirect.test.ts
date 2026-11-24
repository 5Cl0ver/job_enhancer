import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/safeRedirect";

describe("safeRedirect: after sign-in, only ever a page inside the app", () => {
  it.each([
    ["/connect?code=K7QM-3XPD", "/connect?code=K7QM-3XPD"],
    ["/oauth/consent?authorization_id=abc", "/oauth/consent?authorization_id=abc"],
    ["/jobs#top", "/jobs#top"],
  ])("keeps %s", (input, out) => {
    expect(safeRedirect(input)).toBe(out);
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2f%2fevil.example",
    "/%2F%2Fevil.example",
    "%2f%2fevil.example",
    "/%5cevil.example",
    "/%252f%252fevil.example",
    "javascript:alert(1)",
    "/javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,hi",
    "/\tjavascript:alert(1)",
    "",
    "jobs",
    "/%E0%A4%A", // broken encoding
  ])("refuses %s", (input) => {
    expect(safeRedirect(input)).toBe("/");
  });

  it("refuses anything that isn't text", () => {
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect({ pathname: "/x" })).toBe("/");
  });
});
