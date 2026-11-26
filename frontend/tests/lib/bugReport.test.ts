import { describe, expect, it } from "vitest";
import { allOpenReport, bugReport, utcTime } from "@/lib/bugReport";
import type { ApplyProblem } from "@/lib/apply";

const P: ApplyProblem = {
  id: "p1",
  at: "2026-11-25T10:07:30+00:00",
  kind: "job_catcher",
  what: "Job Catcher said no résumé box, but there is one",
  page: "https://northwind.wd1.myworkdayjobs.com/en-US/careers/job/Senior-Engineer_R0012345/apply",
  count: 2,
  status: "open",
  site: "northwind.wd1.myworkdayjobs.com",
  run_id: "run-1",
  job: "IT Engineer at Northwind Labs",
  job_catcher: "0.42.0",
  playbook: "2026.11.30",
};

describe("bug report Markdown (spec 030)", () => {
  it("has the heading, the context, what happened and the page", () => {
    expect(bugReport(P)).toBe(
      [
        "# Bug report: Job Catcher on northwind.wd1.myworkdayjobs.com",
        "",
        "- Run: run-1",
        "- Job: IT Engineer at Northwind Labs",
        "- Site: northwind.wd1.myworkdayjobs.com",
        "- Job Catcher: 0.42.0",
        "- Playbook: 2026.11.30",
        "- When: 2026-11-25 10:07 UTC (2 times)",
        "",
        "## What happened",
        "",
        "Job Catcher said no résumé box, but there is one",
        "",
        "## Page",
        "",
        P.page,
      ].join("\n"),
    );
  });

  it("says unknown for what it doesn't have, and finds the site from the page", () => {
    const md = bugReport({ ...P, site: null, job_catcher: null, count: 1, kind: "tab" });
    expect(md).toContain("# Bug report: Lost tab on northwind.wd1.myworkdayjobs.com");
    expect(md).toContain("- Job Catcher: unknown");
    expect(md).not.toContain("times)");
    expect(bugReport({ ...P, site: null, page: null })).toContain("# Bug report: Job Catcher\n");
  });

  it("joins the open ones under one heading with a count", () => {
    const md = allOpenReport([
      P,
      { ...P, id: "p2", status: "fixed" },
      { ...P, id: "p3", kind: "fill", what: "Salary box refused text" },
    ]);
    expect(md.startsWith("# Open bug reports (2)\n\n## Bug report: Job Catcher")).toBe(true);
    expect(md).toContain("## Bug report: A box it couldn't fill");
    expect(md).toContain("### What happened\n\nSalary box refused text");
    expect(md.match(/## Bug report/g)).toHaveLength(2);
  });

  it("writes times in UTC", () => {
    expect(utcTime("2026-11-25T02:07:00-08:00")).toBe("2026-11-25 10:07 UTC");
  });
});
