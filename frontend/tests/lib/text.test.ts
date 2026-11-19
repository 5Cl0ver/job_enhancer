import { describe, expect, it } from "vitest";
import { plainText } from "@/lib/text";

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
