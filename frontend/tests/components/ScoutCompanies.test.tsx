import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: (...args: unknown[]) => patch(...args),
    delete: vi.fn(),
  },
}));

import { ScoutCompanies } from "@/components/scout/ScoutCompanies";

const COMPANY = {
  id: "c1",
  name: "Brambleworks",
  website: "https://brambleworks.example",
  careers_url: "https://brambleworks.example/careers",
  last_checked_at: "2026-11-18T12:00:00Z",
  times_checked: 1,
  last_result: "openings",
  never_check: false,
  due: false,
};

function show() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({ onError: () => {} }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <ScoutCompanies />
    </QueryClientProvider>,
  );
}

describe("Local companies checked", () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
  });

  it("stays hidden until a search has checked some", async () => {
    get.mockResolvedValue([]);
    const { container } = show();
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("opens to each company, linked to its careers page", async () => {
    get.mockResolvedValue([
      COMPANY,
      { ...COMPANY, id: "c2", name: "Vellacor", last_result: "none" },
    ]);
    const user = userEvent.setup();
    show();
    const head = await screen.findByRole("button", {
      name: /Local companies checked \(2\)/,
    });
    expect(head).toHaveTextContent("1 had jobs listed last time");
    await user.click(head);
    expect(screen.getByRole("link", { name: /Brambleworks/ })).toHaveAttribute(
      "href",
      "https://brambleworks.example/careers",
    );
  });

  it("puts one first in line, or never checks it again", async () => {
    get.mockResolvedValue([COMPANY]);
    patch.mockResolvedValue(COMPANY);
    const user = userEvent.setup();
    show();
    await user.click(
      await screen.findByRole("button", { name: /Local companies checked/ }),
    );
    await user.click(screen.getByRole("button", { name: "Check next run" }));
    expect(patch).toHaveBeenCalledWith("/v1/scout/companies/c1", {
      check_next: true,
    });
    await user.click(screen.getByRole("button", { name: "Never check" }));
    expect(patch).toHaveBeenCalledWith("/v1/scout/companies/c1", {
      never_check: true,
    });
  });

  it("a skipped one can be checked again", async () => {
    get.mockResolvedValue([{ ...COMPANY, never_check: true }]);
    patch.mockResolvedValue(COMPANY);
    const user = userEvent.setup();
    show();
    await user.click(
      await screen.findByRole("button", { name: /Local companies checked/ }),
    );
    expect(
      screen.queryByRole("button", { name: "Never check" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(patch).toHaveBeenCalledWith("/v1/scout/companies/c1", {
      never_check: false,
    });
  });
});
