import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineBanner } from "@/components/layout/OfflineBanner";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

afterEach(() => setOnline(true));

describe("OfflineBanner", () => {
  it("is hidden while online", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears when the browser goes offline and hides when back online", () => {
    render(<OfflineBanner />);

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
