import { describe, expect, it } from "vitest";
import type { Tile } from "./api";
import { missingCodecs } from "./codecs";

/**
 * A tile with just the fields {@link missingCodecs} reads.
 * @param ext - file extension
 * @param kind - media kind
 * @returns the tile
 */
const tile = (ext: string, kind: Tile["kind"] = "photo"): Tile => ({ ext, kind }) as Tile;

describe("missingCodecs", () => {
  it("suggests nothing when the codecs a failure points to are installed", () => {
    // Tiny test clips and a test DNG fail on a PC that has every extension.
    const failed = [tile("mov", "video"), tile("mp4", "video"), tile("dng", "raw")];
    expect(missingCodecs(failed, ["heif", "hevc", "raw", "av1"])).toEqual([]);
  });

  it("suggests HEIF and HEVC for HEIC photos, since HEIC is HEVC inside HEIF", () => {
    expect(missingCodecs([tile("heic")], [])).toEqual(["heif", "hevc"]);
    expect(missingCodecs([tile("heic")], ["heif"])).toEqual(["hevc"]);
  });

  it("lists each codec once, in a fixed order", () => {
    const failed = [tile("avif"), tile("cr3", "raw"), tile("mov", "video"), tile("heic")];
    expect(missingCodecs(failed, [])).toEqual(["heif", "hevc", "raw", "av1"]);
  });

  it("ignores formats no Store extension helps with", () => {
    const failed = [tile("avi", "video"), tile("mts", "video"), tile("jpg")];
    expect(missingCodecs(failed, [])).toEqual([]);
  });
});
