import { describe, expect, it } from "vitest";
import { NONE, withIds, withoutIds } from "./hiddenIds";

describe("withIds", () => {
  it("adds ids without changing the set it was given", () => {
    const before = new Set([1]);
    expect([...withIds(before, [2, 3])]).toEqual([1, 2, 3]);
    expect([...before]).toEqual([1]);
  });
});

describe("withoutIds", () => {
  it("takes out only the ids given, leaving a later job's photos hidden", () => {
    // The first job hid 1 and 2 and has ended; a second job hid 3 before that job's load landed.
    const hidden = withIds(withIds(NONE, [1, 2]), [3]);
    const ended = new Set([1, 2]);
    expect([...withoutIds(hidden, ended)]).toEqual([3]);
  });

  it("gives back the same set when none of the ids were in it", () => {
    const hidden = new Set([4]);
    expect(withoutIds(hidden, [1, 2])).toBe(hidden);
  });

  it("gives back NONE once nothing is left", () => {
    expect(withoutIds(new Set([1, 2]), [2, 1])).toBe(NONE);
  });
});
