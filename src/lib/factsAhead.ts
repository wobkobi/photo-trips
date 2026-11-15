// Reading the viewer side panel's details before a file is shown, so the panel lays out once
// instead of filling in section by section, and its map and suburb are ready. The keys here are
// the ones the panel reads with.
import { api, type MediaDetail } from "./api";
import { loadPhotoMap, warmMapTiles } from "./mapAhead";
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
 * Start on a spot's suburb name, map tiles and the map's code.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 */
function warmSpot(lat: number, lon: number): void {
  warmPlace(lat, lon);
  warmMapTiles(lat, lon);
  loadPhotoMap().catch(() => undefined);
}

/**
 * Start reading a library file's details, and on its spot (the index's location, or else the
 * file's own). Failures are left for the panel to retry.
 * @param detail - the file's indexed details
 */
export function warmLibraryFacts(detail: MediaDetail): void {
  if (detail.lat !== null && detail.lon !== null) warmSpot(detail.lat, detail.lon);
  readDetails(libraryKey(detail), () => api.mediaDetails(detail.id)).then(
    (details) => {
      const spot = detail.lat === null ? located(details) : null;
      if (spot) warmSpot(spot.lat, spot.lon);
    },
    () => undefined,
  );
}

/**
 * Start reading an import preview file's details, then on its spot from them.
 * @param previewId - the import preview
 * @param index - the file's index in the preview's items
 */
export function warmImportFacts(previewId: number, index: number): void {
  readDetails(importKey(previewId, index), () => api.importFileDetails(previewId, index)).then(
    (details) => {
      const spot = located(details);
      if (spot) warmSpot(spot.lat, spot.lon);
    },
    () => undefined,
  );
}
