import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { SearchFilters } from "@/components/jobs/SearchFilters";

// SearchFilters navigates via react-router's useNavigate. To assert what URL it
// pushes, we render a probe that mirrors the current location into the DOM.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderFilters(initialUrl = "/search?q=python") {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <SearchFilters />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("SearchFilters", () => {
  it("renders all five filters", () => {
    renderFilters();
    expect(screen.getByLabelText("Remote only")).toBeInTheDocument();
    expect(screen.getByLabelText("Job type")).toBeInTheDocument();
    expect(screen.getByLabelText("Minimum salary")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum salary")).toBeInTheDocument();
    expect(screen.getByLabelText("Experience level")).toBeInTheDocument();
  });

  it("toggling Remote only updates the URL and resets to page 1", async () => {
    const user = userEvent.setup();
    renderFilters("/search?q=python");

    await user.click(screen.getByLabelText("Remote only"));

    const url = screen.getByTestId("location").textContent ?? "";
    expect(url).toContain("remote_only=true");
    expect(url).toContain("page=1");
    // The existing query (q=python) is preserved across the filter change.
    expect(url).toContain("q=python");
  });
});
