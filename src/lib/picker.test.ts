import { describe, expect, it } from "vitest";
import type { ImportItem } from "./api";
import { firstInFolder, importTiles, pickedFolders, pickTotals, setPicked } from "./picker";

function item(takenAt: string, to: string, extra = 0, bytes = 100): ImportItem {
  return {
    thumb: "i1-0",
    version: 0,
    from: "DCIM\\x.jpg",
    to,
    extra,
    bytes,
    takenAt,
    uncertain: false,
    kind: "photo",
    ext: "jpg",
    renamed: false,
  };
}

const ITEMS = [
  item("2025-03-12T10:00:00", "2025\\2025-03\\a.jpg", 1, 300),
  item("2025-05-02T12:00:00", "Trips\\2025-05-01 Japan\\b.jpg"),
  item("2025-03-01T09:00:00", "2025\\2025-03\\c.jpg"),
  item("2025-05-02T12:00:00", "Trips\\2025-05-01 Japan\\d.jpg"),
];

describe("import picker", () => {
  it("finds where a folder's ticked photos start in the grid", () => {
    const tiles = importTiles(ITEMS);
    expect(firstInFolder(ITEMS, tiles, String.raw`Trips\2025-05-01 Japan`, new Set())).toBe(0);
    expect(firstInFolder(ITEMS, tiles, String.raw`2025\2025-03`, new Set())).toBe(2);
    expect(firstInFolder(ITEMS, tiles, String.raw`2025\2025-03`, new Set([0]))).toBe(3);
    expect(firstInFolder(ITEMS, tiles, String.raw`2024\2024-01`, new Set())).toBe(-1);
  });

  it("lays items out newest first, keeping their plan index as the id", () => {
    expect(importTiles(ITEMS).map((t) => t.id)).toEqual([1, 3, 0, 2]);
    expect(importTiles(ITEMS)[2]).toMatchObject({ extra: 1, kind: "photo", trip: null });
  });

  it("totals only what is still ticked, companions included", () => {
    expect(pickTotals(ITEMS, new Set())).toEqual({ items: 4, files: 5, bytes: 600 });
    expect(pickTotals(ITEMS, new Set([0, 3]))).toEqual({ items: 2, files: 2, bytes: 200 });
    expect(pickTotals(ITEMS, new Set([0, 1, 2, 3]))).toEqual({ items: 0, files: 0, bytes: 0 });
  });

  it("lists the folders that still receive files", () => {
    expect(pickedFolders(ITEMS, new Set())).toEqual([
      { folder: "2025\\2025-03", files: 3 },
      { folder: "Trips\\2025-05-01 Japan", files: 2 },
    ]);
    expect(pickedFolders(ITEMS, new Set([1, 3]))).toEqual([{ folder: "2025\\2025-03", files: 3 }]);
  });

  it("ticks and unticks groups of photos without touching the rest", () => {
    const left = setPicked(new Set([5]), [1, 2], false);
    expect([...left].sort()).toEqual([1, 2, 5]);
    expect([...setPicked(left, [2, 5], true)]).toEqual([1]);
  });
});
