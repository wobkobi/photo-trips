// Narrowing the Library timeline to one trip, one year, photos or videos, or dates that may be
// wrong.

import type { Tile } from "./api";

/** A trip as the filter knows it; the name is kept so a trip with no photos can still be named. */
export interface FilterTrip {
  id: number;
  name: string;
}

export interface LibraryFilter {
  /** "any" for everything, "none" for photos on no trip, or one trip. */
  trip: "any" | "none" | FilterTrip;
  /** A year such as "2024", or "any". */
  year: string;
  kind: "all" | "photos" | "videos";
  /** Only photos whose date was guessed from when the file was last changed. */
  uncertain: boolean;
  /** Only files whose name holds this text, in any case; "" for all. */
  name: string;
}

export const NO_FILTER: LibraryFilter = {
  trip: "any",
  year: "any",
  kind: "all",
  uncertain: false,
  name: "",
};

/**
 * Whether the filter hides anything.
 * @param filter - the filter
 * @returns true when any part of it is set
 */
export function isFiltered(filter: LibraryFilter): boolean {
  return (
    filter.trip !== "any" ||
    filter.year !== "any" ||
    filter.kind !== "all" ||
    filter.uncertain ||
    filter.name.trim() !== ""
  );
}

/**
 * Whether one tile passes the filter. RAW files count as photos.
 * @param tile - the tile
 * @param filter - the filter
 * @returns true when the tile should show
 */
function matches(tile: Tile, filter: LibraryFilter): boolean {
  if (filter.trip === "none" && tile.trip) return false;
  if (typeof filter.trip === "object" && tile.trip?.id !== filter.trip.id) return false;
  if (filter.year !== "any" && !tile.takenAt.startsWith(filter.year)) return false;
  if (filter.kind === "photos" && tile.kind === "video") return false;
  if (filter.kind === "videos" && tile.kind !== "video") return false;
  const name = filter.name.trim().toLowerCase();
  if (name !== "" && !tile.name.toLowerCase().includes(name)) return false;
  return !filter.uncertain || tile.uncertain;
}

/**
 * The tiles that pass the filter, in their original order.
 * @param tiles - every tile, newest first
 * @param filter - the filter
 * @returns the same array when nothing is filtered, otherwise the matching tiles
 */
export function filterTiles(tiles: Tile[], filter: LibraryFilter): Tile[] {
  return isFiltered(filter) ? tiles.filter((tile) => matches(tile, filter)) : tiles;
}

/**
 * The trips and years to offer, newest first, from what's in the library. A chosen trip that no
 * longer has any photos is still offered so the menu can show what's picked.
 * @param tiles - every tile, newest first
 * @param filter - the current filter
 * @returns trips and years
 */
export function filterChoices(
  tiles: Tile[],
  filter: LibraryFilter,
): { trips: FilterTrip[]; years: string[]; videos: boolean; uncertain: boolean } {
  const trips = new Map<number, FilterTrip>();
  const years = new Set<string>();
  let videos = false;
  let uncertain = false;
  for (const tile of tiles) {
    if (tile.trip && !trips.has(tile.trip.id)) {
      trips.set(tile.trip.id, { id: tile.trip.id, name: tile.trip.name });
    }
    years.add(tile.takenAt.slice(0, 4));
    videos ||= tile.kind === "video";
    uncertain ||= tile.uncertain;
  }
  if (typeof filter.trip === "object" && !trips.has(filter.trip.id)) {
    trips.set(filter.trip.id, filter.trip);
  }
  if (filter.year !== "any") years.add(filter.year);
  return {
    trips: [...trips.values()],
    years: [...years].sort().reverse(),
    videos,
    uncertain,
  };
}
