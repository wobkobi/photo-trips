import { describe, expect, it } from "vitest";
import { PHOTO_SIZES, photoSizeOf, TEXT_SIZES, textSizeOf, themeOf, tileSizeOf } from "./display";

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
