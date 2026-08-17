// Unit tests for the Workday "Work Experience" filler, against a fixture of
// Workday's real automation-id markup.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import {
  isWorkdayExperience,
  collectWorkExperienceBlocks,
  fillWorkExperience,
  fillAllWorkExperience,
  collectWorkdayDropdowns,
  fillWorkdayDropdowns,
} from "../src/autofill/workday.js";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = { wait: () => Promise.resolve() }; // drive async filling synchronously

function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const window = new Window();
  window.document.write(html);
  return window.document;
}

const monthOf = (container) => container.querySelector('[data-automation-id="dateSectionMonth-input"]').value;
const yearOf = (container) => container.querySelector('[data-automation-id="dateSectionYear-input"]').value;

const ENTRY = (over = {}) => ({
  title: "IT Support Technician",
  company: "Logical Position",
  location: "Beaverton, OR",
  description: "Did the thing.",
  start_month: 10,
  start_year: 2022,
  end_month: 9,
  end_year: 2024,
  current: false,
  ...over,
});

describe("Workday work-experience filler", () => {
  it("detects a Workday experience form", () => {
    expect(isWorkdayExperience(docFrom("workday-experience.html"))).toBe(true);
    const empty = new Window();
    empty.document.write("<html><body><input /></body></html>");
    expect(isWorkdayExperience(empty.document)).toBe(false);
  });

  it("collects each block with all its inputs, in order", () => {
    const blocks = collectWorkExperienceBlocks(docFrom("workday-experience.html"));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].title.id).toBe("workExperience-1--jobTitle");
    expect(blocks[0].role).toBeTruthy();
    expect(blocks[0].startDate).toBeTruthy();
  });

  it("fills every field — title, company, location, role, current, and both date parts", async () => {
    const doc = docFrom("workday-experience.html");
    const blocks = collectWorkExperienceBlocks(doc);
    const res = await fillWorkExperience(
      blocks,
      [ENTRY({ current: true, end_month: null, end_year: null }), ENTRY({ title: "Analyst", company: "Acme" })],
      NOW,
    );
    expect(res.filled).toBe(2);

    const b = blocks[0];
    expect(b.title.value).toBe("IT Support Technician");
    expect(b.company.value).toBe("Logical Position");
    expect(b.location.value).toBe("Beaverton, OR");
    expect(b.role.value).toBe("Did the thing.");
    expect(b.current.checked).toBe(true);
    // BOTH date parts land (the year no longer drops).
    expect(monthOf(b.startDate)).toBe("10");
    expect(yearOf(b.startDate)).toBe("2022");
    // A current role leaves the end date empty.
    expect(yearOf(b.endDate)).toBe("");

    // Block 2 — a past job with a full range; month padded to MM.
    expect(monthOf(blocks[1].endDate)).toBe("09");
    expect(yearOf(blocks[1].endDate)).toBe("2024");
  });

  it("never writes a lone date part (no '09/' error)", async () => {
    const doc = docFrom("workday-experience.html");
    const blocks = collectWorkExperienceBlocks(doc);
    await fillWorkExperience(blocks, [ENTRY({ start_month: 5, start_year: null, end_month: null, end_year: 2024 })], NOW);
    expect(monthOf(blocks[0].startDate)).toBe("");
    expect(yearOf(blocks[0].endDate)).toBe("");
  });

  it("clears a half-filled date left by a prior pass", async () => {
    const doc = docFrom("workday-experience.html");
    const blocks = collectWorkExperienceBlocks(doc);
    blocks[0].startDate.querySelector('[data-automation-id="dateSectionMonth-input"]').value = "09";
    await fillWorkExperience(blocks, [ENTRY({ start_month: null, start_year: null })], NOW);
    expect(monthOf(blocks[0].startDate)).toBe("");
  });

  it("clicks 'Add Another' to make a block per résumé job, then fills them all", async () => {
    const doc = docFrom("workday-experience.html");
    const template = collectWorkExperienceBlocks(doc)[0].root;
    let n = 2;
    doc.querySelector('[data-automation-id="add-button"]').addEventListener("click", () => {
      n += 1;
      const clone = template.cloneNode(true);
      clone.setAttribute("data-fkit-id", `workExperience-${n}--null`);
      clone.querySelectorAll("input, textarea").forEach((el) => (el.value = ""));
      clone.querySelector('[data-automation-id="formField-jobTitle"] input').id = `workExperience-${n}--jobTitle`;
      template.parentElement.appendChild(clone);
    });

    const entries = [ENTRY({ title: "A" }), ENTRY({ title: "B" }), ENTRY({ title: "C" }), ENTRY({ title: "D" })];
    const res = await fillAllWorkExperience(doc, entries, NOW);
    const blocks = collectWorkExperienceBlocks(doc);
    expect(blocks.length).toBe(4);
    expect(res.filled).toBe(4);
    expect(blocks[3].title.value).toBe("D");
  });
});

