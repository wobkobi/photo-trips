// Display formatting for dates, sizes and date sources, plus the timeline row layout.

import type { DateSource, Tile } from "./api";

const LOCALE = "en-NZ";

/**
 * Parse the backend's "YYYY-MM-DDTHH:MM:SS" wall-clock time as a local Date (no time zone
 * shift: the value is already the time where the photo was taken).
 * @param takenAt - timestamp from the backend
 * @returns the date
 */
export function parseTaken(takenAt: string): Date {
  const [date, time = "00:00:00"] = takenAt.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

/**
 * Month key used to group the timeline.
 * @param takenAt - timestamp from the backend
 * @returns "YYYY-MM"
 */
export function monthKey(takenAt: string): string {
  return takenAt.slice(0, 7);
}

/**
 * Heading for a month group.
 * @param key - "YYYY-MM"
 * @returns e.g. "July 2024"
 */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
}

/**
 * Full date and time for the viewer.
 * @param takenAt - timestamp from the backend
 * @returns e.g. "Monday 15 July 2024 at 9:30 am"
 */
export function formatTaken(takenAt: string): string {
  const date = parseTaken(takenAt);
  const day = date.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  return `${day.replace(",", "")} at ${time}`;
}

/**
 * Human file size.
 * @param bytes - size in bytes
 * @returns e.g. "4.2 MB"
 */
export function formatBytes(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

const SOURCE_TEXT: Record<DateSource, string> = {
  set: "You set this date in Pic Cabinet. The file itself still has its own date, which other apps show.",
  exif: "From the camera's record of when the photo was taken.",
  video: "From the video's own recording date.",
  windows: "From the date Windows reads from the file.",
  exiftool: "From the date stored inside the file.",
  filename: "From the date in the file name.",
  modified:
    "The file has no date of its own, so this is when it last changed. Common for downloads, screenshots and photos from apps that don't save camera details.",
};

/**
 * One sentence on how sure the date is.
 * @param source - where the date came from
 * @returns the sentence
 */
export function sourceText(source: DateSource): string {
  return SOURCE_TEXT[source];
}

/**
 * A short note under a date that isn't the file's own record of it (set in Pic Cabinet, or
 * guessed); nothing for the rest, whose source shows on hover instead.
 * @param source - where the date came from
 * @returns the note, or null when the date came from the file's own record
 */
export function dateNote(source: DateSource): string | null {
  if (source === "set") return "Set in Pic Cabinet";
  if (source === "filename") return "From the file name";
  if (source === "modified") return "When the file last changed";
  return null;
}

export type TimelineRow =
  | { type: "month"; key: string; label: string; count: number; start: number; end: number }
  | { type: "tiles"; key: string; start: number; end: number };

/**
 * Lay tiles (newest first) out as month headings followed by rows of `columns` tiles.
 * @param tiles - all tiles, newest first
 * @param columns - tiles per row
 * @returns rows for the virtual list; `start`/`end` index into `tiles` (for a month, the
 * whole month)
 */
export function timelineRows(tiles: Tile[], columns: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let i = 0;
  while (i < tiles.length) {
    const key = monthKey(tiles[i].takenAt);
    let end = i;
    while (end < tiles.length && monthKey(tiles[end].takenAt) === key) end += 1;
    rows.push({ type: "month", key, label: monthLabel(key), count: end - i, start: i, end });
    for (let start = i; start < end; start += columns) {
      rows.push({
        type: "tiles",
        key: `${key}:${start}`,
        start,
        end: Math.min(start + columns, end),
      });
    }
    i = end;
  }
  return rows;
}

/**
 * A number with the right noun after it.
 * @param n - how many
 * @param one - noun for exactly one
 * @param many - noun for any other count
 * @returns e.g. "1 file", "1,204 files"
 */
export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString(LOCALE)} ${n === 1 ? one : many}`;
}

/**
 * Date and time of an app event, for History.
 * @param unixSecs - seconds since 1970
 * @returns e.g. "13 Nov 2026, 9:30 am"
 */
export function formatWhen(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Split a Windows path into its folder and file name.
 * @param path - absolute or library-relative path
 * @returns the folder ("" when there is none) and the name
 */
export function splitPath(path: string): { folder: string; name: string } {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return { folder: path.slice(0, Math.max(cut, 0)), name: path.slice(cut + 1) };
}

/**
 * A folder in the library as it reads from the library folder, e.g. "2025\2025-03" rather than
 * the whole path. Windows paths aren't case sensitive, so neither is the match.
 * @param folder - the folder's full path
 * @param root - the library folder
 * @returns the part under the library, "Library folder" for the library itself, or the full path
 * for a folder outside it
 */
export function libraryFolder(folder: string, root: string | null | undefined): string {
  if (!root) return folder;
  const base = root.replace(/[\\/]+$/, "");
  const lower = folder.toLowerCase();
  if (lower === base.toLowerCase()) return "Library folder";
  const prefix = `${base.toLowerCase()}\\`;
  return lower.startsWith(prefix) ? folder.slice(prefix.length) : folder;
}

/**
 * A folder's own name, for showing a long path where there's little room.
 * @param path - the folder's full path
 * @returns e.g. "Photos" for C:\Users\Me\Photos, or the path itself for a drive such as D:\
 */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const { name } = splitPath(trimmed);
  return name && !/^[A-Za-z]:$/.test(trimmed) ? name : path;
}

/**
 * The row to scroll to so a tile shows in context: its month heading when the tile is in the
 * month's first row, otherwise the tile's own row.
 * @param rows - rows from {@link timelineRows}
 * @param tile - the tile's index
 * @returns the row index, or -1 when no row holds the tile
 */
export function jumpRow(rows: TimelineRow[], tile: number): number {
  const at = rows.findIndex((row) => row.type === "tiles" && tile >= row.start && tile < row.end);
  if (at > 0 && rows[at - 1].type === "month" && rows[at - 1].start === rows[at].start) {
    return at - 1;
  }
  return at;
}

/**
 * The tile a key moves focus to in the grid. Left and Right step through the tiles in order,
 * across month breaks. Up and Down keep the column in the tile row above or below, skipping
 * month headings; a shorter row (a month's last) lands on its last tile. Home and End go to the
 * first and last tile.
 * @param rows - rows from {@link timelineRows}
 * @param tile - the focused tile's index
 * @param key - the key's `key` value
 * @param total - how many tiles there are
 * @returns the tile to focus, or null when the key isn't one of these or can't go further
 */
export function stepTile(
  rows: TimelineRow[],
  tile: number,
  key: string,
  total: number,
): number | null {
  const last = total - 1;
  if (key === "ArrowLeft") return tile > 0 ? tile - 1 : null;
  if (key === "ArrowRight") return tile < last ? tile + 1 : null;
  if (key === "Home") return tile > 0 ? 0 : null;
  if (key === "End") return tile < last ? last : null;
  if (key !== "ArrowUp" && key !== "ArrowDown") return null;
  const tileRows = rows.filter((row) => row.type === "tiles");
  const at = tileRows.findIndex((row) => tile >= row.start && tile < row.end);
  const to = at < 0 ? undefined : tileRows[at + (key === "ArrowUp" ? -1 : 1)];
  if (!to) return null;
  return Math.min(to.start + (tile - tileRows[at].start), to.end - 1);
}

/**
 * A playback time as a clock, e.g. "0:07", "12:34" or "1:02:03".
 * @param seconds - the time; anything not a finite number reads as zero
 * @returns the clock text
 */
export function clockTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
