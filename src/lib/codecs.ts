// Which Microsoft Store codec extensions would fix the thumbnails Windows couldn't draw.

import type { Codec, Tile } from "./api";

/** Suggestion order: the most common phone formats first. */
const ORDER: Codec[] = ["heif", "hevc", "raw", "av1"];

const HEIF_EXTS = ["heic", "heif", "hif"];
/** Phone video containers, where HEVC is the usual codec. AVI or MTS need something else. */
const PHONE_VIDEO_EXTS = ["mov", "mp4", "m4v", "3gp"];

/**
 * The codecs a failed thumbnail points to. HEIC photos are HEVC images in a HEIF container, so
 * Windows needs both extensions to draw them.
 * @param tile - a file whose thumbnail failed
 * @returns the codecs it may be missing
 */
function codecsFor(tile: Tile): Codec[] {
  if (HEIF_EXTS.includes(tile.ext)) return ["heif", "hevc"];
  if (PHONE_VIDEO_EXTS.includes(tile.ext)) return ["hevc"];
  if (tile.kind === "raw") return ["raw"];
  if (tile.ext === "avif") return ["av1"];
  return [];
}

/**
 * Codecs worth suggesting: ones the failed thumbnails point to that aren't installed. When the
 * codec is already there, the file itself is the problem (damaged, or a variant Windows can't
 * read), and no extension would help.
 * @param failed - files whose thumbnails failed
 * @param installed - codecs this user already has
 * @returns the codecs to suggest, each once, in {@link ORDER}
 */
export function missingCodecs(failed: Tile[], installed: readonly Codec[]): Codec[] {
  const wanted = new Set(failed.flatMap(codecsFor));
  return ORDER.filter((codec) => wanted.has(codec) && !installed.includes(codec));
}
