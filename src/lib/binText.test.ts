import { describe, expect, it } from "vitest";
import type { Tile } from "./api";
import { binQuestion, nameList } from "./binText";

/**
 * A tile for these tests.
 * @param name - file name
 * @param extra - how many files go with it
 * @param kind - photo or video
 * @returns the tile
 */
function tile(name: string, extra = 0, kind: Tile["kind"] = "photo"): Tile {
  return {
    id: 1,
    takenAt: "2025-03-12T10:00:00",
    kind,
    ext: name.split(".").pop() ?? "",
    name,
    uncertain: false,
    dateSet: false,
    extra,
    live: false,
    rawTwin: false,
    linked: [],
    version: 0,
    trip: null,
    empty: false,
  };
}

describe("nameList", () => {
  it("joins names as a sentence and counts the tail", () => {
    expect(nameList(["a"])).toBe("a");
    expect(nameList(["a", "b"])).toBe("a and b");
    expect(nameList(["a", "b", "c"])).toBe("a, b and c");
    expect(nameList(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more");
  });
});

describe("binQuestion", () => {
  it("names a single photo", () => {
    expect(binQuestion([tile("IMG_1.JPG")], null)).toBe("Send IMG_1.JPG to the Recycle Bin?");
  });

  it("names the files that go with a single photo once they are known", () => {
    expect(binQuestion([tile("IMG_1.HEIC", 2)], ["IMG_1.MOV", "IMG_1.AAE"])).toBe(
      "Send IMG_1.HEIC to the Recycle Bin? IMG_1.MOV and IMG_1.AAE go with it.",
    );
    expect(binQuestion([tile("IMG_1.HEIC", 1)], ["IMG_1.MOV"])).toBe(
      "Send IMG_1.HEIC to the Recycle Bin? IMG_1.MOV goes with it.",
    );
  });

  it("counts them before the names arrive", () => {
    expect(binQuestion([tile("IMG_1.HEIC", 2)], null)).toBe(
      "Send IMG_1.HEIC to the Recycle Bin? The 2 files that go with it go too.",
    );
  });

  it("counts several tiles and what goes with them, with the right noun", () => {
    expect(binQuestion([tile("a.jpg", 1), tile("b.jpg", 2)], null)).toBe(
      "Send 2 photos to the Recycle Bin? 3 files that go with them go too.",
    );
    expect(binQuestion([tile("a.mp4", 0, "video"), tile("b.mp4", 0, "video")], null)).toBe(
      "Send 2 videos to the Recycle Bin?",
    );
    expect(binQuestion([tile("a.jpg"), tile("b.mp4", 0, "video")], null)).toBe(
      "Send 2 items to the Recycle Bin?",
    );
  });
});
