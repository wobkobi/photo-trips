import { describe, expect, it } from "vitest";
import { rangeStart, selectRange, toggleRun } from "./selection";

describe("rangeStart", () => {
  it("prefers the anchor", () => {
    expect(rangeStart(2, 5, 10)).toBe(2);
  });

  it("falls back to the focused tile without an anchor", () => {
    expect(rangeStart(undefined, 5, 10)).toBe(5);
  });

  it("skips an anchor or focused tile past the end of the list", () => {
    expect(rangeStart(12, 4, 10)).toBe(4);
    expect(rangeStart(undefined, 10, 10)).toBeNull();
  });

  it("gives none with neither", () => {
    expect(rangeStart(undefined, null, 10)).toBeNull();
  });
});

describe("selectRange", () => {
  const order = [10, 11, 12, 13, 14];

  it("selects both ends and everything between, either way round", () => {
    expect([...selectRange(order, 1, 3)]).toEqual([11, 12, 13]);
    expect([...selectRange(order, 3, 1)].sort((a, b) => a - b)).toEqual([11, 12, 13]);
  });

  it("selects one tile when both ends match", () => {
    expect([...selectRange(order, 2, 2)]).toEqual([12]);
  });

  it("keeps the ids asked to", () => {
    expect([...selectRange(order, 3, 4, [10])].sort((a, b) => a - b)).toEqual([10, 13, 14]);
  });

  it("clamps ends outside the list", () => {
    expect([...selectRange(order, -2, 1)].sort((a, b) => a - b)).toEqual([10, 11]);
    expect([...selectRange(order, 3, 9)].sort((a, b) => a - b)).toEqual([13, 14]);
  });
});

describe("toggleRun", () => {
  it("adds the whole run when some are unselected", () => {
    expect([...toggleRun(new Set([1, 9]), [1, 2, 3])].sort((a, b) => a - b)).toEqual([1, 2, 3, 9]);
  });

  it("drops the run when every one is selected", () => {
    expect([...toggleRun(new Set([1, 2, 3, 9]), [1, 2, 3])]).toEqual([9]);
  });

  it("leaves the selection alone for an empty run", () => {
    expect([...toggleRun(new Set([4]), [])]).toEqual([4]);
  });

  it("doesn't change the set passed in", () => {
    const selected = new Set([1]);
    toggleRun(selected, [1, 2]);
    expect([...selected]).toEqual([1]);
  });
});
