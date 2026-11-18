import { describe, expect, it } from "vitest";
import {
  PHOTO_SIZES,
  photoSizeOf,
  photoTile,
  stepPhotoSize,
  TEXT_SIZES,
  textSizeOf,
  themeOf,
  tileSizeOf,
} from "./display";

describe("textSizeOf", () => {
  it("defaults to Standard when unset or not offered", () => {
    expect(textSizeOf(null)).toBe("100");
    expect(textSizeOf({})).toBe("100");
    expect(textSizeOf({ text_size: "400" })).toBe("100");
  });

  it("keeps an offered size", () => {
    expect(textSizeOf({ text_size: "130" })).toBe("130");
  });

  it("offers sizes that only grow", () => {
    const percents = TEXT_SIZES.map((size) => Number(size.value));
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents[0]).toBe(100);
  });
});

describe("photo size", () => {
  it("defaults to Medium when unset or not offered", () => {
    expect(photoSizeOf(null)).toBe("medium");
    expect(photoSizeOf({ photo_size: "huge" })).toBe("medium");
    expect(tileSizeOf({})).toBe(210);
  });

  it("gives each size a bigger tile than the last", () => {
    const tiles = PHOTO_SIZES.map((size) => tileSizeOf({ photo_size: size.value }));
    expect(tiles).toEqual([150, 210, 290]);
  });

  it("gives an unknown size Medium's tile", () => {
    expect(photoTile("huge")).toBe(210);
  });

  it("steps one size at a time, held at either end", () => {
    expect(stepPhotoSize("medium", 1)).toBe("large");
    expect(stepPhotoSize("medium", -1)).toBe("small");
    expect(stepPhotoSize("large", 1)).toBe("large");
    expect(stepPhotoSize("small", -1)).toBe("small");
  });

  it("counts only the step's sign", () => {
    expect(stepPhotoSize("small", 5)).toBe("medium");
    expect(stepPhotoSize("medium", 0)).toBe("medium");
  });

  it("steps from Medium when the size isn't one offered", () => {
    expect(stepPhotoSize("huge", 1)).toBe("large");
  });
});

describe("themeOf", () => {
  it("follows Windows when unset or not offered", () => {
    expect(themeOf(null)).toBe("system");
    expect(themeOf({ theme: "blue" })).toBe("system");
  });

  it("keeps an offered theme", () => {
    expect(themeOf({ theme: "dark" })).toBe("dark");
  });
});
