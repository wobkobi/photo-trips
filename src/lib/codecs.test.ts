import { describe, expect, it } from "vitest";
import type { Tile } from "./api";
import { missingCodecs } from "./codecs";

/**
 * A tile with just the fields {@link missingCodecs} reads.
 * @param ext - file extension
 * @param kind - media kind
 * @returns the tile
 */
const tile = (ext: string, kind: Tile["kind"] = "photo"): Tile =>
  ({ ext, kind, empty: false }) as Tile;

/**
 * Several tiles of one type.
 * @param n - how many
 * @param ext - file extension
 * @param kind - media kind
 * @returns the tiles
 */
const tiles = (n: number, ext: string, kind: Tile["kind"] = "photo"): Tile[] =>
  Array.from({ length: n }, () => tile(ext, kind));

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

  it("needs three failures of a type before blaming its codec", () => {
    const shown = [...tiles(10, "mp4", "video"), ...tiles(10, "jpg")];
    // One damaged clip among many that play.
    expect(missingCodecs(tiles(1, "mp4", "video"), [], shown)).toEqual([]);
    expect(missingCodecs(tiles(2, "mp4", "video"), [], shown)).toEqual([]);
    expect(missingCodecs(tiles(3, "mp4", "video"), [], shown)).toEqual(["hevc"]);
  });

  it("asks fewer failures of a type the library has only one or two of", () => {
    const shown = [...tiles(2, "heic"), ...tiles(10, "jpg")];
    expect(missingCodecs(tiles(2, "heic"), [], shown)).toEqual(["heif", "hevc"]);
    expect(missingCodecs(tiles(1, "heic"), [], shown)).toEqual([]);
  });

  it("leaves out empty files, which fail for want of a picture", () => {
    const empty = { ...tile("heic"), empty: true };
    expect(missingCodecs([empty, empty, empty], [], [empty, empty, empty])).toEqual([]);
  });

  it("ignores formats no Store extension helps with", () => {
    const failed = [tile("avi", "video"), tile("mts", "video"), tile("jpg")];
    expect(missingCodecs(failed, [])).toEqual([]);
  });
});
