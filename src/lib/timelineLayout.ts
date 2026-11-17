// Layout maths for the month-grouped photo grid: columns from a width, where each month starts,
// which month a scroll position is in, and the month label pinned to the top of the grid.

import type { TimelineRow } from "./format";

/** A month heading in the grid: its label and how far down the grid it starts, in pixels. */
export interface RailMonth {
  key: string;
  label: string;
  top: number;
}

/**
 * How many tiles fit across, and how big each is once they stretch to fill the row.
 * @param inner - width available to tiles, in CSS pixels
 * @param target - preferred tile edge
 * @param gap - space between tiles
 * @returns the column count (never under 2) and the tile edge, rounded down
 */
export function gridColumns(
  inner: number,
  target: number,
  gap: number,
): { columns: number; tileSize: number } {
  const room = Math.max(0, inner);
  const columns = Math.max(2, Math.floor((room + gap) / (target + gap)));
  return { columns, tileSize: Math.floor((room - gap * (columns - 1)) / columns) };
}

/**
 * Where each month heading starts, from the same row heights the virtual list lays out with.
 * @param rows - rows from `timelineRows`
 * @param tileSize - tile edge in pixels; a tile row is one tile plus `gap`
 * @param gap - space under each tile row
 * @param header - height of a month heading row
 * @returns each month with its top, and the height of all rows together
 */
export function monthStarts(
  rows: TimelineRow[],
  tileSize: number,
  gap: number,
  header: number,
): { months: RailMonth[]; total: number } {
  const months: RailMonth[] = [];
  let top = 0;
  for (const row of rows) {
    if (row.type === "month") {
      months.push({ key: row.key, label: row.label, top });
      top += header;
    } else top += tileSize + gap;
  }
  return { months, total: top };
}

/**
 * The month at `offset` pixels down the grid: the last one starting at or above it. A month
 * starting within a pixel below counts, so seeking to a month's top (which may land a fraction
 * short) names that month.
 * @param months - months in grid order, the first at 0
 * @param offset - pixels from the top of the grid
 * @returns the month's index in `months` (0 when there are none)
 */
export function monthAt(months: RailMonth[], offset: number): number {
  let lo = 0;
  let hi = months.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (months[mid].top <= offset + 1) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The month label pinned to the top of the grid, and how far it is pushed up. */
export interface PinnedMonth {
  /** Index into the months. */
  index: number;
  /** Pixels to move the label up by (0 or less), as the next month's heading pushes it out. */
  shift: number;
}

/**
 * Which month label pins to the top of the grid when it's scrolled to `scrollTop`.
 *
 * A month's label pins once the view is `after` pixels past the month's top, by when its own
 * heading has mostly scrolled away; before that the heading itself is showing, so the previous
 * month's label stays pinned instead. The next month's heading pushes the label up as it comes
 * within `room` pixels of the top, so the label slides out rather than being swapped in place
 * while two headings show.
 * @param months - months in grid order, the first at 0
 * @param scrollTop - how far the grid is scrolled, in pixels
 * @param after - how far into a month the view must be before that month's label pins
 * @param room - how close to the top the next month's top may come before the label is pushed
 * @returns the pinned month, or null at the top of the grid, where the first heading shows
 */
export function pinnedMonth(
  months: RailMonth[],
  scrollTop: number,
  after: number,
  room: number,
): PinnedMonth | null {
  if (months.length === 0) return null;
  let index = monthAt(months, scrollTop);
  if (scrollTop < months[index].top + after) index -= 1;
  if (index < 0) return null;
  const next = months[index + 1] as RailMonth | undefined;
  const shift = next ? Math.min(0, next.top - scrollTop - room) : 0;
  return { index, shift };
}
