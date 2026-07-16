import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue([]),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { AddJobDialog } from "@/components/jobs/AddJobDialog";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    // Observe errors so vitest doesn't flag them as unhandled rejections
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AddJobDialog (FR-004a)", () => {
  beforeEach(() => post.mockReset());

  it("submits the pasted job to the manual endpoint", async () => {
    post.mockResolvedValue({ id: "sj1" });
    const user = userEvent.setup();
    renderWithQuery(<AddJobDialog />);

    await user.click(screen.getByRole("button", { name: /add job/i }));
    await user.type(
      screen.getByLabelText("Job link"),
      "https://www.linkedin.com/jobs/view/123",
    );
    await user.type(screen.getByLabelText("Job title"), "Staff Engineer");
    await user.type(screen.getByLabelText("Company"), "Acme");
    await user.click(screen.getByRole("button", { name: /save job/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/v1/saved-jobs/manual", {
      url: "https://www.linkedin.com/jobs/view/123",
      title: "Staff Engineer",
      company: "Acme",
      location: undefined,
      is_remote: false,
    });
  });

  it("shows a friendly message when the job is already saved", async () => {
    // Render the 409 error branch directly (async error routing is covered
    // by the backend duplicate test).
    const hooks = await import("@/hooks/useSavedJobs");
    const spy = vi.spyOn(hooks, "useAddManualJob").mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("409 Conflict"),
      reset: vi.fn(),
    } as unknown as ReturnType<typeof hooks.useAddManualJob>);

    const user = userEvent.setup();
    renderWithQuery(<AddJobDialog />);
    await user.click(screen.getByRole("button", { name: /add job/i }));

    expect(
      await screen.findByText(/already saved this job/i),
    ).toBeInTheDocument();
    spy.mockRestore();
  });
});
