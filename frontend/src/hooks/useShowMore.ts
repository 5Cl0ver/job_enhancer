import { useCallback, useEffect, useRef, useState } from "react";

/** Items a long list draws at first, and how many each step adds. */
export const PAGE_SIZE = 30;

/**
 * Draw a long list a page at a time. Returns how many items to draw and a ref
 * for the "Show more" button: when that button scrolls into view the next page
 * is added, and pressing it does the same. Give the button `key={limit}` so it
 * is watched afresh after each page (a button still in view then loads again).
 * `resetKey` changing (a new filter, another stage) starts again from the
 * first page.
 */
export function useShowMore(resetKey: string) {
  const [state, setState] = useState({ key: resetKey, limit: PAGE_SIZE });
  // A different list: forget how far the last one was scrolled, so coming back
  // to it starts at one page again. (Adjusting state while rendering is
  // React's way to reset on a changed input without an extra painted frame.)
  if (state.key !== resetKey) setState({ key: resetKey, limit: PAGE_SIZE });
  const limit = state.key === resetKey ? state.limit : PAGE_SIZE;
  const showMore = useCallback(
    () => setState((s) => ({ key: s.key, limit: s.limit + PAGE_SIZE })),
    [],
  );

  const observer = useRef<IntersectionObserver | null>(null);
  const moreRef = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      if (!node || typeof IntersectionObserver === "undefined") return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) showMore();
        },
        { rootMargin: "300px" },
      );
      observer.current.observe(node);
    },
    [showMore],
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  return { limit, showMore, moreRef };
}
