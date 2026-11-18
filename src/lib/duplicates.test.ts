import { describe, expect, it } from "vitest";
import type { DupCopy, DupSet } from "./api";
import { keeperOf, pickWithPartners, prunePicks, removalPlan } from "./duplicates";

/**
 * A copy of a duplicate, not in place.
 * @param id - media id
 * @param group - id of the tile it belongs to; its own id when it is alone
 * @param size - file size in bytes
 * @returns the copy
 */
function copy(id: number, group = id, size = 0): DupCopy {
  const path = `in\\IMG_${id}.jpg`;
  return { id, version: 0, path, size, inPlace: false, extra: 0, group, details: [] };
}

/**
 * A photo duplicate set.
 * @param hash - content hash
 * @param size - file size in bytes
 * @param ids - media ids of the copies
 * @returns the set
 */
function set(hash: string, size: number, ids: number[]): DupSet {
  const copies = ids.map((id) => copy(id, id, size));
  return { hash, size, kind: "photo", detailsDiffer: false, copies };
}

describe("keeperOf", () => {
  const photos = set("a", 100, [1, 2, 3]);

  it("keeps the suggested copy until another is picked", () => {
    expect(keeperOf(photos, {})).toBe(1);
    expect(keeperOf(photos, { a: 3 })).toBe(3);
  });

  it("keeps every copy when the set is left alone", () => {
    expect(keeperOf(photos, { a: null })).toBeNull();
  });

  it("falls back to the suggestion when the picked copy has gone", () => {
    expect(keeperOf(photos, { a: 9 })).toBe(1);
  });
});

describe("removalPlan", () => {
  it("sends every copy but the keeper and skips sets left alone", () => {
    const sets = [set("a", 100, [1, 2, 3]), set("b", 50, [4, 5]), set("c", 10, [6, 7])];
    const plan = removalPlan(sets, { a: 2, c: null });
    expect(plan.choices).toEqual([
      { keep: 2, remove: [1, 3] },
      { keep: 4, remove: [5] },
    ]);
    expect(plan.copies).toBe(3);
    expect(plan.bytes).toBe(250);
  });

  it("counts each copy's own size when the details differ", () => {
    const picture: DupSet = {
      hash: "picture:p",
      size: 120,
      kind: "video",
      detailsDiffer: true,
      copies: [copy(1, 1, 120), copy(2, 2, 100), copy(3, 3, 90)],
    };
    expect(removalPlan([picture], {}).bytes).toBe(190);
    expect(removalPlan([picture], { "picture:p": 3 }).bytes).toBe(220);
  });
});

describe("pickWithPartners", () => {
  // Two copies of a Live Photo: tile 1 is photo 1 with clip 11, tile 2 is photo 2 with clip 12.
  const photos: DupSet = {
    hash: "p",
    size: 100,
    kind: "photo",
    detailsDiffer: false,
    copies: [copy(1), copy(2)],
  };
  const clips: DupSet = {
    hash: "v",
    size: 900,
    kind: "video",
    detailsDiffer: false,
    copies: [copy(11, 1), copy(12, 2)],
  };
  const other = set("o", 50, [5, 6]);
  const sets = [photos, clips, other];

  it("keeps the same pair's clip when a photo is chosen", () => {
    expect(pickWithPartners(sets, "p", 2)).toEqual({ p: 2, v: 12 });
    expect(pickWithPartners(sets, "v", 11)).toEqual({ v: 11, p: 1 });
  });

  it("leaves the pair's other set alone with it", () => {
    expect(pickWithPartners(sets, "p", null)).toEqual({ p: null, v: null });
  });

  it("follows a pair into a set that has a copy more or less", () => {
    // A third copy of the photo with no clip: tile 3.
    const three: DupSet = { ...photos, copies: [copy(1), copy(2), copy(3)] };
    expect(pickWithPartners([three, clips], "p", 2)).toEqual({ p: 2, v: 12 });
    expect(pickWithPartners([three, clips], "p", null)).toEqual({ p: null, v: null });
    // Keeping the copy with no clip leaves the clips' own choice alone.
    expect(pickWithPartners([three, clips], "p", 3)).toEqual({ p: 3 });
  });

  it("leaves sets of other tiles alone", () => {
    expect(pickWithPartners(sets, "o", 6)).toEqual({ o: 6 });
  });
});

describe("prunePicks", () => {
  const sets = [set("a", 100, [1, 2]), set("b", 50, [3, 4])];

  it("keeps picks whose set and copy are still listed", () => {
    const picks = { a: 2, b: null };
    expect(prunePicks(sets, picks)).toBe(picks);
  });

  it("drops a pick whose set has gone", () => {
    expect(prunePicks(sets, { a: 2, c: 7, d: null })).toEqual({ a: 2 });
  });

  it("drops a pick whose copy has left the set", () => {
    expect(prunePicks(sets, { a: 9, b: 4 })).toEqual({ b: 4 });
  });

  it("drops everything when no sets are left", () => {
    expect(prunePicks([], { a: 1, b: null })).toEqual({});
  });
});
