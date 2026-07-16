import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("q=python"),
}));

import { SearchFilters } from "@/components/jobs/SearchFilters";

describe("SearchFilters", () => {
  beforeEach(() => push.mockClear());

  it("renders all five filters", () => {
    render(<SearchFilters />);
    expect(screen.getByLabelText("Remote only")).toBeInTheDocument();
    expect(screen.getByLabelText("Job type")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum salary")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum salary")).toBeInTheDocument();
    expect(screen.getByLabelText("Experience level")).toBeInTheDocument();
  });

  it("toggling Remote only updates the URL and resets to page 1", async () => {
    const user = userEvent.setup();
    render(<SearchFilters />);

    await user.click(screen.getByLabelText("Remote only"));

    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("remote_only=true");
    expect(url).toContain("page=1");
    expect(url).toContain("q=python");
  });
});
