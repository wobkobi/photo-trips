import { describe, expect, it } from "vitest";
import type { Tile, TripInfo } from "./api";
import { EMPTY_FORM, formFromTrip, hasValidRange, rangeOfTiles, rangeText, toDraft } from "./trips";

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
