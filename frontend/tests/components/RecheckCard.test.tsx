import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  getAccessToken: vi.fn().mockResolvedValue("token"),
  API_BASE: "http://localhost:8000",
}));

import { RecheckCard } from "@/components/email/RecheckCard";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecheckCard />
    </QueryClientProvider>,
  );
}

describe("Re-check the last 30 days (spec 027)", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("starts it, then says what it found and that nothing moved", async () => {
    get.mockResolvedValueOnce({ state: "idle" });
    post.mockResolvedValue({ state: "running", days: 30 });
    wrap();
    await userEvent.click(await screen.findByRole("button", { name: /Re-check 30 days/ }));
    expect(post).toHaveBeenCalledWith("/v1/email/recheck", { days: 30 });
    expect(await screen.findByText(/This takes a few minutes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-checking/ })).toBeDisabled();
  });

  it("shows the result", async () => {
    get.mockResolvedValue({ state: "done", days: 30, found: 12, noted: 11, waiting: 1 });
    wrap();
    await waitFor(() =>
      expect(screen.getByText("Found 12 emails: 11 kept on your jobs, 1 waiting for you. No card was moved.")).toBeInTheDocument(),
    );
  });
});
