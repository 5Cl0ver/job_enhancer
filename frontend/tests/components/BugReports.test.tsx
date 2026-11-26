// Spec 030: the admin's Bug reports: grouped by kind, open first, copied as
// Markdown for Claude, marked Fixed or Ignore.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const patch = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: (...args: unknown[]) => patch(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import { BugReportsCard } from "@/components/admin/BugReportsCard";

const BASE = {
  at: "2026-11-25T10:00:00+00:00",
  page: "https://northwind.example/apply/2",
  count: 1,
  site: "northwind.example",
  job: "IT Engineer at Northwind Labs",
  user_email: "alex@example.com",
  job_catcher: "0.42.0",
  playbook: "2026.11.30",
};
const ROWS = [
  { ...BASE, id: "p1", run_id: "r1", kind: "job_catcher", what: "Said no résumé box", status: "open" },
  { ...BASE, id: "p2", run_id: "r1", kind: "tab", what: "The tab closed", status: "open" },
  { ...BASE, id: "p3", run_id: "r2", kind: "job_catcher", what: "Fill timed out", status: "fixed" },
];

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BugReportsCard />
    </QueryClientProvider>,
  );
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  get.mockReset().mockResolvedValue(ROWS);
  patch.mockReset();
  toastSuccess.mockReset();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("Bug reports", () => {
  it("shows the open ones grouped by kind, and all on the toggle", async () => {
    wrap();
    const jc = await screen.findByRole("region", { name: "Job Catcher" });
    expect(within(jc).getByText("Said no résumé box")).toBeInTheDocument();
    expect(within(jc).queryByText("Fill timed out")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Lost tab" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open (2)" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "All (3)" }));
    expect(within(screen.getByRole("region", { name: "Job Catcher" })).getByText("Fill timed out")).toBeInTheDocument();
    expect(screen.getByText("fixed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open again/ })).toBeInTheDocument();
  });

  it("copies one report, or every open one, for Claude", async () => {
    wrap();
    const jc = await screen.findByRole("region", { name: "Job Catcher" });
    await userEvent.click(within(jc).getByRole("button", { name: /Copy for Claude/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("# Bug report: Job Catcher on northwind.example"));
    expect(writeText.mock.calls[0][0]).toContain("## What happened\n\nSaid no résumé box");
    expect(toastSuccess).toHaveBeenCalledWith("Copied");

    await userEvent.click(screen.getByRole("button", { name: /Copy all open/ }));
    const all = writeText.mock.calls[1][0] as string;
    expect(all.startsWith("# Open bug reports (2)")).toBe(true);
    expect(all).not.toContain("Fill timed out");
  });

  it("falls back to a box to copy by hand when the clipboard is blocked", async () => {
    writeText.mockRejectedValue(new Error("blocked"));
    wrap();
    const jc = await screen.findByRole("region", { name: "Job Catcher" });
    await userEvent.click(within(jc).getByRole("button", { name: /Copy for Claude/ }));
    const box = await screen.findByLabelText("Bug report to copy");
    expect((box as HTMLTextAreaElement).value).toContain("# Bug report: Job Catcher");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("marks one fixed", async () => {
    patch.mockResolvedValue({ ...ROWS[1], status: "fixed" });
    wrap();
    const tab = await screen.findByRole("region", { name: "Lost tab" });
    await userEvent.click(within(tab).getByRole("button", { name: /Fixed/ }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/v1/admin/apply-problems/r1/p2", { status: "fixed" }),
    );
    // Gone from the open list.
    await waitFor(() => expect(screen.queryByRole("region", { name: "Lost tab" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open (1)" })).toBeInTheDocument();
  });
});
