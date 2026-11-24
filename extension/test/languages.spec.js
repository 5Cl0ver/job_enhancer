// Spec 020 (US4): language levels 1–5 picked from whatever words a site uses.
import { describe, expect, it } from "vitest";
import { abilityOf, levelFor, levelOption } from "../src/autofill/classify/languages.js";

const opts = (...labels) => labels.map((label) => ({ label }));

describe("levelOption: the site's option for a level", () => {
  it("numbered options pick by number (Workday's 1 - Beginner … 5 - Fluent)", () => {
    const o = opts("Select One", "1 - Beginner", "2 - Classroom Study", "3 - Intermediate", "4 - Advanced", "5 - Fluent");
    expect(o[levelOption(5, o)].label).toBe("5 - Fluent");
    expect(o[levelOption(4, o)].label).toBe("4 - Advanced");
    expect(o[levelOption(1, o)].label).toBe("1 - Beginner");
  });

  it("a numbered scale of another length is rescaled", () => {
    const three = opts("1 - Low", "2 - Medium", "3 - High");
    expect(three[levelOption(5, three)].label).toBe("3 - High");
    expect(three[levelOption(1, three)].label).toBe("1 - Low");
    expect(three[levelOption(3, three)].label).toBe("2 - Medium");
  });

  it("words without numbers: the nearest level wins, a tie goes to the lower one", () => {
    const li = opts("Elementary proficiency", "Limited working proficiency", "Professional working proficiency", "Full professional proficiency", "Native or bilingual proficiency");
    expect(li[levelOption(5, li)].label).toBe("Native or bilingual proficiency");
    expect(li[levelOption(4, li)].label).toBe("Full professional proficiency");
    expect(li[levelOption(2, li)].label).toBe("Limited working proficiency");
    const basic = opts("Basic", "Intermediate", "Advanced", "Native");
    expect(basic[levelOption(5, basic)].label).toBe("Native");
    expect(basic[levelOption(1, basic)].label).toBe("Basic");
    const lmh = opts("Low", "Medium", "High");
    expect(lmh[levelOption(5, lmh)].label).toBe("High");
  });

  it("never guesses on options it can't read as levels", () => {
    expect(levelOption(3, opts("Apples", "Pears"))).toBe(-1);
    expect(levelOption(null, opts("1 - Beginner", "5 - Fluent"))).toBe(-1);
  });
});

describe("abilityOf and levelFor", () => {
  it("reads the ability from a box's label", () => {
    expect(abilityOf("Comprehension")).toBe("comprehension");
    expect(abilityOf("Listening")).toBe("comprehension");
    expect(abilityOf("Reading")).toBe("reading");
    expect(abilityOf("Speaking")).toBe("speaking");
    expect(abilityOf("Oral")).toBe("speaking");
    expect(abilityOf("Writing")).toBe("writing");
    expect(abilityOf("Proficiency")).toBe("overall");
  });

  it("a level falls back to overall, then to native = 5", () => {
    const es = { language: "Spanish", reading: 3, overall: 4 };
    expect(levelFor(es, "reading")).toBe(3);
    expect(levelFor(es, "speaking")).toBe(4);
    expect(levelFor({ language: "English", native: true }, "writing")).toBe(5);
    expect(levelFor({ language: "French" }, "writing")).toBe(null);
  });
});
