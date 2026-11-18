import { describe, expect, it } from "vitest";
import type { Tile } from "./api";
import { filterChoices, filterTiles, isFiltered, NO_FILTER } from "./libraryFilter";

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
  it("offers trips and years newest first, and says what's there to filter", () => {
    expect(filterChoices(tiles, NO_FILTER)).toEqual({
      trips: [{ id: 7, name: "Japan" }],
      years: ["2025", "2024"],
      videos: true,
      uncertain: true,
    });
  });

  it("still offers a chosen trip that has no photos left", () => {
    const filter = { ...NO_FILTER, trip: { id: 9, name: "Wellington" }, year: "2019" };
    const choices = filterChoices(tiles, filter);
    expect(choices.trips.map((t) => t.name)).toEqual(["Japan", "Wellington"]);
    expect(choices.years).toEqual(["2025", "2024", "2019"]);
  });
});
