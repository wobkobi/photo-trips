// Wording for the question asked before photos go to the Recycle Bin.

import type { Tile } from "./api";
import { count } from "./format";

/** How many linked file names are listed before the rest are counted. */
const NAMES_SHOWN = 3;

/**
 * The noun for a set of tiles: photos, videos, or items when they are mixed.
 * @param tiles - the tiles
 * @returns singular and plural nouns
 */
function nouns(tiles: Tile[]): [string, string] {
  const videos = tiles.filter((t) => t.kind === "video").length;
  if (videos === 0) return ["photo", "photos"];
  if (videos === tiles.length) return ["video", "videos"];
  return ["item", "items"];
}

/**
 * Names joined as a sentence list, the long tail counted: "a, b and 2 more".
 * @param names - file names
 * @returns the list
 */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length <= NAMES_SHOWN) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, NAMES_SHOWN).join(", ")} and ${names.length - NAMES_SHOWN} more`;
}

/**
 * The question asked before sending tiles to the Recycle Bin. It names what goes along, so a
 * Live Photo video or RAW twin never leaves without the user knowing.
 * @param tiles - the tiles about to go
 * @param partners - names of the files that go with a single tile, once read; null before then
 * or when several tiles go
 * @returns e.g. "Send IMG_1.HEIC to the Recycle Bin? IMG_1.MOV and IMG_1.AAE go with it."
 */
export function binQuestion(tiles: Tile[], partners: string[] | null): string {
  const extra = tiles.reduce((sum, t) => sum + t.extra, 0);
  if (tiles.length === 1) {
    const ask = `Send ${tiles[0].name} to the Recycle Bin?`;
    if (extra === 0) return ask;
    if (partners && partners.length > 0) {
      return `${ask} ${nameList(partners)} ${partners.length === 1 ? "goes" : "go"} with it.`;
    }
    return `${ask} ${extra === 1 ? "The file" : `The ${extra} files`} that go with it go too.`;
  }
  const [one, many] = nouns(tiles);
  const ask = `Send ${count(tiles.length, one, many)} to the Recycle Bin?`;
  if (extra === 0) return ask;
  return `${ask} ${count(extra, "file", "files")} that go with them go too.`;
}
