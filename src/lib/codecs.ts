// Which Microsoft Store codec extensions would fix the thumbnails Windows couldn't draw.

import type { Codec, MediaKind, Tile } from "./api";

/** Suggestion order: the most common phone formats first. */
const ORDER: Codec[] = ["heif", "hevc", "raw", "av1"];

const HEIF_EXTS = ["heic", "heif", "hif"];
/** Phone video containers, where HEVC is the usual codec. AVI or MTS need something else. */
const PHONE_VIDEO_EXTS = ["mov", "mp4", "m4v", "3gp"];

/**
 * Failed thumbnails a codec needs behind it before it's suggested. One damaged mp4 shouldn't
 * blame HEVC; a missing codec fails every file of its type, so several fail together.
 */
const MIN_FAILED = 3;

/**
 * The codecs a file of this type may need. HEIC photos are HEVC images in a HEIF container, so
 * Windows needs both extensions to draw them.
 * @param ext - the file's extension, lower case without the dot
 * @param kind - what sort of file it is
 * @returns the codecs it may be missing
 */
export function codecsFor(ext: string, kind: MediaKind): Codec[] {
  if (HEIF_EXTS.includes(ext)) return ["heif", "hevc"];
  if (PHONE_VIDEO_EXTS.includes(ext)) return ["hevc"];
  if (kind === "raw") return ["raw"];
  if (ext === "avif") return ["av1"];
  return [];
}

/**
 * How many tiles point to each codec. Empty files are left out: they fail for want of a
 * picture, not a codec.
 * @param tiles - tiles to count
 * @returns the count for each codec any tile points to
 */
function countCodecs(tiles: readonly Tile[]): Map<Codec, number> {
  const counts = new Map<Codec, number>();
  for (const tile of tiles) {
    if (tile.empty) continue;
    for (const codec of codecsFor(tile.ext, tile.kind)) {
      counts.set(codec, (counts.get(codec) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Codecs worth suggesting: ones that aren't installed and that {@link MIN_FAILED} failed
 * thumbnails point to, or every file of that type when there are fewer. When the codec is
 * already there, the file itself is the problem (damaged, or a variant Windows can't read), and
 * no extension would help.
 * @param failed - files whose thumbnails failed
 * @param installed - codecs this user already has
 * @param shown - every file on show, failed or not, so a library with only one or two of a type
 *   can still be helped (default: just the failed ones)
 * @returns the codecs to suggest, each once, in {@link ORDER}
 */
export function missingCodecs(
  failed: readonly Tile[],
  installed: readonly Codec[],
  shown: readonly Tile[] = failed,
): Codec[] {
  const failures = countCodecs(failed);
  const present = countCodecs(shown);
  return ORDER.filter((codec) => {
    const count = failures.get(codec) ?? 0;
    const needed = Math.min(MIN_FAILED, present.get(codec) ?? count);
    return count > 0 && count >= needed && !installed.includes(codec);
  });
}
