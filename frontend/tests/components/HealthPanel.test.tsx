import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  api: { get: (...a: unknown[]) => get(...a) },
  ApiError: class extends Error {},
}));

import { HealthPanel } from "@/components/admin/HealthPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HealthPanel />
    </QueryClientProvider>,
  );
}

describe("Service Health", () => {
  it("shows a service with no key as Off, and what each check said", async () => {
    get.mockResolvedValue([
      { name: "Database", status: "healthy", latency_ms: 4, detail: null },
      { name: "Adzuna", status: "degraded", latency_ms: 120, detail: "Key rejected" },
      { name: "JSearch", status: "off", latency_ms: null, detail: "Not set up" },
    ]);
    renderPanel();
    expect(await screen.findByText("JSearch")).toBeInTheDocument();
    expect(screen.getByText("off")).toBeInTheDocument();
    expect(screen.getByText("Not set up")).toBeInTheDocument();
    expect(screen.getByText("Key rejected")).toBeInTheDocument();
    expect(screen.queryByText("down")).toBeNull();
  });
});
