import { describe, expect, it } from "vitest";
import type { Tile, TripInfo } from "./api";
import {
  EMPTY_FORM,
  formFromTrip,
  hasValidRange,
  rangeOfTiles,
  rangeText,
  sidebarTrips,
  spreadPick,
  toDraft,
} from "./trips";

describe("spreadPick", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => i);

  it("keeps the ends and spreads the rest evenly", () => {
    expect(spreadPick(twelve, 4)).toEqual([0, 4, 7, 11]);
    expect(spreadPick(twelve, 2)).toEqual([0, 11]);
  });

  it("keeps everything when there's room, and copes with one or none", () => {
    expect(spreadPick(twelve, 20)).toEqual(twelve);
    expect(spreadPick(twelve, 1)).toEqual([0]);
    expect(spreadPick(twelve, 0)).toEqual([]);
    expect(spreadPick([], 3)).toEqual([]);
  });
});

describe("rangeText", () => {
  it("words ranges the same way as the backend", () => {
    expect(rangeText("2025-03-12T00:00:00", "2025-03-12T23:59:59")).toBe("12 Mar 2025");
    expect(rangeText("2025-03-12T00:00:00", "2025-03-18T23:59:59")).toBe("12-18 Mar 2025");
    expect(rangeText("2025-02-28T00:00:00", "2025-03-03T23:59:59")).toBe("28 Feb - 3 Mar 2025");
    expect(rangeText("2024-12-30T00:00:00", "2025-01-02T23:59:59")).toBe(
      "30 Dec 2024 - 2 Jan 2025",
    );
  });
});

describe("trip form", () => {
  const form = { ...EMPTY_FORM, name: "  Japan ", startDate: "2025-03-12", endDate: "2025-03-18" };

  it("takes in whole days", () => {
    expect(toDraft(form)).toEqual({
      name: "Japan",
      startAt: "2025-03-12T00:00:00",
      endAt: "2025-03-18T23:59:59",
    });
  });

  it("loads a saved trip as its days, widening one saved with times to whole days", () => {
    const trip: TripInfo = {
      id: 1,
      name: "Japan",
      startAt: "2025-03-12T00:00:00",
      endAt: "2025-03-18T09:15:59",
      folder: "2025-03-12 Japan",
      colour: 1,
      files: 0,
      sample: [],
      excluded: [],
    };
    const loaded = formFromTrip(trip);
    expect(loaded).toEqual({ name: "Japan", startDate: "2025-03-12", endDate: "2025-03-18" });
    expect(toDraft(loaded)).toMatchObject({
      startAt: "2025-03-12T00:00:00",
      endAt: "2025-03-18T23:59:59",
    });
  });

  it("only checks a range once both dates are set and in order", () => {
    expect(hasValidRange({ ...form, endDate: "" })).toBe(false);
    expect(hasValidRange({ ...form, endDate: "2025-03-11" })).toBe(false);
    expect(hasValidRange({ ...form, endDate: "2025-03-12" })).toBe(true);
    expect(hasValidRange(form)).toBe(true);
  });
});

describe("rangeOfTiles", () => {
  it("spans the first to the last day of the selection", () => {
    /**
     * A tile with just a date.
     * @param takenAt - when it was taken
     * @returns the tile
     */
    const tile = (takenAt: string): Tile => ({ takenAt }) as Tile;
    expect(
      rangeOfTiles([
        tile("2025-03-15T08:00:00"),
        tile("2025-03-12T23:10:00"),
        tile("2025-03-18T01:00:00"),
      ]),
    ).toEqual({ startDate: "2025-03-12", endDate: "2025-03-18" });
  });
});

describe("sidebarTrips", () => {
  /**
   * A trip starting on the given day.
   * @param id - trip id
   * @param day - "YYYY-MM-DD" first day
   * @returns the trip
   */
  const trip = (id: number, day: string): TripInfo => ({
    id,
    name: `Trip ${id}`,
    startAt: `${day}T00:00:00`,
    endAt: `${day}T23:59:59`,
    folder: `${day} Trip ${id}`,
    colour: 1,
    files: 0,
    sample: [],
    excluded: [],
  });
  // Oldest first, as the backend lists them.
  const trips = [
    trip(1, "2021-01-01"),
    trip(2, "2022-01-01"),
    trip(3, "2023-01-01"),
    trip(4, "2024-01-01"),
  ];
  /**
   * The ids of a list of trips, for short expectations.
   * @param list - the trips
   * @returns their ids, in order
   */
  const ids = (list: TripInfo[]): number[] => list.map((t) => t.id);

  it("lists the newest first, up to the cap", () => {
    const { rows, hidden } = sidebarTrips(trips, null, 3);
    expect(ids(rows)).toEqual([4, 3, 2]);
    expect(hidden).toBe(1);
  });

  it("lists every trip when they fit", () => {
    expect(sidebarTrips(trips, null, 5)).toEqual({ rows: [...trips].reverse(), hidden: 0 });
    expect(sidebarTrips([], null, 5)).toEqual({ rows: [], hidden: 0 });
  });

  it("keeps the trip on show in the last place when it is older", () => {
    expect(ids(sidebarTrips(trips, 1, 3).rows)).toEqual([4, 3, 1]);
    expect(ids(sidebarTrips(trips, 3, 3).rows)).toEqual([4, 3, 2]);
    // A trip that has since been deleted takes no row.
    expect(ids(sidebarTrips(trips, 9, 3).rows)).toEqual([4, 3, 2]);
  });
});
