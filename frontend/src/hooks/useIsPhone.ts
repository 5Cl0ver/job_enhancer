import { useSyncExternalStore } from "react";

/** Under this width the app uses its phone layout (Tailwind's `md` is 768px). */
const PHONE = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True on a phone-sized screen. For the places where the phone and desktop
 * layouts are different components (which page to open first, rows instead of
 * cards); plain size and spacing differences stay in Tailwind classes.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
