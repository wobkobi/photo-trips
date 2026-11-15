import { describe, expect, it } from "vitest";
import { tilesAround } from "./mapAhead";

describe("tilesAround", () => {
  it("takes the one tile a small map sits inside", () => {
    // Zoom 1 has four tiles; the middle of the top-left one is 90°W, about 66.5°N.
    expect(tilesAround(66.5, -90, 1, 100, 100)).toEqual([{ z: 1, x: 0, y: 0 }]);
  });

  it("takes all four tiles around a tile corner", () => {
    expect(tilesAround(0, 0, 1, 100, 100)).toEqual([
      { z: 1, x: 0, y: 0 },
      { z: 1, x: 1, y: 0 },
      { z: 1, x: 0, y: 1 },
      { z: 1, x: 1, y: 1 },
    ]);
  });

  it("wraps across the antimeridian", () => {
    const xs = tilesAround(0, 179.99, 2, 100, 100).map((t) => t.x);
    expect(xs).toContain(3);
    expect(xs).toContain(0);
  });

  it("uses OpenFreeMap's closest tiles past zoom 14, fewer of them", () => {
    const tiles = tilesAround(-36.85, 174.76, 15, 300, 200);
    expect(tiles.every((t) => t.z === 14)).toBe(true);
    expect(tiles.length).toBeLessThanOrEqual(4);
  });
});
