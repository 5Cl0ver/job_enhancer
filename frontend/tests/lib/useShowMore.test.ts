import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, useShowMore } from "@/hooks/useShowMore";

describe("useShowMore", () => {
  it("adds a page each time", () => {
    const { result } = renderHook(() => useShowMore("all"));
    expect(result.current.limit).toBe(PAGE_SIZE);
    act(() => result.current.showMore());
    act(() => result.current.showMore());
    expect(result.current.limit).toBe(PAGE_SIZE * 3);
  });

  it("starts again at one page when the list changes, and when it changes back", () => {
    const { result, rerender } = renderHook(({ key }) => useShowMore(key), {
      initialProps: { key: "all" },
    });
    act(() => result.current.showMore());
    act(() => result.current.showMore());

    rerender({ key: "interview" });
    expect(result.current.limit).toBe(PAGE_SIZE);
    // Back to the long list: one page again, not the 90 rows scrolled to before.
    rerender({ key: "all" });
    expect(result.current.limit).toBe(PAGE_SIZE);
  });
});
