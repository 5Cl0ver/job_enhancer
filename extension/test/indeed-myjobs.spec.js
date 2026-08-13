// Unit tests for reading Indeed's "My jobs" applied list into sync-ready
// applications, against a saved (sanitized) fixture of the real .atw-* markup.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { readApplications, statusToStage } from "../src/extract/indeed-myjobs.js";

const here = dirname(fileURLToPath(import.meta.url));

function docFrom(fixture) {
  const html = readFileSync(join(here, "fixtures", fixture), "utf8");
  const window = new Window();
  window.document.write(html);
  return window.document;
}

describe("statusToStage — board badge → pipeline stage", () => {
  it("maps Indeed statuses to the right stage", () => {
    expect(statusToStage("Applied")).toBe("Applied");
    expect(statusToStage("Application viewed")).toBe("Applied");
    expect(statusToStage("Not selected by employer")).toBe("Rejected");
    expect(statusToStage("Interview")).toBe("Interview");
    expect(statusToStage("Job closed or expired")).toBe("Applied");
    expect(statusToStage("Something new")).toBe("Applied"); // safe default
  });
});

describe("readApplications — parse the My jobs list", () => {
  it("reads every application with title, company, location, status, stage, url", () => {
    const apps = readApplications(docFrom("indeed-myjobs.html"));
    expect(apps).toHaveLength(3);

    const applied = apps[0];
    expect(applied.title).toBe("IT Manager/Front End Lead"); // a11y helper text stripped
    expect(applied.company).toBe("Veriheal");
    expect(applied.location).toBe("Portland, OR");
    expect(applied.status).toBe("Applied");
    expect(applied.stage).toBe("Applied");
    expect(applied.url).toContain("viewjob?jk=13452735e0c7c74a");
    expect(applied.jobKey).toBe("13452735e0c7c74a");

    // The rejected one maps to the Rejected stage.
    const rejected = apps.find((a) => a.company === "Electrical Training Institute");
    expect(rejected.status).toBe("Not selected by employer");
    expect(rejected.stage).toBe("Rejected");

    // The interview one maps to Interview.
    const interview = apps.find((a) => a.company === "Nscale");
    expect(interview.stage).toBe("Interview");
  });

  it("returns nothing on a page with no application cards", () => {
    const window = new Window();
    window.document.write("<html><body><h1>My jobs</h1></body></html>");
    expect(readApplications(window.document)).toEqual([]);
  });
});
