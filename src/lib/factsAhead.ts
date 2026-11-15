// Reading the viewer side panel's details before a file is shown, so the panel lays out once
// instead of filling in section by section. The keys here are the ones the panel reads with.
import { api, type MediaDetail } from "./api";
import { warmPlace } from "./places";
import { located, readDetails } from "./useFileDetails";

/**
 * Cache key for a library file's details; the version changes when the file does.
 * @param detail - the file's indexed details
 * @returns the key
 */
export function libraryKey(detail: MediaDetail): string {
  return `m${detail.id}-${detail.version}`;
}

/**
 * Cache key for an import preview file's details.
 * @param previewId - the import preview
 * @param index - the file's index in the preview's items
 * @returns the key
 */
export function importKey(previewId: number, index: number): string {
  return `i${previewId}-${index}`;
}

/**
 * Start reading a library file's details and its suburb's name, from the index's location or
 * else the file's own. Failures are left for the panel to retry.
 * @param detail - the file's indexed details
 */
export function warmLibraryFacts(detail: MediaDetail): void {
  if (detail.lat !== null && detail.lon !== null) warmPlace(detail.lat, detail.lon);
  readDetails(libraryKey(detail), () => api.mediaDetails(detail.id)).then(
    (details) => {
      const spot = detail.lat === null ? located(details) : null;
      if (spot) warmPlace(spot.lat, spot.lon);
    },
    () => undefined,
  );
}

/**
 * Start reading an import preview file's details, then its suburb's name from them.
 * @param previewId - the import preview
 * @param index - the file's index in the preview's items
 */
export function warmImportFacts(previewId: number, index: number): void {
  readDetails(importKey(previewId, index), () => api.importFileDetails(previewId, index)).then(
    (details) => {
      const spot = located(details);
      if (spot) warmPlace(spot.lat, spot.lon);
    },
    () => undefined,
  );
}
