import { describe, expect, it } from "vitest";
import { cleanJob, plainText } from "@/lib/text";

describe("plainText", () => {
  it("turns leftover HTML entities back into characters", () => {
    expect(plainText("AVP, Agentic &amp; Generative AI PM")).toBe("AVP, Agentic & Generative AI PM");
    expect(plainText("R&amp;D &lt;Platform&gt; &quot;Lead&quot;")).toBe('R&D <Platform> "Lead"');
    expect(plainText("Vellacor&#39;s IT &#x2013; Remote")).toBe("Vellacor's IT – Remote");
  });

  it("leaves ordinary text and unknown entities alone", () => {
    expect(plainText("Help Desk & Support")).toBe("Help Desk & Support");
    expect(plainText("Tom &notathing; Jerry")).toBe("Tom &notathing; Jerry");
  });

  it("reads missing text as empty", () => {
    expect(plainText(null)).toBe("");
    expect(plainText(undefined)).toBe("");
  });
});

describe("cleanJob", () => {
  it("cleans the title and company and keeps everything else", () => {
    const job = { id: "1", title: "R&amp;D Engineer", company: "Vellacor &amp; Sons", location: "Remote" };
    expect(cleanJob(job)).toEqual({
      id: "1",
      title: "R&D Engineer",
      company: "Vellacor & Sons",
      location: "Remote",
    });
  });

  it("returns the same object when there is nothing to clean", () => {
    const job = { title: "IT Systems Administrator", company: "Vellacor" };
    expect(cleanJob(job)).toBe(job);
  });
});
