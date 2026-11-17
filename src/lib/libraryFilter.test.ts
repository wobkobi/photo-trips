import { describe, expect, it } from "vitest";
import type { Tile } from "./api";
import {
  clearFilters,
  filterChoices,
  filterTiles,
  isFiltered,
  isFilteredBesidesTrip,
  NO_FILTER,
  sameFilter,
  tripOf,
} from "./libraryFilter";

/**
 * A photo tile, with any fields overridden.
 * @param id - media id
 * @param takenAt - when it was taken
 * @param extra - fields to override
 * @returns the tile
 */
function tile(id: number, takenAt: string, extra: Partial<Tile> = {}): Tile {
  return {
    id,
    takenAt,
    kind: "photo",
    ext: "jpg",
    name: `IMG_${id}.jpg`,
    uncertain: false,
    dateSet: false,
    extra: 0,
    version: 0,
    trip: null,
    empty: false,
    ...extra,
  };
}

const japan = { id: 7, name: "Japan", colour: 2 };
const tiles = [
  tile(1, "2025-03-14T10:00:00", { trip: japan }),
  tile(2, "2025-03-13T10:00:00", { trip: japan, kind: "video", ext: "mp4" }),
  tile(3, "2025-01-02T10:00:00", { uncertain: true }),
  tile(4, "2024-07-01T10:00:00", { kind: "raw", ext: "nef" }),
];
/**
 * The ids of a list of tiles, in order.
 * @param list - the tiles
 * @returns their ids
 */
const ids = (list: Tile[]): number[] => list.map((t) => t.id);

describe("filterTiles", () => {
  it("leaves the list alone with no filter", () => {
    expect(filterTiles(tiles, NO_FILTER)).toBe(tiles);
    expect(isFiltered(NO_FILTER)).toBe(false);
  });

  it("keeps one trip, or only photos on no trip", () => {
    expect(ids(filterTiles(tiles, { ...NO_FILTER, trip: { id: 7, name: "Japan" } }))).toEqual([
      1, 2,
    ]);
    expect(ids(filterTiles(tiles, { ...NO_FILTER, trip: "none" }))).toEqual([3, 4]);
  });

  it("keeps a year, photos (RAW included) or videos, and guessed dates", () => {
    expect(ids(filterTiles(tiles, { ...NO_FILTER, year: "2025" }))).toEqual([1, 2, 3]);
    expect(ids(filterTiles(tiles, { ...NO_FILTER, kind: "photos" }))).toEqual([1, 3, 4]);
    expect(ids(filterTiles(tiles, { ...NO_FILTER, kind: "videos" }))).toEqual([2]);
    expect(ids(filterTiles(tiles, { ...NO_FILTER, uncertain: true }))).toEqual([3]);
  });

  it("finds files by any part of their name, in any case, ignoring spaces around it", () => {
    expect(ids(filterTiles(tiles, { ...NO_FILTER, name: " img_3" }))).toEqual([3]);
    expect(ids(filterTiles(tiles, { ...NO_FILTER, name: ".JPG" }))).toEqual([1, 2, 3, 4]);
    expect(ids(filterTiles(tiles, { ...NO_FILTER, name: "beach" }))).toEqual([]);
    expect(isFiltered({ ...NO_FILTER, name: "  " })).toBe(false);
  });

  it("combines every part", () => {
    const filter = { ...NO_FILTER, trip: { id: 7, name: "Japan" }, kind: "photos" as const };
    expect(ids(filterTiles(tiles, filter))).toEqual([1]);
  });
});

describe("filterChoices", () => {
  it("offers years newest first, and says what's there to filter", () => {
    expect(filterChoices(tiles, NO_FILTER)).toEqual({
      years: ["2025", "2024"],
      onTrip: true,
      videos: true,
      uncertain: true,
    });
  });

  it("still offers a chosen year that has no photos left", () => {
    const choices = filterChoices(tiles.slice(2), { ...NO_FILTER, year: "2019" });
    expect(choices.years).toEqual(["2025", "2024", "2019"]);
    expect(choices.onTrip).toBe(false);
  });
});

describe("trips as places", () => {
  const trip = { id: 7, name: "Japan" };

  it("finds the trip on show, but not for all or for photos on no trip", () => {
    expect(tripOf({ ...NO_FILTER, trip, year: "2025" })).toBe(trip);
    expect(tripOf(NO_FILTER)).toBeNull();
    expect(tripOf({ ...NO_FILTER, trip: "none" })).toBeNull();
  });

  it("counts every filter but the trip itself", () => {
    expect(isFilteredBesidesTrip({ ...NO_FILTER, trip })).toBe(false);
    expect(isFilteredBesidesTrip({ ...NO_FILTER, trip, kind: "videos" })).toBe(true);
    expect(isFilteredBesidesTrip({ ...NO_FILTER, trip: "none" })).toBe(true);
    expect(isFilteredBesidesTrip({ ...NO_FILTER, name: " " })).toBe(false);
  });

  it("clears everything but the trip on show", () => {
    const filter = { ...NO_FILTER, trip, year: "2025", uncertain: true, name: "img" };
    expect(clearFilters(filter)).toEqual({ ...NO_FILTER, trip });
    expect(clearFilters({ ...NO_FILTER, trip: "none", kind: "photos" })).toEqual(NO_FILTER);
  });
});

describe("sameFilter", () => {
  const trip = { id: 7, name: "Japan" };

  it("matches equal filters, and a trip by id even after a rename", () => {
    expect(sameFilter(NO_FILTER, { ...NO_FILTER })).toBe(true);
    expect(
      sameFilter({ ...NO_FILTER, trip }, { ...NO_FILTER, trip: { id: 7, name: "Tokyo" } }),
    ).toBe(true);
  });

  it("tells apart any part that differs", () => {
    expect(
      sameFilter({ ...NO_FILTER, trip }, { ...NO_FILTER, trip: { id: 8, name: "Japan" } }),
    ).toBe(false);
    expect(sameFilter(NO_FILTER, { ...NO_FILTER, trip: "none" })).toBe(false);
    expect(sameFilter(NO_FILTER, { ...NO_FILTER, year: "2025" })).toBe(false);
    expect(sameFilter(NO_FILTER, { ...NO_FILTER, kind: "videos" })).toBe(false);
    expect(sameFilter(NO_FILTER, { ...NO_FILTER, uncertain: true })).toBe(false);
    expect(sameFilter(NO_FILTER, { ...NO_FILTER, name: "img" })).toBe(false);
  });
});
