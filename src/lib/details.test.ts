import { describe, expect, it } from "vitest";
import type { FileDetails } from "./api";
import { cameraName, cameraSettings, durationText, sizeText } from "./details";

const NONE: FileDetails = {
  make: null,
  model: null,
  lens: null,
  width: null,
  height: null,
  duration: null,
  fNumber: null,
  exposure: null,
  iso: null,
  focalLength: null,
  focal35: null,
  lat: null,
  lon: null,
};

describe("cameraName", () => {
  it("puts the maker before a model that doesn't name it", () => {
    expect(cameraName("Apple", "iPhone 13")).toBe("Apple iPhone 13");
    expect(cameraName("samsung", "SM-G991B")).toBe("Samsung SM-G991B");
    expect(cameraName("OLYMPUS IMAGING CORP.", "E-M10")).toBe("Olympus E-M10");
  });

  it("doesn't repeat a maker the model already starts with", () => {
    expect(cameraName("Canon", "Canon EOS R6")).toBe("Canon EOS R6");
    expect(cameraName("NIKON CORPORATION", "NIKON D750")).toBe("Nikon D750");
    expect(cameraName("EASTMAN KODAK COMPANY", "KODAK EasyShare C340")).toBe(
      "Kodak EasyShare C340",
    );
  });

  it("keeps short makers and copes with one tag missing", () => {
    expect(cameraName("LG Electronics", "LM-G900")).toBe("LG LM-G900");
    expect(cameraName("DJI", "FC3582")).toBe("DJI FC3582");
    expect(cameraName(null, "Pixel 7")).toBe("Pixel 7");
    expect(cameraName("GoPro", null)).toBe("GoPro");
    expect(cameraName(null, "  ")).toBeNull();
  });

  it("only drops a maker matching a whole word of the model", () => {
    expect(cameraName("Sony", "Sonyx 1")).toBe("Sony Sonyx 1");
  });
});

describe("sizeText", () => {
  it("gives a photo's megapixels", () => {
    expect(sizeText({ ...NONE, width: 3024, height: 4032 }, false)).toBe(
      "3024 × 4032 pixels (12 megapixels)",
    );
    expect(sizeText({ ...NONE, width: 2048, height: 1536 }, false)).toBe(
      "2048 × 1536 pixels (3.1 megapixels)",
    );
  });

  it("leaves megapixels off videos and tiny pictures", () => {
    expect(sizeText({ ...NONE, width: 1920, height: 1080 }, true)).toBe("1920 × 1080 pixels");
    expect(sizeText({ ...NONE, width: 640, height: 480 }, false)).toBe("640 × 480 pixels");
    expect(sizeText({ ...NONE, width: 640 }, false)).toBeNull();
  });
});

describe("durationText", () => {
  it("reads like speech", () => {
    expect(durationText(0.4)).toBe("Under a second");
    expect(durationText(1)).toBe("1 second");
    expect(durationText(45.4)).toBe("45 seconds");
    expect(durationText(134.5)).toBe("2 minutes 15 seconds");
    expect(durationText(120)).toBe("2 minutes");
    expect(durationText(3900)).toBe("1 hour 5 minutes");
  });
});

describe("cameraSettings", () => {
  it("lists what the file records, in order", () => {
    const details = {
      ...NONE,
      lens: "iPhone 13 back camera",
      fNumber: 1.6,
      exposure: 1 / 120,
      iso: 50,
      focalLength: 5.1,
      focal35: 26,
    };
    expect(cameraSettings(details)).toEqual([
      ["Lens", "iPhone 13 back camera"],
      ["Aperture", "f/1.6"],
      ["Shutter speed", "1/120 second"],
      ["ISO", "50"],
      ["Focal length", "26 mm"],
    ]);
  });

  it("handles long exposures and a missing full-frame figure", () => {
    expect(cameraSettings({ ...NONE, exposure: 2.5, focalLength: 50 })).toEqual([
      ["Shutter speed", "2.5 seconds"],
      ["Focal length", "50 mm"],
    ]);
    expect(cameraSettings({ ...NONE, exposure: 1 })[0][1]).toBe("1 second");
    expect(cameraSettings(NONE)).toEqual([]);
  });
});
