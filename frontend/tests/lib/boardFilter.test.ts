import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  columnView,
  highlightParts,
  matchesSearch,
  searchWords,
  stageFor,
} from "@/lib/boardFilter";
import type { SavedJob } from "@/types/api";

function job(id: string, title: string, company: string, stage: string | null = "s1"): SavedJob {
  return {
    id,
    pipeline_stage_id: stage,
    job_listing: { title, company } as SavedJob["job_listing"],
  } as SavedJob;
}

describe("matchesSearch", () => {
  const admin = job("1", "IT Systems Administrator", "Vellacor");

  it("finds a job by title or company, any case", () => {
    expect(matchesSearch(admin, searchWords("vella"))).toBe(true);
    expect(matchesSearch(admin, searchWords("SYSTEMS"))).toBe(true);
    expect(matchesSearch(admin, searchWords("brambleworks"))).toBe(false);
  });

  it("needs every word, across title and company", () => {
    expect(matchesSearch(admin, searchWords("admin vellacor"))).toBe(true);
    expect(matchesSearch(admin, searchWords("admin quillstone"))).toBe(false);
  });

  it("an empty search matches everything", () => {
    expect(matchesSearch(admin, searchWords("   "))).toBe(true);
  });
});

describe("columnView", () => {
  const many = Array.from({ length: 100 }, (_, i) =>
    job(String(i), i === 77 ? "Jira Administrator" : "Analyst", i === 77 ? "Quillstone" : "Vellacor"),
  );

  it("shows the first page and counts what is left", () => {
    const view = columnView(many, [], PAGE_SIZE);
    expect(view.visible).toHaveLength(PAGE_SIZE);
    expect(view.hidden).toBe(70);
    expect(view.matches).toBe(100);
  });

  it("puts a match first even when it sits past the first page", () => {
    const view = columnView(many, searchWords("jira"), PAGE_SIZE);
    expect(view.visible[0].id).toBe("77");
    expect(view.matches).toBe(1);
    expect(view.visible).toHaveLength(PAGE_SIZE);
  });

  it("never hides a match behind Show more", () => {
    const view = columnView(many, searchWords("vellacor"), PAGE_SIZE);
    expect(view.matches).toBe(99);
    expect(view.visible).toHaveLength(99);
    expect(view.hidden).toBe(1);
  });
});

describe("stageFor", () => {
  it("keeps a job in its own stage", () => {
    expect(stageFor(job("1", "a", "b", "s2"), ["s1", "s2"])).toBe("s2");
  });

  it("puts a job with no stage, or a deleted stage, in the first column", () => {
    expect(stageFor(job("1", "a", "b", null), ["s1", "s2"])).toBe("s1");
    expect(stageFor(job("1", "a", "b", "gone"), ["s1", "s2"])).toBe("s1");
  });
});

describe("highlightParts", () => {
  it("marks the matched text and keeps its original case", () => {
    expect(highlightParts("IT Systems Administrator", searchWords("systems"))).toEqual([
      { text: "IT ", hit: false },
      { text: "Systems", hit: true },
      { text: " Administrator", hit: false },
    ]);
  });

  it("treats search punctuation as plain text", () => {
    expect(highlightParts("C++ Developer (Remote)", searchWords("c++ ("))).toEqual([
      { text: "C++", hit: true },
      { text: " Developer ", hit: false },
      { text: "(", hit: true },
      { text: "Remote)", hit: false },
    ]);
  });
});
