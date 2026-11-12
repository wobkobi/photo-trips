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
  exif: "From the camera's record of when the photo was taken.",
  video: "From the video's own recording date.",
  windows: "From the date Windows reads from the file.",
  exiftool: "From the date stored inside the file.",
  filename: "From the date in the file name.",
  modified: "Guessed from when the file was last changed, so it may be wrong.",
};

/**
 * One sentence on how sure the date is.
 * @param source - where the date came from
 * @returns the sentence
 */
export function sourceText(source: DateSource): string {
  return SOURCE_TEXT[source];
}

export type TimelineRow =
  | { type: "month"; key: string; label: string; count: number }
  | { type: "tiles"; key: string; start: number; end: number };

/**
 * Lay tiles (newest first) out as month headings followed by rows of `columns` tiles.
 * @param tiles - all tiles, newest first
 * @param columns - tiles per row
 * @returns rows for the virtual list; `start`/`end` index into `tiles`
 */
export function timelineRows(tiles: Tile[], columns: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let i = 0;
  while (i < tiles.length) {
    const key = monthKey(tiles[i].takenAt);
    let end = i;
    while (end < tiles.length && monthKey(tiles[end].takenAt) === key) end += 1;
    rows.push({ type: "month", key, label: monthLabel(key), count: end - i });
    for (let start = i; start < end; start += columns) {
      rows.push({ type: "tiles", key: `${key}:${start}`, start, end: Math.min(start + columns, end) });
    }
    i = end;
  }
  return rows;
}
