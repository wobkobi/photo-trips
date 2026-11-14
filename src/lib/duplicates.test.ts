import { describe, expect, it } from "vitest";
import type { DupCopy, DupSet } from "./api";
import { keeperOf, removalPlan } from "./duplicates";

function copy(id: number): DupCopy {
  return { id, version: 0, path: `in\\IMG_${id}.jpg`, inPlace: false, extra: 0 };
}

function set(hash: string, size: number, ids: number[]): DupSet {
  return { hash, size, kind: "photo", copies: ids.map(copy) };
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
});