// Simulate Workday's listbox: clicking a listbox button renders options; clicking
// an option sets the button text and removes the list.
function wireListbox(doc, optionLabels = ["Select One", "Yes", "No"]) {
  for (const btn of doc.querySelectorAll('button[aria-haspopup="listbox"]')) {
    btn.addEventListener("click", () => {
      const open = doc.getElementById("je-test-lb");
      if (open) {
        open.remove();
        return;
      } // toggle closed
      const lb = doc.createElement("div");
      lb.id = "je-test-lb";
      for (const label of optionLabels) {
        const o = doc.createElement("div");
        o.setAttribute("role", "option");
        o.setAttribute("data-automation-label", label);
        o.textContent = label;
        o.addEventListener("click", () => {
          btn.textContent = label;
          lb.remove();
        });
        lb.appendChild(o);
      }
      doc.body.appendChild(lb);
    });
  }
}

describe("Workday questionnaire dropdowns", () => {
  it("collects each dropdown with its question text", () => {
    const dds = collectWorkdayDropdowns(docFrom("workday-questions.html"));
    expect(dds).toHaveLength(3);
    expect(dds[0].question).toMatch(/authorized for employment/i);
  });

  it("fills profile Yes/No questions (work authorization, sponsorship) with no AI", async () => {
    const doc = docFrom("workday-questions.html");
    wireListbox(doc);
    const filled = await fillWorkdayDropdowns(
      doc,
      { authorized_to_work: true, requires_sponsorship: false },
      [],
      NOW, // no aiMap → the legal q3 is left alone
    );
    const btns = doc.querySelectorAll('button[aria-haspopup="listbox"]');
    expect(btns[0].textContent).toBe("Yes"); // authorized
    expect(btns[1].textContent).toBe("No"); // sponsorship
    expect(btns[2].textContent).toBe("Select One"); // legal q left for the user
    expect(filled.map((f) => f.value)).toEqual(["Yes", "No"]);
  });

  it("AI FALLBACK: one batched call for all unknown dropdowns, applies the picks", async () => {
    const doc = docFrom("workday-questions.html");
    wireListbox(doc);
    let calls = 0;
    // Batched: receives ALL unknown dropdowns at once, returns {id: answer}.
    const aiMap = async (fields) => {
      calls += 1;
      expect(fields.length).toBe(3); // all three unknown (no profile passed)
      expect(fields[0].options).toEqual(["Yes", "No"]); // "Select One" filtered
      const out = {};
      fields.forEach((f) => {
        out[f.id] = /prohibition/i.test(f.label) ? "No" : "Yes";
      });
      return out;
    };
    const filled = await fillWorkdayDropdowns(doc, {}, [], { wait: () => Promise.resolve(), aiMap });
    expect(calls).toBe(1); // ONE round-trip for the whole page
    const btns = doc.querySelectorAll('button[aria-haspopup="listbox"]');
    expect(btns[2].textContent).toBe("No"); // AI-picked legal question
    expect(filled.every((f) => f.source === "ai")).toBe(true);
    expect(filled).toHaveLength(3);
  });
});

describe("Workday self-ID guard", () => {
  function docFromHtml(html) {
    const window = new Window();
    window.document.write(html);
    return window.document;
  }
  const field = (q) =>
    `<div data-automation-id="formField-x"><fieldset><legend>` +
    `<span data-automation-id="richText">${q}</span></legend>` +
    `<button aria-haspopup="listbox">Select One</button></fieldset></div>`;

  it("excludes protected self-ID dropdowns (ethnicity/gender/veteran/disability)", () => {
    const doc = docFromHtml(
      field("Gender") +
        field("Ethnicity") +
        field("Veteran Status") +
        field("Disability status") +
        field("Are you legally authorized to work in the US?"),
    );
    const questions = collectWorkdayDropdowns(doc).map((d) => d.question);
    expect(questions).toEqual(["Are you legally authorized to work in the US?"]);
  });

  it("never AI-guesses self-ID even with an aiMap available", async () => {
    const doc = docFromHtml(field("What is your gender?"));
    let called = false;
    await fillWorkdayDropdowns(doc, {}, [], {
      wait: () => Promise.resolve(),
      aiMap: async () => {
        called = true;
        return {};
      },
    });
    expect(called).toBe(false); // self-ID never reaches the AI
  });
});
