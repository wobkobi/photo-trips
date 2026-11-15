import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept up to date as the window resizes or zooms. Queries are
 * in CSS pixels, so a larger text size (which zooms the window) makes width queries match sooner.
 * @param query - a media query such as `(max-width: 800px)`
 * @returns true while the query matches
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
