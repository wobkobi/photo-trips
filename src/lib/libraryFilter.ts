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
  /**
   * Only tiles whose file, or a file that goes with it, has a name holding this text, in any
   * case; "" for all.
   */
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
 * The trip the filter shows, which makes the Library that trip's page.
 * @param filter - the filter
 * @returns the trip, or null for the whole library (including "Not on a trip")
 */
export function tripOf(filter: LibraryFilter): FilterTrip | null {
  return typeof filter.trip === "object" ? filter.trip : null;
}

/**
 * Whether the filter hides anything beyond the trip on show, so Clear filters has something to
 * clear. "Not on a trip" counts, since it's a filter rather than a place.
 * @param filter - the filter
 * @returns true when any part other than a chosen trip is set
 */
export function isFilteredBesidesTrip(filter: LibraryFilter): boolean {
  return isFiltered({ ...filter, trip: tripOf(filter) === null ? filter.trip : "any" });
}

/**
 * The filter with everything cleared but the trip on show.
 * @param filter - the filter
 * @returns no filter, still in the same trip if there is one
 */
export function clearFilters(filter: LibraryFilter): LibraryFilter {
  return { ...NO_FILTER, trip: tripOf(filter) ?? "any" };
}

/** One active filter as a chip under the toolbar, with the filter that removing it leaves. */
export interface FilterChip {
  id: "kind" | "year" | "uncertain" | "trip";
  label: string;
  without: LibraryFilter;
}

/**
 * The chips for the filters in use, besides the trip on show and the name (the search box shows
 * that). Kind comes first as it sits first in the toolbar, then the Filter popover's in its order.
 * @param filter - the filter
 * @returns one chip per active part, empty when only a trip or a name is set
 */
export function activeChips(filter: LibraryFilter): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.kind !== "all") {
    const label = filter.kind === "photos" ? "Photos" : "Videos";
    chips.push({ id: "kind", label, without: { ...filter, kind: "all" } });
  }
  if (filter.year !== "any") {
    chips.push({ id: "year", label: filter.year, without: { ...filter, year: "any" } });
  }
  if (filter.uncertain) {
    const without = { ...filter, uncertain: false };
    chips.push({ id: "uncertain", label: "Uncertain dates", without });
  }
  if (filter.trip === "none") {
    chips.push({ id: "trip", label: "Not on a trip", without: { ...filter, trip: "any" } });
  }
  return chips;
}

/**
 * How many of the Filter popover's choices are in use: year, uncertain dates, not on a trip.
 * @param filter - the filter
 * @returns 0 to 3, for the Filter button's badge
 */
export function popoverFilterCount(filter: LibraryFilter): number {
  return Number(filter.year !== "any") + Number(filter.uncertain) + Number(filter.trip === "none");
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
  if (name !== "" && ![tile.name, ...tile.linked].some((n) => n.toLowerCase().includes(name))) {
    return false;
  }
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
 * The years to offer, newest first, and which other filters have anything to find, from the
 * photos on show (the whole library, or one trip's). A chosen year with no photos left is still
 * offered so the menu can show what's picked.
 * @param tiles - the tiles to choose from, newest first
 * @param filter - the current filter
 * @returns years, and whether any tile is on a trip, a video, or of uncertain date
 */
export function filterChoices(
  tiles: Tile[],
  filter: LibraryFilter,
): { years: string[]; onTrip: boolean; videos: boolean; uncertain: boolean } {
  const years = new Set<string>();
  let onTrip = false;
  let videos = false;
  let uncertain = false;
  for (const tile of tiles) {
    years.add(tile.takenAt.slice(0, 4));
    onTrip ||= tile.trip !== null;
    videos ||= tile.kind === "video";
    uncertain ||= tile.uncertain;
  }
  if (filter.year !== "any") years.add(filter.year);
  return { years: [...years].sort().reverse(), onTrip, videos, uncertain };
}

/**
 * Whether two filters show the same photos. Trips match by id, so a trip renamed since one of
 * them was taken still counts as the same place.
 * @param a - one filter
 * @param b - the other
 * @returns true when every part matches
 */
export function sameFilter(a: LibraryFilter, b: LibraryFilter): boolean {
  return (
    (tripOf(a)?.id ?? a.trip) === (tripOf(b)?.id ?? b.trip) &&
    a.year === b.year &&
    a.kind === b.kind &&
    a.uncertain === b.uncertain &&
    a.name === b.name
  );
}
