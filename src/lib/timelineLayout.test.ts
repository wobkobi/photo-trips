import { describe, expect, it } from "vitest";
import type { TimelineRow } from "./format";
import { gridColumns, monthAt, monthStarts, pinnedMonth, type RailMonth } from "./timelineLayout";

const MONTHS: RailMonth[] = [
  { key: "2024-08", label: "August 2024", top: 0 },
  { key: "2024-07", label: "July 2024", top: 300 },
  { key: "2023-12", label: "December 2023", top: 700 },
];

describe("gridColumns", () => {
  it("fits as many preferred-size tiles as it can and stretches them to fill", () => {
    expect(gridColumns(1000, 200, 3)).toEqual({ columns: 4, tileSize: 247 });
  });

  it("never goes under two columns, even in no width", () => {
    expect(gridColumns(150, 200, 3).columns).toBe(2);
    expect(gridColumns(-20, 200, 3).columns).toBe(2);
  });

  it("gives fewer columns when the width shrinks by a rail's worth", () => {
    expect(gridColumns(1000 - 60, 240, 3).columns).toBeLessThan(gridColumns(1000, 240, 3).columns);
  });
});

describe("monthStarts", () => {
  it("adds heading and tile row heights in order", () => {
    const rows: TimelineRow[] = [
      { type: "month", key: "2024-08", label: "August 2024", count: 3, start: 0, end: 3 },
      { type: "tiles", key: "2024-08:0", start: 0, end: 2 },
      { type: "tiles", key: "2024-08:2", start: 2, end: 3 },
      { type: "month", key: "2024-07", label: "July 2024", count: 1, start: 3, end: 4 },
      { type: "tiles", key: "2024-07:3", start: 3, end: 4 },
    ];
    expect(monthStarts(rows, 100, 3, 48)).toEqual({
      months: [
        { key: "2024-08", label: "August 2024", top: 0 },
        { key: "2024-07", label: "July 2024", top: 48 + 2 * 103 },
      ],
      total: 48 + 2 * 103 + 48 + 103,
    });
  });
});

describe("monthAt", () => {
  it("names the last month starting at or above the offset", () => {
    expect(monthAt(MONTHS, 0)).toBe(0);
    expect(monthAt(MONTHS, 299.5)).toBe(1);
    expect(monthAt(MONTHS, 450)).toBe(1);
    expect(monthAt(MONTHS, 10_000)).toBe(2);
    expect(monthAt([], 50)).toBe(0);
  });
});

describe("pinnedMonth", () => {
  const AFTER = 24;
  const ROOM = 40;

  it("pins nothing at the top, while the first heading shows", () => {
    expect(pinnedMonth(MONTHS, 0, AFTER, ROOM)).toBeNull();
    expect(pinnedMonth(MONTHS, 23, AFTER, ROOM)).toBeNull();
    expect(pinnedMonth([], 500, AFTER, ROOM)).toBeNull();
  });

  it("pins the month once its heading has mostly scrolled away", () => {
    expect(pinnedMonth(MONTHS, 24, AFTER, ROOM)).toEqual({ index: 0, shift: 0 });
    expect(pinnedMonth(MONTHS, 200, AFTER, ROOM)).toEqual({ index: 0, shift: 0 });
  });

  it("has the next heading push the label up, then swaps once that heading is past", () => {
    expect(pinnedMonth(MONTHS, 270, AFTER, ROOM)).toEqual({ index: 0, shift: -10 });
    // Past July's top but not yet past its heading: August stays, pushed further.
    expect(pinnedMonth(MONTHS, 310, AFTER, ROOM)).toEqual({ index: 0, shift: -50 });
    expect(pinnedMonth(MONTHS, 324, AFTER, ROOM)).toEqual({ index: 1, shift: 0 });
  });

  it("never pushes the last month", () => {
    expect(pinnedMonth(MONTHS, 5000, AFTER, ROOM)).toEqual({ index: 2, shift: 0 });
  });
});
