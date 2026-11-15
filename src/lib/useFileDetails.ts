// Loading what a file says about itself for the viewer's side panel.

import { useEffect, useState } from "react";
import type { FileDetails } from "./api";

/**
 * What the file says about itself, read when the viewer shows it. Null until it arrives, and
 * for a moment after stepping to another file.
 * @param key - changes whenever `load` would read a different file
 * @param load - reads the details; memoised by the caller
 * @returns the details, or null
 */
export function useFileDetails(key: string, load: () => Promise<FileDetails>): FileDetails | null {
  const [found, setFound] = useState<{ key: string; details: FileDetails } | null>(null);
  useEffect(() => {
    let active = true;
    // Missing details aren't worth an error: the panel just shows less.
    load().then(
      (details) => active && setFound({ key, details }),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [key, load]);
  return found?.key === key ? found.details : null;
}

/**
 * Where the file says it was taken.
 * @param details - the file's details, or null while they load
 * @returns the location, or null when there is none
 */
export function located(details: FileDetails | null): { lat: number; lon: number } | null {
  return details?.lat != null && details.lon != null
    ? { lat: details.lat, lon: details.lon }
    : null;
}
